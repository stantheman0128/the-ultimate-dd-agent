'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const DEFAULT_MODEL='claude-fable-5-1';
function resolveCli(env = process.env) {
  const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  if (env.CLAUDE_BIN && isFile(env.CLAUDE_BIN)) return { bin: env.CLAUDE_BIN, version: 'CLAUDE_BIN' };
  const names = process.platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude'];
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) { const p = path.join(dir, n); if (isFile(p)) return { bin: p, version: 'PATH' }; }
  }
  const home = env.HOME || env.USERPROFILE || '';
  const local = path.join(home, '.local', 'bin', 'claude');
  if (isFile(local)) return { bin: local, version: '~/.local/bin' };
  const base = path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code');
  try {
    const versions = fs.readdirSync(base).filter(v => /^\d+\.\d+\.\d+$/.test(v))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (let i = versions.length - 1; i >= 0; i--) {
      const bin = path.join(base, versions[i], 'claude.app', 'Contents', 'MacOS', 'claude');
      if (fs.existsSync(bin)) return { bin, version: versions[i] };
    }
  } catch {}
  return null;
}

const AGENT_TOOLS = new Set(['Task', 'Agent']);
function parseStreamLine(line, run) {
  let e; try { e = JSON.parse(line); } catch { return line.trim() ? [{ kind: 'raw', agent: 'main', text: line.slice(0, 300) }] : []; }
  const out = [];
  const agentOf = pid => (pid && run.agents[pid]) ? run.agents[pid] : 'main';
  if (e.type === 'system' && e.subtype === 'init') out.push({ kind: 'init', agent: 'main', text: `引擎啟動 · model ${e.model || '?'} · ${(e.tools || []).length} tools` });
  else if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
    const agent = agentOf(e.parent_tool_use_id);
    for (const b of e.message.content) {
      if (b.type === 'text' && b.text && b.text.trim()) out.push({ kind: 'text', agent, text: b.text.trim().slice(0, 220) });
      else if (b.type === 'tool_use') {
        const inp = b.input || {};
        if (AGENT_TOOLS.has(b.name)) {
          const label = (inp.subagent_type || inp.name || 'sub-agent') + (inp.description ? '：' + String(inp.description).slice(0, 80) : '');
          run.agents[b.id] = inp.subagent_type || inp.name || 'sub-agent';
          run.counts.agents++;
          out.push({ kind: 'spawn', agent, text: `派工 ${label}`, sub: run.agents[b.id] });
        } else if (b.name === 'Read') {
          run.counts.reads++;
          out.push({ kind: 'read', agent, text: `讀 ${path.basename(String(inp.file_path || ''))}${inp.pages ? ' p.' + inp.pages : ''}`, file: path.basename(String(inp.file_path || '')), pages: inp.pages || null });
        } else if (b.name === 'Bash') out.push({ kind: 'bash', agent, text: '$ ' + String(inp.command || '').replace(/\s+/g, ' ').slice(0, 110) });
        else if (b.name === 'Write' || b.name === 'Edit' || b.name === 'MultiEdit') { run.counts.writes++; out.push({ kind: 'write', agent, text: `寫 ${path.basename(String(inp.file_path || ''))}` }); }
        else if (b.name === 'Grep' || b.name === 'Glob') out.push({ kind: 'search', agent, text: `搜 ${inp.pattern || ''}` });
        else out.push({ kind: 'tool', agent, text: b.name });
      }
    }
  } else if (e.type === 'user' && e.message && Array.isArray(e.message.content)) {
    for (const b of e.message.content) {
      if (b.type !== 'tool_result') continue;
      if (run.agents[b.tool_use_id]) out.push({ kind: 'agent_done', agent: 'main', text: `✅ ${run.agents[b.tool_use_id]} 回報${typeof b.content === 'string' ? '：' + b.content.slice(0, 120) : ''}` });
      else if (b.is_error) out.push({ kind: 'error', agent: agentOf(e.parent_tool_use_id), text: '⚠ ' + String(typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).slice(0, 160) });
    }
  } else if (e.type === 'result') {
    if (e.is_error) run.failed = true;
    out.push({ kind: 'done', agent: 'main', text: `結束 · ${Math.round((e.duration_ms || 0) / 1000)}s · $${Number(e.total_cost_usd || 0).toFixed(2)} · ${e.num_turns || '?'} turns${e.is_error ? ' · ⚠ error' : ''}`, cost: e.total_cost_usd, duration_ms: e.duration_ms, subtype: e.subtype });
  } else if (e.type === 'system' && e.subtype === 'permission_denied') out.push({ kind: 'error', agent: 'main', text: '⚠ 權限被拒：' + (e.message || e.tool_name) });
  return out;
}
function selectedModel(model, env=process.env) { return model&&model!=='default'?model:env.QLIST_CLAUDE_MODEL||DEFAULT_MODEL; }
function cliArgs({model,effort='medium',prompt='',system='',agents={},writable=false}={}) {
  const args=['-p',prompt,'--permission-mode',writable?'acceptEdits':'default','--output-format','stream-json','--verbose','--append-system-prompt',system,'--model',selectedModel(model),'--effort',effort];
  if (Object.keys(agents).length) args.push('--agents',JSON.stringify(agents));
  if (!writable) args.push('--tools','');
  return args;
}
async function askViaApi({client,ctx,question,system,model,effort,send}) {
  const stream=client.messages.stream({model,max_tokens:8000,system:[{type:'text',text:system},{type:'text',text:ctx.text,cache_control:{type:'ephemeral',ttl:'1h'}}],messages:[{role:'user',content:question}],output_config:{effort}});
  for await (const ev of stream) if(ev.type==='content_block_delta'&&ev.delta?.type==='text_delta')send({delta:ev.delta.text});
  const fin=await stream.finalMessage();
  if (fin.stop_reason==='max_tokens') throw new Error('Claude 回應達到長度上限，未完整完成');
  send({usage:fin.usage,model:fin.model,stop_reason:fin.stop_reason,mode:'api'});
}
function askViaCli({cli,cwd,env,ctx,question,system,send,model,effort='low',timeoutMs=240000}) {
  return new Promise((resolve,reject)=>{
    const args=cliArgs({model,effort,system,prompt:'請依 stdin 的文件內容回答問題。'});
    const proc=spawn(cli.bin,[...(cli.prefix||[]),...args],{cwd,env,stdio:['pipe','pipe','pipe']});
    let buf='',stderr='',failure=null,completed=false;
    const handle=line=>{let e;try{e=JSON.parse(line);}catch{return;}
      if(e.type==='assistant')for(const b of e.message?.content||[])if(b.type==='text')send({delta:b.text});
      if(e.type==='result'){completed=true;if(e.is_error)failure=new Error(e.result||'Claude 執行失敗');else send({usage:e.usage,cost:e.total_cost_usd,mode:'cli'});}
    };
    proc.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){handle(buf.slice(0,i));buf=buf.slice(i+1);}});
    proc.stderr.on('data',d=>stderr=(stderr+d).slice(-2000));
    proc.stdin.on('error',e=>{if(e.code!=='EPIPE')failure=e;});
    const timer=setTimeout(()=>{failure=new Error('Claude 問答逾時');proc.kill();},timeoutMs);
    proc.on('error',e=>{clearTimeout(timer);reject(e);});
    proc.on('close',code=>{clearTimeout(timer);if(buf.trim())handle(buf);if(failure)reject(failure);else if(code!==0||!completed)reject(new Error(stderr||`Claude 未成功完成，exit=${code}`));else resolve();});
    proc.stdin.end(`${ctx.text}\n\n問題：${question}`);
  });
}
module.exports={DEFAULT_MODEL,resolveCli,selectedModel,cliArgs,parseStreamLine,askViaApi,askViaCli};
