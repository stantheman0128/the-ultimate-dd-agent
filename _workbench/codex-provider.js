'use strict';

// Provider boundary only: DD prompts, context selection and business state live in server.js.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const DEFAULT_MODEL = 'gpt-6-astra';

function resolveCli(env = process.env) {
  const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  const names = process.platform === 'win32' ? ['codex.exe', 'codex'] : ['codex'];
  const candidates = [env.CODEX_BIN, path.join(__dirname, 'node_modules', '.bin', 'codex'),
    ...(env.PATH || '').split(path.delimiter).flatMap(d => names.map(n => path.join(d, n)))];
  for (const bin of candidates) if (bin && isFile(bin)) return { bin, prefix: [], version: 'Codex CLI' };
  const js = path.join(__dirname, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (isFile(js)) return { bin: process.execPath, prefix: [js], version: 'Codex CLI (Node launcher)' };
  return null;
}

function selectedModel(model, env = process.env) {
  return model && model !== 'default' ? model : (env.QLIST_CODEX_MODEL || DEFAULT_MODEL);
}

function cliArgs({ model, effort, models, agentFiles={}, writable = false, env = process.env } = {}) {
  const args = ['exec', '--json', '--ephemeral', '--sandbox', writable ? 'workspace-write' : 'read-only',
    '--model', selectedModel(model, env), '-c', 'model='+JSON.stringify(selectedModel(model,env)), '-c',
    'model_reasoning_effort=' + JSON.stringify(effort || env.QLIST_CODEX_EFFORT || 'medium')];
  if(models){
    args.push('-c','agents.default_subagent_model='+JSON.stringify(models.sub.model),'-c','agents.default_subagent_reasoning_effort='+JSON.stringify(models.sub.effort));
    for(const [name,file] of Object.entries(agentFiles))args.push('-c',`agents.${name}.config_file=${JSON.stringify(file)}`);
  }
  return [...args,'-'];
}

function errorMessage(e) { return typeof e === 'string' ? e : e?.message || JSON.stringify(e); }

function parseStreamLine(line, run) {
  let e;
  try { e = JSON.parse(line); } catch { return line.trim() ? [{ kind: 'raw', agent: 'main', text: line.slice(0, 300) }] : []; }
  const out = [];
  const emit = (kind, text, extra = {}) => out.push({ kind, agent: 'main', text, ...extra });
  if (e.type === 'thread.started') emit('init', 'Codex 引擎啟動', { thread_id: e.thread_id });
  else if (e.type === 'turn.completed') emit('done', 'Codex 回合完成', { usage: e.usage });
  else if (e.type === 'turn.failed' || e.type === 'error') {
    run.failed = true;
    emit('error', errorMessage(e.error || e.message || e));
  } else if (typeof e.type === 'string' && e.type.startsWith('item.')) {
    const item = e.item || {};
    if (item.type === 'agent_message' && e.type === 'item.completed') emit('text', (item.text || '').slice(0, 220));
    else if (item.type === 'command_execution' && e.type === 'item.started') emit('bash', '$ ' + (item.command || '').slice(0, 180));
    else if (item.type === 'command_execution' && e.type === 'item.completed' && item.exit_code) emit('error', `指令 exit=${item.exit_code}: ${(item.command || '').slice(0, 120)}`);
    else if (item.type === 'file_change' && e.type === 'item.completed') {
      for (const change of item.changes || []) {
        run.counts.writes++;
        emit('write', `寫 ${change.path}`, { file: change.path });
      }
    } else if (item.type === 'mcp_tool_call' && e.type === 'item.started') emit('tool', `${item.server || ''}/${item.tool || ''}`);
    else if (item.type === 'web_search' && e.type === 'item.started') emit('search', item.query || '搜尋');
    else if (item.type === 'collab_tool_call') {
      const tool = item.tool || '';
      if (e.type === 'item.started' && /spawn/.test(tool)) {
        run.counts.agents++;
        emit('spawn', `派工 ${item.prompt || item.agent_type || 'Codex 子代理'}`.slice(0, 200));
      } else if (e.type === 'item.completed') emit('agent_done', `子代理 ${tool} 完成`);
    }
  }
  return out;
}

async function askViaApi({ client, ctx, question, system, model, effort, send }) {
  const stream = await client.responses.create({
    model, instructions: system,
    input: [{ role: 'user', content: `${ctx.text}\n\n問題：${question}` }],
    reasoning: { effort }, max_output_tokens: 8000, stream: true, store: false,
  });
  let completed = false;
  for await (const ev of stream) {
    if (ev.type === 'response.output_text.delta') send({ delta: ev.delta });
    else if (ev.type === 'response.refusal.delta') send({ delta: ev.delta });
    else if (ev.type === 'response.completed') {
      completed = true;
      send({ usage: ev.response.usage, model: ev.response.model, stop_reason: ev.response.status, mode: 'api' });
    } else if (ev.type === 'response.failed' || ev.type === 'error') throw new Error(errorMessage(ev.response?.error || ev.error || ev.message || ev));
    else if (ev.type === 'response.incomplete') throw new Error('OpenAI 回應未完成：' + errorMessage(ev.response?.incomplete_details));
  }
  if (!completed) throw new Error('OpenAI 串流在完成事件前中斷');
}

function askViaCli({ cli, cwd, env, ctx, question, system, send, model, timeoutMs = 240000 }) {
  return new Promise((resolve, reject) => {
    const args = cliArgs({ model, env });
    const proc = spawn(cli.bin, [...(cli.prefix || []), ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', stderr = '', failure = null, completed = false;
    const handle = line => {
      let e; try { e = JSON.parse(line); } catch { return; }
      if (e.type === 'item.completed' && e.item?.type === 'agent_message') send({ delta: e.item.text || '' });
      if (e.type === 'turn.completed') { completed = true; send({ usage: e.usage, mode: 'cli' }); }
      if (e.type === 'turn.failed' || e.type === 'error') failure = new Error(errorMessage(e.error || e.message || e));
    };
    proc.stdout.on('data', chunk => {
      buf += chunk; let i;
      while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    proc.stdin.on('error', e => { if (e.code !== 'EPIPE') failure = e; });
    const timer = setTimeout(() => { failure = new Error(`逾時（${Math.round(timeoutMs / 1000)} 秒）`); proc.kill(); }, timeoutMs);
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', code => {
      clearTimeout(timer); if (buf.trim()) handle(buf);
      if (failure) reject(failure);
      else if (code !== 0 || !completed) reject(new Error(stderr || `Codex 未成功完成，exit=${code}`));
      else resolve();
    });
    // The shared retrieval budget bounds the context; do not silently truncate citations.
    proc.stdin.end(`${system}\n\n${ctx.text}\n\n問題：${question}`);
  });
}

module.exports = { DEFAULT_MODEL, resolveCli, selectedModel, cliArgs, parseStreamLine, askViaApi, askViaCli };
