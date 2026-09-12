// Q-List 工作台 — 本地薄殼伺服器（零依賴，Node 18+）
// 資料庫＝專案資料夾本身；本檔只做三件事：讀資料夾狀態、寫資料夾、呼叫 Codex CLI。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const OpenAI = require('openai');
const provider = require('./codex-provider');
const chat = require('./project-chat');
const {MemoryStore}=require('./memory-store');

const ROOT = path.resolve(__dirname, '..');
const memory=new MemoryStore(ROOT,dealPath);
function runMemoryJobs(){const apiKey=process.env.OPENAI_API_KEY||readToken();if(!MOCK&&apiKey)memory.drain(new OpenAI({apiKey,maxRetries:0,timeout:90000}),ASK_MODEL,chat).catch(e=>console.error('Memory job failed:',e.message));}
const PUB = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8765);
const MOCK = process.env.QLIST_MOCK === '1';
const EXCLUDE = new Set(['knowledge']);
const PY = process.env.PYTHON_BIN || 'python3';
// Project chat uses bounded, local retrieval and explicit evidence tool calls.
const ASK_MODEL = process.env.QLIST_ASK_MODEL || provider.DEFAULT_MODEL;
const ASK_EFFORT = process.env.QLIST_ASK_EFFORT || 'low';
const ASK_BUDGET = 12000; // Compatibility metadata; the enforced per-request byte limit is in project-chat.js.
const ASK_SYSTEM = [
  '你是 VC 盡職調查助理，正在協助分析師閱讀一間新創的 Data Room。只依據下方 <documents> 內提供的內容回答，不得用文件以外的知識補數字。',
  '回答規則：',
  '1. 一律繁體中文，專有名詞保留原文。',
  '2. 每個事實後面標出處，格式固定：[檔名 p.N]（PDF / pptx 頁）、[檔名 工作表!儲存格]（xlsx）。檔名寫完整原始檔名。',
  '3. 問「第 N 頁寫什麼」就逐項列出該頁內容（標題、每個數字、每個條款），不要摘要成一句。',
  '4. 涉及計算時列出算式與每個輸入值的出處；不同文件數字對不上要明講差多少。',
  '5. 文件裡找不到就明說「文件中未找到」，並列出你查過的檔名；不要猜。',
  '6. 掃描頁（標 scanned="true"）沒有文字，若答案可能在那幾頁，請指出頁碼請使用者開原檔。',
].join('\n');

// ---------- 路徑安全 ----------
function isDealName(name) {
  if (!name || name.startsWith('_') || name.startsWith('.') || EXCLUDE.has(name)) return false;
  const p = path.join(ROOT, name);
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function dealPath(name) {
  if (typeof name !== 'string' || name.includes('/') || name.includes('\\') || name.includes('..')) throw httpErr(400, 'bad deal name');
  if (!isDealName(name)) throw httpErr(404, 'deal not found');
  return path.join(ROOT, name);
}
function safeJoin(base, rel) {
  const p = path.resolve(base, rel);
  if (p !== base && !p.startsWith(base + path.sep)) throw httpErr(400, 'path escape');
  return p;
}
function httpErr(code, msg) { const e = new Error(msg); e.status = code; return e; }

// ---------- 案件狀態 ----------
const DEFAULT_STATE = { round: 1, lifecycle: 'collecting', closed: false, sentRounds: [] };
function readState(dp) {
  try { return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(path.join(dp, '_analysis', 'state.json'), 'utf8')) }; }
  catch { return { ...DEFAULT_STATE }; }
}
function writeState(dp, s) {
  fs.mkdirSync(path.join(dp, '_analysis'), { recursive: true });
  fs.writeFileSync(path.join(dp, '_analysis', 'state.json'), JSON.stringify(s, null, 2));
}

function skipFile(f) { return f.startsWith('.') || f.startsWith('~$'); }
function isQlistFile(f) { return /q-?list/i.test(f); }

function listDocs(dp) {
  const docs = [];
  const catMap = readCats(dp);
  const idx = indexMeta(dp);
  const push = (f, dir, round) => {
    const st = fs.statSync(path.join(dir, f));
    if (!st.isFile()) return;
    const im = idx[f];
    docs.push({
      name: f, round, size: st.size, mtime: st.mtimeMs,
      cat: catMap[f] || guessCat(f),
      card: !!findCard(dp, f),
      index: im ? { kind: im.kind, pages: im.page_count || im.sheet_count || 0, needsOcr: im.needs_ocr_pages || 0, chars: im.total_chars || 0, status: im.preprocess_status, summary: im.enrichment?.summary_zh || '', warnings: im.warnings || [], error: im.error || '', stale: im.mtime !== st.mtimeMs / 1000 && Math.abs(im.mtime - st.mtimeMs / 1000) > 1 } : null,
      indexing: INDEXING.has(path.join(dir, f)),
    });
  };
  for (const e of fs.readdirSync(dp)) {
    if (/^round\d+$/.test(e)) {
      const rd = path.join(dp, e);
      // round 資料夾內的 Q-list 檔＝對方的回覆，屬本輪文件，要顯示
      for (const f of fs.readdirSync(rd)) if (!skipFile(f)) push(f, rd, 'R' + e.slice(5));
    }
  }
  for (const f of fs.readdirSync(dp)) {
    if (skipFile(f) || f === '_notes.md' || isQlistFile(f)) continue;
    try { if (fs.statSync(path.join(dp, f)).isFile()) push(f, dp, '未分輪'); } catch {}
  }
  return docs;
}
function listQlists(dp) {
  const out = [];
  const scan = dir => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (skipFile(f) || !isQlistFile(f)) continue;
      try { const st = fs.statSync(path.join(dir, f)); if (st.isFile() && st.size > 0) out.push(f); } catch {}
    }
  };
  scan(dp); scan(path.join(dp, 'qlist'));
  return out;
}
function dealSummary(name) {
  const dp = path.join(ROOT, name);
  const state = readState(dp);
  const cardsDir = path.join(dp, '_analysis', 'cards');
  const cards = fs.existsSync(cardsDir) ? fs.readdirSync(cardsDir).filter(f => f.endsWith('.md')).length : 0;
  return {
    name, state,
    docsCount: listDocs(dp).length,
    cardsCount: cards,
    hasFacts: fs.existsSync(path.join(dp, '_analysis', 'facts.md')),
    hasDraft: fs.existsSync(path.join(dp, '_analysis', 'drafts', 'draft_R' + state.round + '.md')),
    running: !!RUNS[name],
  };
}
function dealDetail(name) {
  const dp = dealPath(name);
  const state = readState(dp);
  const an = path.join(dp, '_analysis');
  const cardsDir = path.join(an, 'cards');
  const draftFile = path.join(an, 'drafts', 'draft_R' + state.round + '.md');
  const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  return {
    name, state,
    docs: listDocs(dp),
    qlists: listQlists(dp),
    cards: fs.existsSync(cardsDir) ? fs.readdirSync(cardsDir).filter(f => f.endsWith('.md')) : [],
    facts: read(path.join(an, 'facts.md')),
    draft: read(draftFile),
    notes: read(path.join(dp, '_notes.md')),
    running: !!RUNS[name],
  };
}

// ---------- 引擎（Codex CLI headless） ----------
const RUNS = {}; // dealName -> { proc, kind }
const CLI = provider.resolveCli();
const HEADLESS_SYS = '此為 headless 程式化呼叫，你的輸出會直接顯示在工作台 UI 或寫入檔案：只輸出任務本體，不要輸出 live trace、對帳單（📋 本回合…）、skill 載入標記或程序性註解。一律使用繁體中文。';

// 可選 OpenAI API key：存 _workbench/token；不接受其他供應商的 token。
function readToken() {
  // 終端機複製常把長 token 折行，清掉所有空白字元
  try { const t = fs.readFileSync(path.join(__dirname, 'token'), 'utf8').replace(/\s+/g, ''); return t || null; } catch { return null; }
}
function engineEnv() {
  const env = { ...process.env };
  const key = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || readToken();
  if (key) env.CODEX_API_KEY = key;
  return env;
}

// 字卡解析：先找「與原檔同名.md」，找不到就掃字卡開頭是否提到原檔名（引擎舊命名相容）
function findCard(dp, docName) {
  const dir = path.join(dp, '_analysis', 'cards');
  if (!fs.existsSync(dir)) return null;
  if (fs.existsSync(path.join(dir, docName + '.md'))) return docName + '.md';
  const base = docName.replace(/\.[^.]+$/, '');
  for (const cf of fs.readdirSync(dir)) {
    if (!cf.endsWith('.md')) continue;
    try {
      const head = fs.readFileSync(path.join(dir, cf), 'utf8').slice(0, 600);
      if (head.includes(docName) || head.includes(base)) return cf;
    } catch {}
  }
  return null;
}

const CATS = ['Company & strategy', 'Products & technology', 'Commercial & traction', 'Financials', 'Corporate & legal', 'Reference & media'];
function guessCat(n) {
  const s = n.toLowerCase();
  if (/章程|登記|spa|sha|m&a|m_a|sr_ma|stamped|resolution|shareholder|registry|股東名簿|captable|cap table|cap_table|投審會|核准|incorporation|統一編|certificate|函|公文/.test(s)) return CATS[4];
  if (/財報|年報|annual|financ|損益|資產負債|balance|income|audited|自結|財測|forecast|預估|模型|model|稅|tax/.test(s)) return CATS[3];
  if (/客戶|customer|訂單|pipeline|traction|進銷貨|top10|top 10|合約|contract|agreement|通路|經銷/.test(s)) return CATS[2];
  if (/產品|product|技術|tech|專利|patent|認證|cert|iso|白皮書|whitepaper|spec|規格|碳核查/.test(s)) return CATS[1];
  if (/deck|簡報|pitch|overview|one ?page|dataroom|策略|strategy|組織|org|介紹|company|學經歷|cv|團隊|team/.test(s)) return CATS[0];
  return CATS[5];
}
function readCats(dp) {
  try { return JSON.parse(fs.readFileSync(path.join(dp, '_analysis', 'doc-categories.json'), 'utf8')); } catch { return {}; }
}

// ---------- 可定位層：_analysis/index/<檔名>.index.json ----------
const INDEX_META_CACHE = new Map();
const INDEX_CACHE = new Map(); // indexPath -> { mtimeMs, data }
const INDEXING = new Set();    // 正在索引的原始檔絕對路徑
function indexDir(dp) { return path.join(dp, '_analysis', 'index'); }
function loadIndex(dp, file) {
  const ip = path.join(indexDir(dp), file + '.index.json');
  let st; try { st = fs.statSync(ip); } catch { return null; }
  const c = INDEX_CACHE.get(ip);
  if (c && c.mtimeMs === st.mtimeMs) return c.data;
  try {
    const data = JSON.parse(fs.readFileSync(ip, 'utf8'));
    // Keep at most 8 source files / 32 MB; metadata has a separate lightweight cache.
    if (st.size <= 32*1024*1024) INDEX_CACHE.set(ip, { mtimeMs: st.mtimeMs, data, bytes: st.size });
    while (INDEX_CACHE.size > 8 || [...INDEX_CACHE.values()].reduce((n,c)=>n+c.bytes,0)>32*1024*1024) INDEX_CACHE.delete(INDEX_CACHE.keys().next().value);
    return data;
  } catch { return null; }
}
function indexMeta(dp) {
  const out = {};
  const dir = indexDir(dp);
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.index.json')) continue;
    const name = f.slice(0, -'.index.json'.length);
    const ip=path.join(dir,f),st=fs.statSync(ip),cached=INDEX_META_CACHE.get(ip);
    if(cached?.mtime===st.mtimeMs){out[name]=cached.meta;continue;}
    let d;
    try {const m=JSON.parse(fs.readFileSync(ip+'.meta','utf8'));if(m.indexSize===st.size&&Math.abs(m.indexMtime-st.mtimeMs/1000)<.001)d=m;}catch{}
    if(!d)d=loadIndex(dp,name);
    if(d){const meta={kind:d.kind,page_count:d.page_count,sheet_count:d.sheet_count,needs_ocr_pages:d.needs_ocr_pages,total_chars:d.total_chars,mtime:d.mtime,preprocess_status:d.preprocess_status,warnings:d.warnings,error:d.error,enrichment:d.enrichment};out[name]=meta;INDEX_META_CACHE.set(ip,{mtime:st.mtimeMs,meta});}
    if(INDEX_META_CACHE.size>5000)INDEX_META_CACHE.delete(INDEX_META_CACHE.keys().next().value);
  }
  return out;
}
function loadAllIndex(dp) {
  return Object.keys(indexMeta(dp)).map(n => loadIndex(dp, n)).filter(Boolean);
}
// 跑 index_doc.py（單檔或全案）。非同步、不阻塞 HTTP；回傳 promise 供需要等待的路由使用。
const INDEX_QUEUE=new Map();
function runIndexer(dp,file,force){
  const prior=INDEX_QUEUE.get(dp)||Promise.resolve();
  const job=prior.catch(()=>{}).then(()=>runIndexerNow(dp,file,force));
  INDEX_QUEUE.set(dp,job);job.finally(()=>{if(INDEX_QUEUE.get(dp)===job)INDEX_QUEUE.delete(dp)});return job;
}
function runIndexerNow(dp, file, force) {
  const args = [path.join(__dirname, 'index_doc.py'), dp];
  if (file) args.push('--file', file);
  if (force) args.push('--force');
  const targets=file?[path.isAbsolute(file)?file:path.join(dp,file)]:listDocs(dp).map(d=>path.join(dp,/^R\d+$/.test(d.round)?'round'+d.round.slice(1):'',d.name));
  targets.forEach(f=>INDEXING.add(f));
  return new Promise(resolve => {
    const py = spawn(PY, args, { cwd: ROOT });
    let out = '', err = '';
    py.stdout.on('data', d => out += d);
    py.stderr.on('data', d => err += d);
    py.on('error', e => { err += String(e); });
    py.on('close', code => {
      targets.forEach(f=>INDEXING.delete(f));
      let parsed = null; try { parsed = JSON.parse(out.trim().split('\n').pop()); } catch {}
      if (code === 0) chat.retrieval(dp, {op:'catalog'}).catch(e => console.error('Retrieval index:', e.message));
      resolve({ code, result: parsed, error: code === 0 ? '' : err.slice(-600) });
    });
  });
}
function readFactsJson(dp) {
  try { return JSON.parse(fs.readFileSync(path.join(dp, '_analysis', 'facts.json'), 'utf8')); } catch { return null; }
}

// ---------- 問 AI 的 context 組裝 ----------
function estTokens(s) {
  if (!s) return 0;
  let cjk = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0x3400 && c <= 0x9fff) cjk++; }
  return Math.round((s.length - cjk) / 3.2 + cjk * 1.2); // 財務表格類英文實測約 3 字元/token
}
function docText(d) {
  if (d.kind === 'xlsx') return (d.sheets || []).map(sh => sh.text || '').join('\n');
  return (d.pages || []).map(p => p.text || '').join('\n');
}
function docChars(d) { return estTokens(docText(d)); } // 以「估算 token」為預算單位
// Codex JSONL events are adapted to the existing workbench timeline contract.
const parseStreamLine = provider.parseStreamLine;
function mockRun(run, emit, dp, finish) {
  const docs = listDocs(dp).slice(0, 4);
  const steps = [
    ['init', 'main', '引擎啟動 · model mock · 假引擎模式'],
    ...docs.flatMap(d => [['spawn', 'main', `派工 card-extractor：${d.name}`, 'card-extractor'], ['read', 'card-extractor', `讀 ${d.name} p.1-20`], ['write', 'card-extractor', `寫 ${d.name}.md`], ['agent_done', 'main', `✅ card-extractor 回報：字卡完成 ${d.name}`]]),
    ['spawn', 'main', '派工 reconciler：跨文件對帳', 'reconciler'], ['read', 'reconciler', '讀 knowledge/metrics.json'], ['bash', 'reconciler', '$ python3 _workbench/recompute.py …'], ['write', 'reconciler', '寫 facts.json'], ['agent_done', 'main', '✅ reconciler 回報：事實 27 列 · conflict 7'],
    ['spawn', 'main', '派工 persona-fin', 'persona-fin'], ['spawn', 'main', '派工 persona-ops', 'persona-ops'], ['spawn', 'main', '派工 persona-ind', 'persona-ind'], ['spawn', 'main', '派工 persona-ic', 'persona-ic'],
    ['agent_done', 'main', '✅ persona-fin 回報：12 題'], ['agent_done', 'main', '✅ persona-ops 回報：11 題'], ['agent_done', 'main', '✅ persona-ind 回報：8 題'], ['agent_done', 'main', '✅ persona-ic 回報：13 題'],
    ['text', 'main', '匯整去重與 staple sweep…'], ['write', 'main', '寫 draft_R1.md'], ['done', 'main', '結束 · 12s · $0.00 · mock'],
  ];
  let i = 0;
  run.timer = setInterval(() => {
    if (i >= steps.length) { clearInterval(run.timer); return finish(0); }
    const [kind, agent, text, sub] = steps[i++];
    if (kind === 'spawn') run.counts.agents++; if (kind === 'read') run.counts.reads++; if (kind === 'write') run.counts.writes++;
    emit({ kind, agent, text, sub });
  }, 550);
}
function startRun(deal, kind, prompt, onDone, model) {
  const dp = dealPath(deal);
  if (RUNS[deal]) throw httpErr(409, '本案已有流程在跑');
  fs.mkdirSync(path.join(dp, '_analysis'), { recursive: true });
  const logPath = path.join(dp, '_analysis', 'run.log');
  const evPath = path.join(dp, '_analysis', 'run.events.jsonl');
  fs.writeFileSync(logPath, `[${new Date().toISOString()}] ${kind} 啟動\n`);
  fs.writeFileSync(evPath, '');
  const append = t => { try { fs.appendFileSync(logPath, t); } catch {} };
  const run = { proc: null, kind, started: Date.now(), events: [], agents: {}, counts: { agents: 0, reads: 0, writes: 0 }, timer: null };
  const emit = ev => {
    ev.ts = Date.now(); ev.i = run.events.length;
    run.events.push(ev);
    try { fs.appendFileSync(evPath, JSON.stringify(ev) + '\n'); } catch {}
    append(`[${new Date(ev.ts).toISOString().slice(11, 19)}] [${ev.agent}] ${ev.text}\n`);
  };
  let finished = false;
  const finish = code => {
    if (finished) return;
    finished = true;
    if (run.failed && code === 0) code = 1;
    append(`\n[${new Date().toISOString()}] 結束，exit=${code}${code !== 0 ? '　⚠ 流程失敗，請檢查上方訊息（最常見：引擎未登入 → 見說明頁）' : ''}\n`);
    emit({ kind: 'exit', agent: 'main', text: `exit=${code}`, code });
    delete RUNS[deal];
    try { if (code === 0) onDone && onDone(code); } catch {}
  };
  RUNS[deal] = run;
  if (MOCK) { mockRun(run, emit, dp, finish); return; }
  if (!CLI) { delete RUNS[deal]; throw httpErr(500, '找不到 Codex CLI（執行 npm install，或設 CODEX_BIN）'); }
  let args;
  try { args = provider.cliArgs({ model, writable: true }); }
  catch (e) { delete RUNS[deal]; throw httpErr(400, e.message); }
  append(`模型：${provider.selectedModel(model)}｜憑證：${engineEnv().CODEX_API_KEY ? 'API key' : 'Codex 登入'}｜CLI：${CLI.bin}\n`);
  const proc = spawn(CLI.bin, [...(CLI.prefix || []), ...args], { cwd: ROOT, env: engineEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stdin.on('error', e => { if (e.code !== 'EPIPE') emit({ kind: 'error', agent: 'main', text: e.message }); });
  proc.stdin.end(`${HEADLESS_SYS}\n先讀 AGENTS.md 與 CODEX.md；使用 .codex/agents/ 中同名 Codex 代理。\n\n${prompt}`);
  run.proc = proc;
  let buf = '';
  proc.stdout.on('data', d => {
    buf += d.toString();
    let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); for (const ev of parseStreamLine(line, run)) emit(ev); }
  });
  proc.stderr.on('data', d => { const t = d.toString(); if (t.trim()) emit({ kind: 'stderr', agent: 'main', text: t.trim().slice(0, 300) }); });
  proc.on('error', e => { emit({ kind: 'error', agent: 'main', text: '⚠ 無法啟動 CLI：' + e.message }); finish(-1); });
  proc.on('close', code => { if (buf.trim()) for (const ev of parseStreamLine(buf, run)) emit(ev); finish(code); });
}
// 草稿表格解析：依表頭定位欄位，容忍引擎欄序 / 欄數變化；「證據」欄＝機讀引用（文件代號:位置; …）
function parseDraftTable(text, isMerged) {
  const rows = [];
  let map = null;
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const c = line.split('|').map(s => s.trim());
    if (!map && c.some(x => x.includes('問題')) && c.some(x => x.includes('分類'))) {
      map = {};
      c.forEach((x, i) => {
        if (/^no\.?$/i.test(x)) map.no = i;
        else if (x.includes('分類')) map.cat = i;
        else if (x.includes('問題')) map.q = i;
        else if (x.includes('來源')) map.src = i;
        else if (x.includes('出處')) map.why = i;
        else if (x.includes('證據') || /evidence/i.test(x)) map.ev = i;
        else if (x.includes('書面') || x.includes('口頭') || x.includes('通路')) map.ch = i;
        else if (x.includes('波次') || /wave/i.test(x)) map.wave = i;
      });
      continue;
    }
    const noIdx = map && map.no != null ? map.no : 1;
    if (!/^\d+$/.test(c[noIdx] || '')) continue;
    const g = k => (map && map[k] != null ? c[map[k]] : undefined);
    const ev = (g('ev') || '').split(/[;；]/).map(s => s.trim()).filter(Boolean).map(s => { const m = s.match(/^([A-Za-z0-9_\-]+)\s*[:：]\s*(.+)$/); return m ? { doc: m[1], loc: m[2] } : { doc: '', loc: s }; });
    rows.push({
      no: Number(c[noIdx]),
      cat: g('cat') ?? c[2] ?? '',
      q: g('q') ?? c[3] ?? '',
      source: (g('src') || 'AI').trim() || 'AI',
      why: g('why') ?? (isMerged ? c[5] : c[4]) ?? '',
      channel: g('ch') ?? '',
      wave: g('wave') ?? '',
      evidence: ev,
    });
  }
  return rows;
}
function findDocPath(dp, file) {
  const base = path.basename(file);
  for (const e of fs.readdirSync(dp)) {
    if (/^round\d+$/.test(e) && fs.existsSync(path.join(dp, e, base))) return path.join(dp, e, base);
  }
  return fs.existsSync(path.join(dp, base)) ? path.join(dp, base) : null;
}
function readRunEvents(dp, since) {
  const name = path.basename(dp);
  if (RUNS[name]) return RUNS[name].events.slice(since || 0);
  try {
    return fs.readFileSync(path.join(dp, '_analysis', 'run.events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(since || 0);
  } catch { return []; }
}

// ---------- HTTP ----------
function json(res, code, obj) {
  if (res.headersSent) { try { res.end(); } catch {} return; } // SSE 路由中途出錯時不能再寫 header
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req, limit = 220 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(httpErr(413, 'too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = u.searchParams;
  try {
    // Local APIs may be called by the workbench or a local CLI, never by a foreign web origin.
    if(u.pathname.startsWith('/api/')) {
      const host=req.headers.host;
      if(![`127.0.0.1:${PORT}`,`localhost:${PORT}`].includes(host))throw httpErr(403,'不接受此工作台網址');
      if((req.headers.origin && req.headers.origin!==`http://${host}`)||req.headers['sec-fetch-site']==='cross-site')throw httpErr(403,'不接受其他網站存取本機工作台');
    }
    // ---- API ----
    if (u.pathname === '/api/deals') {
      const deals = fs.readdirSync(ROOT).filter(isDealName).map(dealSummary);
      return json(res, 200, { root: ROOT, mock: MOCK, deals });
    }
    if (u.pathname === '/api/deal') {
      return json(res, 200, dealDetail(q.get('name')));
    }
    if (u.pathname === '/api/card') {
      const dp = dealPath(q.get('deal'));
      const cf = findCard(dp, path.basename(q.get('file') || ''));
      if (!cf) return json(res, 404, { error: 'no card' });
      const f = safeJoin(path.join(dp, '_analysis', 'cards'), cf);
      return json(res, 200, { file: q.get('file'), content: fs.readFileSync(f, 'utf8') });
    }
    if (u.pathname === '/api/engine') {
      return json(res, 200, {
        cli: CLI ? CLI.version : null, cliPath: CLI ? CLI.bin : null, mock: MOCK, token: !!readToken(),
        api: !!(process.env.OPENAI_API_KEY || readToken()), askModel: ASK_MODEL, askEffort: ASK_EFFORT, askBudget: ASK_BUDGET, askMaxInputBytes: chat.MAX_INPUT_BYTES, retrieval: 'local-fts5', sdk: true,
      });
    }
    if (u.pathname === '/api/token' && req.method === 'POST') {
      const { token } = JSON.parse(await readBody(req));
      const t = String(token || '').replace(/\s+/g, '');
      if (!t) throw httpErr(400, 'token 不可為空');
      if (!/^sk-/.test(t) || /^sk-ant-/.test(t)) throw httpErr(400, '請提供 OpenAI API key；不接受其他供應商的 token');
      fs.writeFileSync(path.join(__dirname, 'token'), t, { mode: 0o600 });
      return json(res, 200, { ok: true });
    }

    // ---- 寫入操作 ----
    if (u.pathname === '/api/reviewlog') {
      const dp = dealPath(q.get('deal'));
      const round = Number(q.get('round')) || 1;
      const dir = path.join(dp, '_analysis', 'diff-reports');
      let latest = null;
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(f => f.startsWith(`review-r${round}-`)).sort();
        if (files.length) latest = files[files.length - 1];
      }
      if (!latest) return json(res, 200, { decisions: {} });
      const decisions = {};
      let last = null;
      for (const line of fs.readFileSync(path.join(dir, latest), 'utf8').split('\n')) {
        const m = line.match(/^- Q(\d+)：(保留|刪除)(?:（(.+?)）)?/);
        if (m) { last = m[1]; decisions[last] = { keep: m[2] === '保留', reason: m[3] || '' }; continue; }
        const e = line.match(/^\s+- 編輯後：(.+)$/);
        if (e && last) decisions[last].edited = e[1];
      }
      return json(res, 200, { decisions, file: latest });
    }
    if (u.pathname === '/api/roundname' && req.method === 'POST') {
      const { deal, round, name } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      st.roundNames = st.roundNames || {};
      if (name && name.trim()) st.roundNames[round] = name.trim().slice(0, 20);
      else delete st.roundNames[round];
      writeState(dp, st);
      return json(res, 200, { state: st });
    }
    if (u.pathname === '/api/star' && req.method === 'POST') {
      const { deal, starred } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      st.starred = !!starred; writeState(dp, st);
      return json(res, 200, { state: st });
    }
    if (u.pathname === '/api/deletecase' && req.method === 'POST') {
      const { deal } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      if (RUNS[deal]) throw httpErr(409, '流程執行中，不能刪除');
      const trash = path.join(ROOT, '_trash');
      fs.mkdirSync(trash, { recursive: true });
      fs.renameSync(dp, path.join(trash, deal + '_' + Date.now()));
      return json(res, 200, { deleted: deal, note: '已移至 _trash/（未硬刪，可手動救回）' });
    }
    if (u.pathname === '/api/reopen' && req.method === 'POST') {
      const { deal } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      st.closed = false; st.lifecycle = st.prevLifecycle || 'collecting';
      delete st.prevLifecycle; writeState(dp, st);
      return json(res, 200, { state: st });
    }
    if (u.pathname === '/api/newcase' && req.method === 'POST') {
      const { name } = JSON.parse(await readBody(req));
      if (!name || /[\/\\]|\.\.|^[._]/.test(name)) throw httpErr(400, '案名不合法');
      const dp = path.join(ROOT, name);
      if (fs.existsSync(dp)) throw httpErr(409, '同名案件已存在');
      for (const d of ['round1', 'round2', 'round3', '_analysis/cards', '_analysis/drafts', '_analysis/diff-reports', '_analysis/_archive', 'qlist'])
        fs.mkdirSync(path.join(dp, d), { recursive: true });
      fs.writeFileSync(path.join(dp, '_notes.md'), '# 案件背景備註\n\n（會議紀錄、口頭情報、Data Room 外的實體與關係 — pipeline 每輪必讀）\n');
      writeState(dp, { ...DEFAULT_STATE });
      return json(res, 200, dealSummary(name));
    }
    if (u.pathname === '/api/upload' && req.method === 'POST') {
      const dp = dealPath(q.get('deal'));
      const round = q.get('round') || String(readState(dp).round);
      if (!/^\d+$/.test(round)) throw httpErr(400, 'bad round');
      const fname = path.basename(q.get('name') || '');
      if (!fname || fname.startsWith('.')) throw httpErr(400, 'bad filename');
      const rd = path.join(dp, 'round' + round);
      fs.mkdirSync(rd, { recursive: true });
      const saved = safeJoin(rd, fname);
      fs.writeFileSync(saved, await readBody(req));
      runIndexer(dp, saved, true); // 上傳即建索引（背景）
      return json(res, 200, { saved: `round${round}/${fname}`, indexing: true });
    }
    if (u.pathname === '/api/reindex' && req.method === 'POST') {
      const { deal, file, force } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const target = file ? findDocPath(dp, file) : null;
      if (file && !target) throw httpErr(404, '找不到文件');
      const r = await runIndexer(dp, target, !!force);
      INDEX_CACHE.clear();
      return json(res, r.code === 0 ? 200 : 500, r);
    }
    if (u.pathname === '/api/index') {
      const dp = dealPath(q.get('deal'));
      const meta = indexMeta(dp);
      const docs = listDocs(dp).map(d => ({ name: d.name, round: d.round, index: d.index, indexing: d.indexing }));
      const total = Object.values(meta).reduce((s,d)=>s+Math.ceil((d.total_chars||0)/3),0);
      return json(res, 200, { docs, totalTokens: total, budget: ASK_BUDGET, wholeCorpus: false });
    }
    if (u.pathname === '/api/page') {
      const dp = dealPath(q.get('deal'));
      const file = path.basename(q.get('file') || '');
      const d = loadIndex(dp, file);
      if (!d) return json(res, 404, { error: '尚未索引（上傳後自動建立；或按「重建索引」）' });
      if (d.kind === 'xlsx') {
        const sheet = q.get('sheet');
        const s = (d.sheets || []).find(x => x.name === sheet) || (d.sheets || [])[0];
        return json(res, 200, { file, round: d.round, kind: 'xlsx', sheets: (d.sheets || []).map(x => x.name), sheet: s ? { name: s.name, dims: s.dims, cells: s.cells, truncated: s.truncated } : null });
      }
      const n = Math.max(1, Number(q.get('page')) || 1);
      const p = (d.pages || [])[n - 1];
      if (!p) return json(res, 404, { error: `沒有第 ${n} 頁（共 ${d.page_count} 頁）` });
      return json(res, 200, { file, round: d.round, kind: d.kind, page: n, page_count: d.page_count, text: p.text, needs_ocr: !!p.needs_ocr, chars: p.chars });
    }
    if (u.pathname === '/api/facts') {
      const dp = dealPath(q.get('deal'));
      const fj = readFactsJson(dp);
      return json(res, 200, fj || { facts: [], docs: {} });
    }
    if (u.pathname === '/api/runevents') {
      const dp = dealPath(q.get('deal'));
      const since = Number(q.get('since')) || 0;
      const run = RUNS[q.get('deal')];
      return json(res, 200, { running: !!run, kind: run ? run.kind : null, counts: run ? run.counts : null, started: run ? run.started : null, events: readRunEvents(dp, since) });
    }
    if (u.pathname === '/api/ingest-one' && req.method === 'POST') {
      const { deal, file, round, model } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      const rel = /^R\d+$/.test(round || '') ? `round${round.slice(1)}/${path.basename(file)}` : path.basename(file);
      if (!fs.existsSync(path.join(dp, rel))) throw httpErr(404, '找不到文件');
      const prompt = `只消化 X（單檔增量）：案子「${deal}」Round ${st.round}，新文件「${deal}/${rel}」。照本專案 AGENTS.md 執行：(1) 先確認 _analysis/index/ 有此檔索引（沒有就跑 python3 _workbench/index_doc.py "${deal}" --file "${rel}"）；(2) 派 card-extractor 只為這一份文件產字卡（檔名＝原始檔名＋.md，存 _analysis/cards/）；(3) 派 reconciler 做「增量」對帳：讀既有 _analysis/facts.json 與 facts.md，只加入與此文件相關的事實列與新矛盾（同物異名對齊、口徑分 basis、有公式的填 derived），執行 python3 _workbench/recompute.py "${deal}"，更新 facts.json 與 facts.md；(4) 依新矛盾與新事實出 3–6 題（可直接由你出，或派需要的 persona），寫入「${deal}/_analysis/drafts/draft_R${st.round}_delta.md」，表格表頭必須逐字為：| No. | 分類 | 問題 | 出處與動機 | 書面/口頭 | 波次 | 證據 |，No. 自 901 起連號，出處與動機寫檔名＋頁碼/tab＋引用數字＋一句白話動機，證據欄寫機讀引用（文件代號:位置，分號分隔）；(5) 完成即結束，只回報一行摘要。記得先讀「${deal}/_notes.md」。`;
      startRun(deal, 'ingest', prompt, null, model);
      return json(res, 200, { started: true, file: rel });
    }
    if (u.pathname === '/api/archive' && req.method === 'POST') {
      const { deal, file, round } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const dir = round && round.startsWith('R') ? path.join(dp, 'round' + round.slice(1)) : dp;
      const src = safeJoin(dir, path.basename(file));
      if (!fs.existsSync(src)) throw httpErr(404, 'file not found');
      const arch = path.join(dp, '_analysis', '_archive');
      fs.mkdirSync(arch, { recursive: true });
      fs.renameSync(src, safeJoin(arch, Date.now() + '_' + path.basename(file)));
      return json(res, 200, { archived: file });
    }
    if (u.pathname === '/api/setcat' && req.method === 'POST') {
      const { deal, file, cat } = JSON.parse(await readBody(req));
      if (!CATS.includes(cat)) throw httpErr(400, 'bad category');
      const dp = dealPath(deal);
      const m = readCats(dp);
      m[path.basename(file)] = cat;
      fs.mkdirSync(path.join(dp, '_analysis'), { recursive: true });
      fs.writeFileSync(path.join(dp, '_analysis', 'doc-categories.json'), JSON.stringify(m, null, 2));
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/api/myversion' && req.method === 'POST') {
      const dp = dealPath(q.get('deal'));
      const fname = path.basename(q.get('name') || 'my-qlist.xlsx');
      const inbox = path.join(dp, '_analysis', 'inbox');
      fs.mkdirSync(inbox, { recursive: true });
      fs.writeFileSync(safeJoin(inbox, fname), await readBody(req));
      return json(res, 200, { saved: fname });
    }
    if (u.pathname === '/api/merge' && req.method === 'POST') {
      const { deal, name, model } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      const fname = path.basename(name || '');
      if (!fs.existsSync(path.join(dp, '_analysis', 'inbox', fname))) throw httpErr(404, '找不到你上傳的版本');
      const prompt = `合併審核前置：案子「${deal}」Round ${st.round}。使用者的 Q-list 在「${deal}/_analysis/inbox/${fname}」（用 python3＋openpyxl 讀）。引擎草稿在「${deal}/_analysis/drafts/draft_R${st.round}.md」。照本專案 AGENTS.md 階段 2 做三類 diff：(1) 兩邊都問到（語意相同即算，措辭合併取較佳、number-anchored 版本優先）→ 來源標「共識」；(2) 只有引擎 → 來源標「Codex」；(3) 只有使用者 → 來源標「你」，一律保留，並在 _analysis/diff-reports/blindspots-r${st.round}.md 記錄為盲區訓練資料。輸出寫入「${deal}/_analysis/drafts/draft_R${st.round}_merged.md」，表格表頭必須逐字為：| No. | 分類 | 問題 | 來源 | 出處與動機 | 書面/口頭 | 波次 |（來源欄只能是「共識」「Codex」「你」三值之一），排序：共識在前、你的獨有題次之、Codex 獨有題最後。出處與動機欄必須完整可讀：資料來源寫檔名＋頁碼或 tab，加一句白話動機，不得只寫代號；使用者題目的動機用推測並標「（推測）」。完成即結束。`;
      startRun(deal, 'merge', prompt, null, model);
      return json(res, 200, { started: true });
    }
    if (u.pathname === '/api/notes' && req.method === 'POST') {
      const { deal, content } = JSON.parse(await readBody(req));
      fs.writeFileSync(path.join(dealPath(deal), '_notes.md'), String(content || ''));
      return json(res, 200, { ok: true });
    }

    // ---- 引擎 ----
    if (u.pathname === '/api/distill' && req.method === 'POST') {
      const { deal, model } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const prompt = `結案蒸餾：案子「${deal}」。照本專案 AGENTS.md 的階段 4 執行：讀取「${deal}/_analysis/diff-reports/」全部審核與差異紀錄、「${deal}/_analysis/drafts/」、「${deal}/qlist/」歷輪最終發出版、以及 _notes.md。把新 pattern（含同事題抽象化：方向＋深度＋問法）、反面規則寫回「knowledge/question-bank.md」— 僅保存抽象化通則，不得含本案名稱、profile、數字或交易條件；案件細節留在案件蒸餾報告。用追加與合併，絕不刪除既有內容。動機推不出來的題目列成「待標註」清單，連同蒸餾摘要寫入「${deal}/_analysis/distill-report.md」。完成後即結束。`;
      startRun(deal, 'distill', prompt, () => memory.syncDistilled(), model);
      return json(res, 200, { started: true });
    }
    if (u.pathname === '/api/run' && req.method === 'POST') {
      const { deal, model } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      if (st.closed) throw httpErr(400, '案件已結案');
      const followup = st.round <= 1 ? '' : `這是第 ${st.round} 輪追問，多兩件必做的事：(A) 上輪回覆判定：讀「${deal}/qlist/」內上一輪最終發出版，以及「${deal}/round${st.round}/」內對方回覆的 Q-list xlsx（檔名通常含「回覆」或「Qlist」，用 python3＋openpyxl 讀回答欄），逐題判定：完整回答／部分回答／迴避／與其他資料矛盾，判定表寫入「${deal}/_analysis/reply-judgment-r${st.round - 1}.md」；後三種進本輪追問，題目中要引用對方的原回覆再往下追。(B) 新文件做增量消化並更新 facts.md，新舊矛盾（含版本 diff）為最高優先出題來源。`;
      const prompt = `跑 Round ${st.round}：案子「${deal}」。照本專案 AGENTS.md 的 pipeline 執行階段 1a（盤點缺件、文件字卡、跨文件對帳）與階段 1b（四 persona 出題、匯整），本輪文件在「${deal}/round${st.round}/」；記得先讀「${deal}/_notes.md」。${followup}產出寫入「${deal}/_analysis/drafts/draft_R${st.round}.md」，表格表頭必須逐字為：| No. | 分類 | 問題 | 出處與動機 | 書面/口頭 | 波次 |。硬性規範：(1) 每份文件的字卡檔名必須與原始檔名完全相同再加 .md（例：「Acme_Robotics_FY2025_Annual_Report_Full.pdf.md」），存「${deal}/_analysis/cards/」；(2) facts.md 的缺件盤點用分行列點（已收一行一項、缺件一行一項）；(3) 出處與動機欄完整可讀：檔名＋頁碼/tab＋引用數字＋一句白話動機，禁用內部代號；(4) 分類欄保持乾淨（如「財務面」「股權面」），不要夾帶「（敏感·口頭）」等通路註記——本團隊一律書面詢問，敏感題以波次 2 表達即可。完成後即結束。`;
      startRun(deal, 'pipeline', prompt, () => {
        const s = readState(dp);
        if (fs.existsSync(path.join(dp, '_analysis', 'drafts', `draft_R${s.round}.md`))) {
          s.lifecycle = 'drafted'; writeState(dp, s);
        }
      }, model);
      return json(res, 200, { started: true });
    }
    if (u.pathname === '/api/runlog') {
      const dp = dealPath(q.get('deal'));
      let log = '';
      try { log = fs.readFileSync(path.join(dp, '_analysis', 'run.log'), 'utf8'); } catch {}
      const lines = log.split('\n');
      return json(res, 200, { running: !!RUNS[q.get('deal')], log: lines.slice(-200).join('\n') });
    }

    // ---- 審核 ----
    if (u.pathname === '/api/draft') {
      const dp = dealPath(q.get('deal'));
      const st = readState(dp);
      const round = Number(q.get('round')) || st.round;
      const merged = path.join(dp, '_analysis', 'drafts', `draft_R${round}_merged.md`);
      const plain = path.join(dp, '_analysis', 'drafts', `draft_R${round}.md`);
      const f = fs.existsSync(merged) ? merged : plain;
      const delta = path.join(dp, '_analysis', 'drafts', `draft_R${round}_delta.md`);
      if (!fs.existsSync(f) && !fs.existsSync(delta)) return json(res, 200, { round, merged: false, questions: [] });
      const isMerged = f === merged;
      const rows = fs.existsSync(f) ? parseDraftTable(fs.readFileSync(f, 'utf8'), isMerged) : [];
      if (fs.existsSync(delta)) for (const r of parseDraftTable(fs.readFileSync(delta, 'utf8'), false)) rows.push({ ...r, delta: true });
      return json(res, 200, { round, merged: isMerged, questions: rows, hasDelta: fs.existsSync(delta) });
    }
    if (u.pathname === '/api/review' && req.method === 'POST') {
      const { deal, decisions } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      const ts = new Date().toISOString().slice(0, 10);
      const rep = ['# 合併審核紀錄 — Round ' + st.round + '（' + ts + '）', ''];
      for (const d of decisions) {
        rep.push(`- Q${d.no}：${d.keep ? '保留' : '刪除'}${d.reason ? '（' + d.reason + '）' : ''}${d.editedText ? '\n  - 編輯後：' + d.editedText : ''}`);
      }
      const repDir = path.join(dp, '_analysis', 'diff-reports');
      fs.mkdirSync(repDir, { recursive: true });
      fs.writeFileSync(path.join(repDir, `review-r${st.round}-${ts}.md`), rep.join('\n') + '\n');
      // 產 merged xlsx
      const header = ['No.', '問題提出日期', '問題分類', '問題', '回答/回覆', '保留', '砍題原因', '出處與動機（內部欄，發出前移除）'];
      const rows = [header];
      let n = 0;
      for (const d of decisions) {
        n++;
        rows.push([n, ts, d.cat || '', d.editedText || d.q || '', '', d.keep ? 'V' : '', d.reason || '', d.why || '']);
      }
      const out = path.join(dp, '_analysis', 'drafts', `${deal}_merged Qlist_R${st.round}.xlsx`);
      await new Promise((resolve, reject) => {
        const py = spawn('python3', [path.join(__dirname, 'make_xlsx.py')]);
        let err = '';
        py.stderr.on('data', d => err += d);
        py.on('close', c => c === 0 ? resolve() : reject(httpErr(500, 'xlsx 產生失敗: ' + err.slice(0, 300))));
        py.stdin.write(JSON.stringify({ path: out, rows, sheet: 'Q-list' }));
        py.stdin.end();
      });
      st.lifecycle = 'merged'; writeState(dp, st);
      return json(res, 200, { xlsx: `${deal}_merged Qlist_R${st.round}.xlsx` });
    }
    if (u.pathname === '/api/download') {
      const dp = dealPath(q.get('deal'));
      let where;
      if (q.get('from') === 'qlist') where = path.join(dp, 'qlist');
      else if (q.get('from') === 'doc') {
        const r = q.get('round') || '';
        where = /^R\d+$/.test(r) ? path.join(dp, 'round' + r.slice(1)) : dp;
      } else where = path.join(dp, '_analysis', 'drafts');
      const f = safeJoin(where, path.basename(q.get('file') || ''));
      if (!fs.existsSync(f)) throw httpErr(404, 'file not found');
      const INLINE = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.bmp':'image/bmp', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
      const ct = INLINE[path.extname(f).toLowerCase()];
      res.writeHead(200, {
        'Content-Type': ct || 'application/octet-stream',
        'Content-Disposition': `${ct ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(f))}`,
      });
      return fs.createReadStream(f).pipe(res);
    }
    if (u.pathname === '/api/preview') {
      const dp = dealPath(q.get('deal'));
      const r = q.get('round') || '';
      const where = /^R\d+$/.test(r) ? path.join(dp, 'round' + r.slice(1)) : dp;
      const f = safeJoin(where, path.basename(q.get('file') || ''));
      if (!fs.existsSync(f)) throw httpErr(404, 'file not found');
      if (path.extname(f).toLowerCase() !== '.xlsx') throw httpErr(400, '預覽僅支援 xlsx');
      const out = await new Promise((resolve, reject) => {
        const py = spawn('python3', [path.join(__dirname, 'read_xlsx.py'), f]);
        let buf = '', err = '';
        py.stdout.on('data', d => buf += d);
        py.stderr.on('data', d => err += d);
        py.on('error', reject);
        py.on('close', c => c === 0 ? resolve(buf) : reject(httpErr(500, 'xlsx 讀取失敗: ' + err.slice(0, 300))));
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(out);
    }

    // ---- 生命週期 ----
    if (u.pathname === '/api/final' && req.method === 'POST') {
      const dp = dealPath(q.get('deal'));
      const fname = path.basename(q.get('name') || 'final.xlsx');
      const qd = path.join(dp, 'qlist');
      fs.mkdirSync(qd, { recursive: true });
      fs.writeFileSync(safeJoin(qd, fname), await readBody(req));
      const st = readState(dp);
      if (!st.sentRounds.includes(st.round)) st.sentRounds.push(st.round);
      st.lifecycle = 'sent'; st.sentAt = new Date().toISOString(); writeState(dp, st);
      // 每輪蒸餾：最終版一到就自動跑（引擎忙碌時跳過，可稍後手動 ⚗）
      let distill = false;
      if (!RUNS[q.get('deal')]) {
        try {
          const prompt = `本輪蒸餾：案子「${q.get('deal')}」Round ${st.round}。照 AGENTS.md 階段 4 的增量版執行：(1) 讀「${q.get('deal')}/_analysis/diff-reports/」本輪審核紀錄（砍題原因→反面規則、編輯對→措辭規則）；(2) 用 python3＋openpyxl 比對「${q.get('deal')}/qlist/${fname}」（最終發出版）與「${q.get('deal')}/_analysis/drafts/」本輪合併版 — 同事新增的題記為盲區並抽象化 pattern、修改的題記措辭差異；(3) 增量寫回「knowledge/question-bank.md」（追加與合併，絕不刪既有內容）；(4) 蒸餾摘要與「待標註」清單寫入「${q.get('deal')}/_analysis/distill-report-r${st.round}.md」。完成即結束。`;
          startRun(q.get('deal'), 'round-distill', prompt, () => memory.syncDistilled(), q.get('model'));
          distill = true;
        } catch {}
      }
      return json(res, 200, { saved: 'qlist/' + fname, state: st, distill });
    }
    if (u.pathname === '/api/advance' && req.method === 'POST') {
      const { deal } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      if (st.lifecycle !== 'sent') throw httpErr(400, '本輪最終版尚未發出，不能開下一輪');
      st.round += 1; st.lifecycle = 'collecting';
      fs.mkdirSync(path.join(dp, 'round' + st.round), { recursive: true });
      writeState(dp, st);
      return json(res, 200, { state: st });
    }
    if (u.pathname === '/api/close' && req.method === 'POST') {
      const { deal } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      st.prevLifecycle = st.lifecycle;
      st.closed = true; st.lifecycle = 'closed'; writeState(dp, st);
      return json(res, 200, { state: st });
    }

    // ---- 搜尋＋問 AI ----
    if (u.pathname === '/api/search') {
      const dp = dealPath(q.get('deal'));
      const needle = (q.get('q') || '').toLowerCase();
      if (!needle) return json(res, 200, { hits: [] });
      const found=await chat.retrieval(dp,{op:'search',query:needle});
      const hits=found.matches.map(m=>({src:`${m.kind==='metadata'?'AI 導覽／描述':'內容'} · ${m.file} · ${m.location}`,text:m.snippet,evidenceId:m.id}));
      return json(res, 200, { hits, warnings: found.warnings });
    }
    if(u.pathname==='/api/memory/status'){const deal=q.get('deal');dealPath(deal);const id=q.get('conversation');const job=memory.jobs(deal).filter(j=>j.conversationId===id).at(-1);return json(res,200,{status:job?.status||'none'});}
    if (u.pathname === '/api/memory') {
      memory.syncDistilled();
      if(req.method==='GET') {const scope=q.get('scope');memory.dir(scope);return json(res,200,{entries:memory.list(scope),jobs:memory.jobs(scope).map(j=>({id:j.id,status:j.status,error:j.error}))});}
      const b=JSON.parse(await readBody(req,16000));memory.dir(b.scope);
      if(req.method==='DELETE'){memory.remove(b.scope,b.id,b.revision);return json(res,200,{ok:true});}
      if(req.method!=='POST')throw httpErr(405,'method not allowed');
      return json(res,200,memory.save(b.scope,{title:b.title,content:b.content,status:b.status,kind:b.scope==='global'?'rule':'note'},{id:b.id,revision:b.revision}));
    }
    if (u.pathname === '/api/memory/retry' && req.method==='POST') {const b=JSON.parse(await readBody(req,16000));dealPath(b.deal);memory.retry(b.deal);runMemoryJobs();return json(res,200,{ok:true});}
    if (u.pathname === '/api/conversation/memory' && req.method==='POST') {
      const b=JSON.parse(await readBody(req,16000)),dp=dealPath(b.deal),c=chat.read(dp,b.id);
      if(chat.locks.has(chat.fileFor(dp,c.id)))throw httpErr(409,'請等這輪回答完成再調整記憶');
      const selected=memory.scopes(b.deal,b.projects).filter(s=>s!=='global'&&s!==b.deal);
      if(JSON.stringify(selected.slice().sort())!==JSON.stringify((c.memoryProjects||[]).slice().sort()))c.memoryVersion=(c.memoryVersion||0)+1;
      c.memoryProjects=selected;chat.save(dp,c);return json(res,200,c);
    }
    if (u.pathname === '/api/conversations') {
      if (req.method === 'POST') {
        const body=JSON.parse(await readBody(req, 16000));
        const dp=dealPath(body.deal),projects=memory.scopes(body.deal,body.memoryProjects||[]).filter(s=>s!=='global'&&s!==body.deal),c=chat.create(dp);c.memoryProjects=projects;chat.save(dp,c);return json(res,200,c);
      }
      return json(res,200,{conversations:chat.list(dealPath(q.get('deal')))});
    }
    if (u.pathname === '/api/conversation') return json(res,200,chat.read(dealPath(q.get('deal')),q.get('id')));
    if (u.pathname === '/api/evidence') {
      const result=await chat.retrieval(dealPath(q.get('deal')),{op:'read',id:q.get('id')});
      return json(res,result.error?404:200,result);
    }
    if (u.pathname === '/api/ask' && req.method === 'POST') {
      const body=JSON.parse(await readBody(req, 16000));
      const dp=dealPath(body.deal);
      const question=typeof body.question==='string'?body.question.trim():'';
      if (!question || Buffer.byteLength(question)>6000) throw httpErr(400,'問題不可空白，且不得超過 6000 bytes');
      const conversation=body.conversationId?chat.read(dp,body.conversationId):chat.create(dp);
      if (chat.locks.has(chat.fileFor(dp,conversation.id))) throw httpErr(409,'此對話仍在回覆中');
      const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort()});
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
      const send=e=>{if(!res.destroyed)res.write('data: '+JSON.stringify(e)+'\n\n')};
      const apiKey=process.env.OPENAI_API_KEY||readToken();
      await chat.run({dp,conversation,question,model:ASK_MODEL,effort:ASK_EFFORT,
        client:apiKey?new OpenAI({apiKey,maxRetries:0,timeout:90000}):null,
        mock:MOCK,memory,send,signal:abort.signal});
      res.end();
      if(!MOCK&&conversation.messages.at(-1)?.status==='completed'&&!conversation.messages.at(-1)?.memoryProposals?.length){memory.enqueue(body.deal,conversation);setImmediate(runMemoryJobs);}
      return;
    }
    // ---- 靜態 ----
    let p = u.pathname === '/' ? '/index.html' : u.pathname;
    const fp = safeJoin(PUB, '.' + p);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      return fs.createReadStream(fp).pipe(res);
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Pipeline DD 工作台 http://127.0.0.1:${PORT}  root=${ROOT}  mock=${MOCK}`));

setImmediate(runMemoryJobs);
