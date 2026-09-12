const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

test('failed Codex turn cannot mark an existing draft as newly completed', { skip: process.platform === 'win32' }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qlist-server-'));
  const work = path.join(root, '_workbench');
  fs.mkdirSync(work);
  for (const file of ['server.js', 'codex-provider.js', 'project-chat.js', 'retrieval.py', 'memory-store.js', 'memory-search.py']) fs.copyFileSync(path.join(__dirname, '..', file), path.join(work, file));
  fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(work, 'node_modules'), 'dir');
  const analysis = path.join(root, 'SyntheticCase', '_analysis');
  fs.mkdirSync(path.join(analysis, 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(analysis, 'state.json'), JSON.stringify({ round: 1, lifecycle: 'collecting' }));
  fs.writeFileSync(path.join(analysis, 'drafts', 'draft_R1.md'), '# Prior synthetic draft');
  const cli = path.join(root, '_fake-codex');
  fs.writeFileSync(cli, `#!/usr/bin/env node
    const assert = require('node:assert/strict');
    const args = process.argv.slice(2);
    assert.equal(args[args.indexOf('--sandbox')+1], 'workspace-write');
    let input=''; process.stdin.on('data', d=>input+=d);
    process.stdin.on('end',()=>{
      assert.ok(input.includes('SyntheticCase'));
      assert.ok(input.includes('CODEX.md'));
      process.stdout.write(JSON.stringify({type:'turn.failed',error:{message:'provider unavailable'}})+'\\n');
    });
  `, { mode: 0o700 });
  const socket = net.createServer();
  await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port;
  await new Promise(r => socket.close(r));
  const proc = spawn(process.execPath, [path.join(work, 'server.js')], {
    env: { ...process.env, PORT: String(port), CODEX_BIN: cli, QLIST_MOCK: '0', OPENAI_API_KEY: '', CODEX_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    proc.kill();
    if (proc.exitCode === null) await new Promise(r => proc.once('close', r));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    proc.stdout.once('data', resolve); proc.once('error', reject);
    proc.once('exit', code => reject(new Error(`server exit=${code}`)));
  });
  const response = await fetch(`http://127.0.0.1:${port}/api/run`, { method: 'POST', body: JSON.stringify({ deal: 'SyntheticCase', model: 'default' }) });
  assert.equal(response.status, 200);
  let events = [];
  for (let i = 0; i < 250; i++) {
    const p = path.join(analysis, 'run.events.jsonl');
    events = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    if (events.some(e => e.kind === 'exit')) break;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.equal(events.filter(e => e.kind === 'exit').length, 1);
  assert.equal(events.find(e => e.kind === 'exit').code, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(analysis, 'state.json'))).lifecycle, 'collecting');
});
