const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const OpenAI = require('openai');
const provider = require('../codex-provider');

test('Responses SDK sends cited context and decodes SSE; surfaces incomplete responses', async t => {
  const requests = [];
  let incomplete = false;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const events = incomplete
      ? [{ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }]
      : [{ type: 'response.output_text.delta', delta: 'Note 41 [annual.pdf p.486]' },
         { type: 'response.completed', response: { status: 'completed', model: provider.DEFAULT_MODEL, usage: { input_tokens: 12, output_tokens: 8 } } }];
    for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new OpenAI({ apiKey: 'test-key-not-a-credential', baseURL: `http://127.0.0.1:${server.address().port}/v1`, maxRetries: 0 });
  const sent = [];
  const args = { client, ctx: { text: '<documents>第486頁 Note 41</documents>' }, question: '第486頁？', system: 'Only cite supplied documents', model: provider.DEFAULT_MODEL, effort: 'low', send: x => sent.push(x) };
  await provider.askViaApi(args);
  assert.equal(requests[0].url, '/v1/responses');
  assert.equal(requests[0].auth, 'Bearer test-key-not-a-credential');
  assert.equal(requests[0].body.store, false);
  assert.deepEqual(requests[0].body.reasoning, { effort: 'low' });
  assert.match(requests[0].body.input[0].content, /第486頁 Note 41/);
  assert.equal(sent[0].delta, 'Note 41 [annual.pdf p.486]');
  assert.equal(sent[1].usage.output_tokens, 8);
  incomplete = true;
  await assert.rejects(provider.askViaApi(args), /未完成/);
});

test('Codex process boundary handles stdin, JSONL chunks and failed turns', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlist-provider-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = path.join(dir, 'transport.cjs');
  fs.writeFileSync(fake, `
    const assert = require('node:assert/strict');
    const args = process.argv.slice(2);
    assert.equal(args[0], 'exec');
    assert.equal(args[args.indexOf('--sandbox')+1], 'read-only');
    assert.equal(args[args.indexOf('--model')+1], 'test-model');
    assert.equal(args.at(-1), '-');
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => input += d);
    process.stdin.on('end', () => {
      assert.ok(input.includes('文件內容')); assert.ok(input.includes('問題：question'));
      const e = process.env.FAIL_TURN ? {type:'turn.failed',error:{message:'authentication failed'}} : {type:'item.completed',item:{type:'agent_message',text:'已確認 Note 41'}};
      const line=JSON.stringify(e)+'\\n';
      process.stdout.write(line.slice(0, 11));
      process.stdout.write(line.slice(11));
      if (!process.env.FAIL_TURN) process.stdout.write(JSON.stringify({type:'turn.completed',usage:{output_tokens:4}}));
    });
  `);
  const sent = [];
  const args = { cli: { bin: process.execPath, prefix: [fake] }, cwd: dir, env: { ...process.env }, ctx: { text: '文件內容' }, question: 'question', system: 'system', model: 'test-model', send: e => sent.push(e) };
  await provider.askViaCli(args);
  assert.equal(sent[0].delta, '已確認 Note 41');
  assert.equal(sent[1].usage.output_tokens, 4);
  await assert.rejects(provider.askViaCli({ ...args, env: { ...process.env, FAIL_TURN: '1' } }), /authentication failed/);
});

test('batch JSONL tracks real writes and marks failed turns without invented reads', () => {
  const run = { counts: { agents: 0, reads: 0, writes: 0 }, agents: {} };
  const parse = e => provider.parseStreamLine(JSON.stringify(e), run);
  assert.equal(parse({ type: 'thread.started', thread_id: 'test' })[0].kind, 'init');
  assert.equal(parse({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'facts.json' }] } })[0].file, 'facts.json');
  assert.equal(run.counts.writes, 1);
  assert.equal(run.counts.reads, 0);
  assert.equal(parse({ type: 'turn.failed', error: { message: 'denied' } })[0].kind, 'error');
  assert.equal(run.failed, true);
  assert.equal(provider.selectedModel('default', { QLIST_CODEX_MODEL: 'gpt-6-astra' }), 'gpt-6-astra');
  assert.equal(provider.cliArgs({ writable: true })[4], 'workspace-write');
});
