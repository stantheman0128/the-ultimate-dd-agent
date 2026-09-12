// Q-List 工作台 — 本地薄殼伺服器（零依賴，Node 18+）
// 資料庫＝專案資料夾本身；本檔只做三件事：讀資料夾狀態、寫資料夾、呼叫 Codex CLI。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const OpenAI = require('openai');
const providers = {codex:require('./codex-provider'),claude:require('./claude-provider')};
const provider=providers.codex;
const settings=require('./settings');
const questions=require('./questions');
const {randomUUID}=require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8765);
const MOCK = process.env.QLIST_MOCK === '1';
const EXCLUDE = new Set(['knowledge']);
const PY = process.env.PYTHON_BIN || 'python3';
// 問 AI（互動層）設定：整份文件帶頁碼進 context，用 prompt caching 固定住；超過預算才挑頁
const ASK_MODEL = process.env.QLIST_ASK_MODEL || provider.DEFAULT_MODEL;
const ASK_EFFORT = process.env.QLIST_ASK_EFFORT || 'low';
const ASK_BUDGET = Number(process.env.QLIST_ASK_BUDGET_TOKENS || 150000); // 估算 token（拉丁字元 /4、CJK ×1.2）；1M context 留餘裕
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
      verification:readCardVerification(dp).cards?.find(c=>c.file===f)||null,
      index: im ? { kind: im.kind, pages: im.page_count || im.sheet_count || 0, needsOcr: im.needs_ocr_pages || 0, chars: im.total_chars || 0, stale: im.mtime !== st.mtimeMs / 1000 && Math.abs(im.mtime - st.mtimeMs / 1000) > 1 } : null,
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
function engineEnv(selected = "codex") {
  const env = { ...process.env };
  const key = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || readToken();
  if (key && selected === "codex") env.CODEX_API_KEY = key;
  return env;
}

function runConfig(override, model) {
  const config=settings.readSettings();
  if(override!==undefined){if(!['codex','claude'].includes(override))throw httpErr(400,'bad provider');config.provider=override;}
  if(model&&model!=='default')config[config.provider].main_model=model;
  settings.validate(config);
  return config;
}
function agentDefinitions(config, runDir) {
  const resolved=settings.matrix(config), definitions={}, agentFiles={};
  for(const [name,choice] of Object.entries(resolved.per_agent)){
    const fp=path.join(ROOT,'.codex','agents',name+'.toml');
    if(!fs.existsSync(fp))continue;
    const raw=fs.readFileSync(fp,'utf8');
    const read=k=>{const m=raw.match(new RegExp('^'+k+' = (.*)$','m'));return m?JSON.parse(m[1]):'';};
    const body=read('developer_instructions');
    definitions[name]={description:read('description'),prompt:body+((name.startsWith('persona-')||name==='question-reviewer')?'\n'+skillsPromptLine(name):''),tools:['Read','Bash','Glob','Grep','Write','Edit'],model:choice.model,effort:choice.effort};
    if(runDir){
      const dir=path.join(runDir,'agents');fs.mkdirSync(dir,{recursive:true});
      const file=path.join(dir,name+'.toml');
      fs.writeFileSync(file,`model = ${JSON.stringify(choice.model)}\nmodel_reasoning_effort = ${JSON.stringify(choice.effort)}\ndeveloper_instructions = ${JSON.stringify(definitions[name].prompt)}\n`);
      agentFiles[name]=file;
    }
  }
  return {definitions,agentFiles};
}
function providerStatus(config,p){
  const cli=providers[p].resolveCli();
  return {cli:cli?.version||null,cliPath:cli?.bin||null,api:p==='codex'?!!(process.env.OPENAI_API_KEY||readToken()):!!process.env.ANTHROPIC_API_KEY,oauth:p==='claude'&&!!process.env.CLAUDE_CODE_OAUTH_TOKEN,models:settings.matrix(config,p)};
}
function askConfig(config) {
  const c=config[config.provider];
  return {model:process.env.QLIST_ASK_MODEL||c.ask_model,effort:process.env.QLIST_ASK_EFFORT||c.ask_effort,budget:Number(process.env.QLIST_ASK_BUDGET_TOKENS||c.ask_budget_tokens)};
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
    INDEX_CACHE.set(ip, { mtimeMs: st.mtimeMs, data });
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
    const d = loadIndex(dp, name);
    if (d) out[name] = { kind: d.kind, page_count: d.page_count, sheet_count: d.sheet_count, needs_ocr_pages: d.needs_ocr_pages, total_chars: d.total_chars, mtime: d.mtime };
  }
  return out;
}
function loadAllIndex(dp) {
  return Object.keys(indexMeta(dp)).map(n => loadIndex(dp, n)).filter(Boolean);
}
// 跑 index_doc.py（單檔或全案）。非同步、不阻塞 HTTP；回傳 promise 供需要等待的路由使用。
function runIndexer(dp, file, force) {
  const args = [path.join(__dirname, 'index_doc.py'), dp];
  if (file) args.push('--file', file);
  if (force) args.push('--force');
  if (file) INDEXING.add(path.isAbsolute(file) ? file : path.join(dp, file));
  return new Promise(resolve => {
    const py = spawn(PY, args, { cwd: ROOT });
    let out = '', err = '';
    py.stdout.on('data', d => out += d);
    py.stderr.on('data', d => err += d);
    py.on('error', e => { err += String(e); });
    py.on('close', code => {
      if (file) INDEXING.delete(path.isAbsolute(file) ? file : path.join(dp, file));
      let parsed = null; try { parsed = JSON.parse(out.trim().split('\n').pop()); } catch {}
      resolve({ code, result: parsed, error: code === 0 ? '' : err.slice(-600) });
    });
  });
}
function readCardVerification(dp) {try{return JSON.parse(fs.readFileSync(path.join(dp,'_analysis','card-verify.json'),'utf8'));}catch{return {cards:[]};}}
function readFactsJson(dp) {
  try { return JSON.parse(fs.readFileSync(path.join(dp, '_analysis', 'facts.json'), 'utf8')); } catch { return null; }
}

// ---------- 方法論 skill 登記（knowledge/skills/<id>/SKILL.md ＋ active.json） ----------
const SKILLS_DIR = path.join(ROOT, 'knowledge', 'skills');
const SKILLS_ACTIVE = path.join(SKILLS_DIR, 'active.json');
function parseFrontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  const fm = {};
  if (m) for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { fm, body: m ? md.slice(m[0].length) : md };
}
function readActiveSkills() {
  try { const a = JSON.parse(fs.readFileSync(SKILLS_ACTIVE, 'utf8')).active; return Array.isArray(a) ? a : []; } catch { return ['vc-senior-qlist']; }
}
function listSkills() {
  const active = new Set(readActiveSkills());
  const out = [];
  if (!fs.existsSync(SKILLS_DIR)) return out;
  for (const id of fs.readdirSync(SKILLS_DIR).sort().filter(id=>!id.startsWith('_'))) {
    const fp = path.join(SKILLS_DIR, id, 'SKILL.md');
    if (!fs.existsSync(fp)) continue;
    const md = fs.readFileSync(fp, 'utf8');
    const { fm, body } = parseFrontmatter(md);
    const refs = fs.existsSync(path.join(SKILLS_DIR, id, 'references')) ? fs.readdirSync(path.join(SKILLS_DIR, id, 'references')).filter(f => !f.startsWith('.')) : [];
    out.push({ id, name: fm.name || id, title: fm.title || fm.name || id, description: fm.description || '', version: fm.version || '', scope: fm.scope || 'persona, reviewer', anonymized: fm.anonymized === 'true', lines: md.split('\n').length, tokens: estTokens(body), refs, active: active.has(id), builtin: id === 'vc-senior-qlist' });
  }
  return out;
}
function scopeMatches(scope, name) {
  const scopes=Array.isArray(scope)?scope:String(scope||'persona, reviewer').replace(/[\[\]"']/g,'').split(/[,，]/).map(x=>x.trim());
  return scopes.includes('all')||scopes.includes(name)||(name.startsWith('persona-')&&scopes.includes('persona'))||(name==='question-reviewer'&&scopes.includes('reviewer'));
}
function skillsPromptLine(scope) {
  const active=listSkills().filter(k=>k.active&&(!scope||scopeMatches(k.scope,scope)));
  return '本案適用方法論：\n'+(active.map(k=>`[${k.id}@${k.version} scope=${k.scope}]\n`+fs.readFileSync(path.join(SKILLS_DIR,k.id,'SKILL.md'),'utf8')).join('\n\n')||'無啟用 skill。');
}

// ---------- 問 AI 的 context 組裝 ----------
function docBlock(d, pageSet) {
  if (d.kind === 'xlsx') {
    const sheets = (d.sheets || []).map(s => {
      const lines = (s.cells || []).map(c => `${c.ref}\t${c.value == null ? '' : c.value}${c.formula ? '\t' + c.formula : ''}`);
      return `<sheet name="${s.name}" dims="${s.dims || ''}"${s.truncated ? ' truncated="true"' : ''}>\n${lines.join('\n')}\n</sheet>`;
    });
    return `<doc file="${d.file}" kind="xlsx" sheets="${(d.sheets || []).length}">\n${sheets.join('\n')}\n</doc>`;
  }
  const pages = (d.pages || []).filter(p => !pageSet || pageSet.has(p.n)).map(p =>
    (p.needs_ocr && !(p.text || '').trim()) ? `<page n="${p.n}" scanned="true"/>` : `<page n="${p.n}">\n${p.text}\n</page>`);
  const note = pageSet ? ` selected="${pages.length}"` : '';
  return `<doc file="${d.file}" kind="${d.kind}" pages="${d.page_count || 0}"${note}>\n${pages.join('\n')}\n</doc>`;
}
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
function questionTerms(q) {
  const terms = new Set();
  for (const m of (q.toLowerCase().match(/[a-z][a-z0-9&\-\.]{1,}/g) || [])) if (m.length >= 2) terms.add(m);
  for (const m of (q.match(/\d[\d,\.]{1,}/g) || [])) terms.add(m.replace(/,/g, ''));
  for (const run of (q.match(/[㐀-鿿]{2,}/g) || [])) for (let i = 0; i + 1 < run.length; i++) terms.add(run.slice(i, i + 2));
  return [...terms];
}
function explicitPages(q) {
  const out = new Set();
  const re = /(?:第\s*(\d{1,4})\s*頁|p\.?\s*(\d{1,4})\b|page\s*(\d{1,4})\b|(\d{1,4})\s*頁)/gi;
  let m; while ((m = re.exec(q))) out.add(Number(m[1] || m[2] || m[3] || m[4]));
  return out;
}
function buildAskContext(dp, question, askBudget = ASK_BUDGET) {
  const docs = loadAllIndex(dp);
  const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const notes = read(path.join(dp, '_notes.md')).trim();
  const facts = read(path.join(dp, '_analysis', 'facts.md')).trim();
  const parts = [];
  if (notes) parts.push(`<notes file="_notes.md">\n${notes}\n</notes>`);
  if (facts) parts.push(`<facts file="_analysis/facts.md">\n${facts.slice(0, 60000)}\n</facts>`);
  const total = docs.reduce((s, d) => s + docChars(d), 0) + estTokens(notes) + estTokens(facts.slice(0, 60000));
  const whole = total <= askBudget;
  let pagesUsed = 0;
  if (whole) {
    for (const d of docs) { parts.push(docBlock(d, null)); pagesUsed += (d.pages || []).length || (d.sheets || []).length; }
  } else {
    // 超過預算：先放明確指到的頁（±1），再依關鍵字命中分數填到預算為止；xlsx 整份放（通常小）
    const q = question || '';
    const terms = questionTerms(q);
    const wantPages = explicitPages(q);
    const mentioned = docs.filter(d => q.includes(d.file.replace(/\.[^.]+$/, '')) || q.includes(d.file));
    let budget = askBudget - estTokens(parts.join('\n'));
    const chosen = new Map(); // file -> Set(page)
    const pcost = p => estTokens(p.text || '') + 12;
    const add = (d, n, cost) => { if (!chosen.has(d.file)) chosen.set(d.file, new Set()); if (!chosen.get(d.file).has(n)) { chosen.get(d.file).add(n); budget -= cost; } };
    for (const d of docs) {
      if (d.kind === 'xlsx') { const c = docChars(d); if (c < budget) { parts.push(docBlock(d, null)); budget -= c; pagesUsed += (d.sheets || []).length; } continue; }
      const scope = mentioned.length ? mentioned.includes(d) : true;
      if (!scope) continue;
      for (const n of wantPages) for (const k of [n - 1, n, n + 1]) { const p = (d.pages || [])[k - 1]; if (p) add(d, k, pcost(p)); }
    }
    const cands = [];
    for (const d of docs) {
      if (d.kind === 'xlsx') continue;
      if (mentioned.length && !mentioned.includes(d)) continue;
      for (const p of d.pages || []) {
        const low = (p.text || '').toLowerCase();
        let score = 0;
        for (const t of terms) { let i = 0, c = 0; while (c < 5 && (i = low.indexOf(t, i)) >= 0) { c++; i += t.length; } score += c * Math.min(t.length, 6); }
        if (score > 0) cands.push({ d, p, score });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands) { if (budget <= 0) break; const cost = pcost(c.p); if (cost <= budget) add(c.d, c.p.n, cost); }
    for (const d of docs) { const set = chosen.get(d.file); if (set && set.size) { parts.push(docBlock(d, set)); pagesUsed += set.size; } }
  }
  const text = `<documents whole_corpus="${whole}">\n${parts.join('\n')}\n</documents>`;
  return { text, docs: docs.length, pages: pagesUsed, whole, totalTokens: total, tokens: estTokens(text) };
}
// Codex JSONL events are adapted to the existing workbench timeline contract.
const parseStreamLine = provider.parseStreamLine;
function mockRun(run, emit, dp, finish) {
  const docs = run.manifest.shards.length?run.manifest.shards.map(s=>({name:s.file+' · part '+s.part+' · 頁 '+s.pages.join('–')})):listDocs(dp);
  const steps = [
    ['init', 'main', '引擎啟動 · model mock · 假引擎模式'],
    ['text','main','載入方法論：'+run.manifest.skills.map(k=>k.id+'@'+k.version).join('、')],
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
function startRun(deal, kind, prompt, onDone, model, selectedProvider, extra = {}) {
  const dp = dealPath(deal);
  if (RUNS[deal]) throw httpErr(409, '本案已有流程在跑');
  fs.mkdirSync(path.join(dp, '_analysis'), { recursive: true });
  const config=runConfig(selectedProvider,model), selected=config.provider, activeProvider=providers[selected], cli=activeProvider.resolveCli();
  if(['pipeline','ingest','merge','review'].includes(kind))prompt=skillsPromptLine()+'\n'+prompt;
  const run_id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
  const runDir=path.join(dp,'_analysis','runs',run_id);fs.mkdirSync(runDir,{recursive:true});
  let shards=[];
  if(['pipeline','ingest'].includes(kind)&&fs.existsSync(path.join(__dirname,'shard_plan.py'))){
    const result=spawnSync(PY,[path.join(__dirname,'shard_plan.py'),dp,...(extra.file?[extra.file]:[])],{encoding:'utf8',maxBuffer:8*1024*1024});
    if(result.status!==0)throw httpErr(500,'分片計画失敗：'+(result.stderr||result.error));
    shards=JSON.parse(result.stdout);
    prompt='大檔分片（每列一次 card-extractor 派工，嚴守 output 與原始頁範圍）：'+JSON.stringify(shards)+'\n'+prompt;
  }
  const models=settings.matrix(config), {definitions,agentFiles}=agentDefinitions(config,runDir);
  const args=activeProvider.cliArgs({model:models.main.model,effort:models.main.effort,writable:true,prompt,system:HEADLESS_SYS,agents:definitions,models:{sub:{model:config[selected].sub_model,effort:config[selected].effort.sub}},agentFiles});
  const manifest={run_id,kind,provider:selected,models,effort:models.main.effort,skills:listSkills().filter(k=>k.active).map(k=>({id:k.id,version:k.version})),rules:[],personas:config.personas,docs:listDocs(dp).map(d=>({file:d.name,mtime:d.mtime})),shards,started_at:new Date().toISOString(),ended_at:null,exit_code:null,cost_if_known:null,mock:MOCK,...extra};
  const saveManifest=()=>fs.writeFileSync(path.join(runDir,'run.json'),JSON.stringify(manifest,null,2)+'\n');
  saveManifest();
  if(['pipeline','ingest','merge'].includes(kind))prompt+=`\nJSON 正本：同步維護 ${deal}/_analysis/drafts/questions_R${readState(dp).round}.json。每題包含 question_id、text、cat、why、evidence:[{doc,loc}]、wave、channel、source、revision、persona。既有題永遠保留 question_id；只修改 revision，新題使用不重複 q-rN-NNN。合併與 delta 都更新同一 JSON，Markdown 是人讀版。`;
  prompt=`執行 ID：${run_id}。persona 名單以此為準：${config.personas.map(p=>'persona-'+p).join('、')}。\n`+prompt;
  const logPath = path.join(dp, '_analysis', 'run.log');
  const evPath = path.join(dp, '_analysis', 'run.events.jsonl');
  fs.writeFileSync(logPath, JSON.stringify({run_id,provider:selected,models,argv:args})+"\n"+prompt+"\n");
  fs.writeFileSync(evPath, '');
  const append = t => { try { fs.appendFileSync(logPath, t); } catch {} };
  const run = { proc: null, kind, started: Date.now(), events: [], agents: {}, counts: { agents: 0, reads: 0, writes: 0 }, timer: null, manifest, config };
  const emit = ev => {
    if(ev.cost!=null)manifest.cost_if_known=ev.cost;
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
    manifest.ended_at=new Date().toISOString();manifest.exit_code=code;
    saveManifest();
    fs.copyFileSync(logPath,path.join(runDir,'run.log'));
    append(`\n[${new Date().toISOString()}] 結束，exit=${code}${code !== 0 ? '　⚠ 流程失敗，請檢查上方訊息（最常見：引擎未登入 → 見說明頁）' : ''}\n`);
    emit({ kind: 'exit', agent: 'main', text: `exit=${code}`, code });
    delete RUNS[deal];
    try { if (code === 0) onDone && onDone(code); } catch {}
  };
  RUNS[deal] = run;
  if (MOCK) { mockRun(run, emit, dp, finish); return; }
  if (!cli) { finish(-1); throw httpErr(500, '找不到 '+selected+' CLI'); }
  const proc = spawn(cli.bin, [...(cli.prefix || []), ...args], { cwd: ROOT, env: engineEnv(selected), stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stdin.on('error', e => { if (e.code !== 'EPIPE') {run.failed=true;emit({ kind: 'error', agent: 'main', text: e.message });} });
  proc.stdin.end(`${HEADLESS_SYS}\n先讀 AGENTS.md 與 CODEX.md；使用同名代理。\n\n${prompt}`);
  run.proc = proc;
  let buf = '';
  proc.stdout.on('data', d => {
    buf += d.toString();
    let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); for (const ev of activeProvider.parseStreamLine(line, run)) emit(ev); }
  });
  proc.stderr.on('data', d => { const t = d.toString(); if (t.trim()) emit({ kind: 'stderr', agent: 'main', text: t.trim().slice(0, 300) }); });
  proc.on('error', e => { emit({ kind: 'error', agent: 'main', text: '⚠ 無法啟動 CLI：' + e.message }); finish(-1); });
  proc.on('close', code => { if (buf.trim()) for (const ev of activeProvider.parseStreamLine(buf, run)) emit(ev); finish(code); });
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
    if (u.pathname === '/api/settings') {
      if(req.method==='GET')return json(res,200,settings.readSettings());
      if(req.method==='POST')return json(res,200,settings.writeSettings(JSON.parse(await readBody(req,100000))));
      throw httpErr(405,'method not allowed');
    }
    if (u.pathname === '/api/runs') {
      const dir=path.join(dealPath(q.get('deal')),'_analysis','runs');
      const runs=fs.existsSync(dir)?fs.readdirSync(dir).sort().reverse().flatMap(id=>{try{return [JSON.parse(fs.readFileSync(path.join(dir,id,'run.json'),'utf8'))];}catch{return [];}}):[];
      return json(res,200,{runs});
    }
    if (u.pathname === '/api/engine') {
      const config=settings.readSettings(), statuses=Object.fromEntries(['codex','claude'].map(p=>[p,providerStatus(config,p)])), selected=statuses[config.provider], ask=askConfig(config);
      return json(res,200,{...selected,provider:config.provider,providers:statuses,mock:MOCK,token:!!readToken(),askModel:ask.model,askEffort:ask.effort,askBudget:ask.budget,sdk:true,skills:readActiveSkills()});
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
      const saved=path.join(dp,'_analysis',`review-state-r${round}.json`);
      if(fs.existsSync(saved))return json(res,200,{decisions:JSON.parse(fs.readFileSync(saved,'utf8'))});
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
      const total = loadAllIndex(dp).reduce((s, d) => s + docChars(d), 0);
      return json(res, 200, { docs, totalTokens: total, budget: ASK_BUDGET, wholeCorpus: total <= ASK_BUDGET });
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
    if (u.pathname === '/api/card-verify') {
      const dp=dealPath(q.get('deal'));let content='';try{content=fs.readFileSync(path.join(dp,'_analysis','card-verify.md'),'utf8');}catch{}
      return json(res,200,{...readCardVerification(dp),content});
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
      const { deal, file, round, model, provider: selectedProvider } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      const rel = /^R\d+$/.test(round || '') ? `round${round.slice(1)}/${path.basename(file)}` : path.basename(file);
      if (!fs.existsSync(path.join(dp, rel))) throw httpErr(404, '找不到文件');
      const prompt = `只消化 X（單檔增量）：案子「${deal}」Round ${st.round}，新文件「${deal}/${rel}」。照本專案 AGENTS.md 執行：(1) 先確認 _analysis/index/ 有此檔索引（沒有就跑 python3 _workbench/index_doc.py "${deal}" --file "${rel}"）；(2) 派 card-extractor 只為這一份文件產字卡（檔名＝原始檔名＋.md，存 _analysis/cards/）；(3) 派 reconciler 做「增量」對帳：讀既有 _analysis/facts.json 與 facts.md，只加入與此文件相關的事實列與新矛盾（同物異名對齊、口徑分 basis、有公式的填 derived），執行 python3 _workbench/recompute.py "${deal}"，更新 facts.json 與 facts.md；(4) 依新矛盾與新事實出 3–6 題（可直接由你出，或派需要的 persona），寫入「${deal}/_analysis/drafts/draft_R${st.round}_delta.md」，表格表頭必須逐字為：| No. | 分類 | 問題 | 出處與動機 | 書面/口頭 | 波次 | 證據 |，No. 自 901 起連號，出處與動機寫檔名＋頁碼/tab＋引用數字＋一句白話動機，證據欄寫機讀引用（文件代號:位置，分號分隔）；(5) 完成即結束，只回報一行摘要。記得先讀「${deal}/_notes.md」。`;
      startRun(deal, 'ingest', prompt, null, model, selectedProvider, {file:path.basename(file)});
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
      const { deal, name, model, provider: selectedProvider } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      const fname = path.basename(name || '');
      if (!fs.existsSync(path.join(dp, '_analysis', 'inbox', fname))) throw httpErr(404, '找不到你上傳的版本');
      const prompt = `合併審核前置：案子「${deal}」Round ${st.round}。使用者的 Q-list 在「${deal}/_analysis/inbox/${fname}」（用 python3＋openpyxl 讀）。引擎草稿在「${deal}/_analysis/drafts/draft_R${st.round}.md」。照本專案 AGENTS.md 階段 2 做三類 diff：(1) 兩邊都問到（語意相同即算，措辭合併取較佳、number-anchored 版本優先）→ 來源標「共識」；(2) 只有引擎 → 來源標「Codex」；(3) 只有使用者 → 來源標「你」，一律保留，並在 _analysis/diff-reports/blindspots-r${st.round}.md 記錄為盲區訓練資料。輸出寫入「${deal}/_analysis/drafts/draft_R${st.round}_merged.md」，表格表頭必須逐字為：| No. | 分類 | 問題 | 來源 | 出處與動機 | 書面/口頭 | 波次 |（來源欄只能是「共識」「Codex」「你」三值之一），排序：共識在前、你的獨有題次之、Codex 獨有題最後。出處與動機欄必須完整可讀：資料來源寫檔名＋頁碼或 tab，加一句白話動機，不得只寫代號；使用者題目的動機用推測並標「（推測）」。完成即結束。`;
      startRun(deal, 'merge', prompt, null, model, selectedProvider);
      return json(res, 200, { started: true });
    }
    if (u.pathname === '/api/notes' && req.method === 'POST') {
      const { deal, content } = JSON.parse(await readBody(req));
      fs.writeFileSync(path.join(dealPath(deal), '_notes.md'), String(content || ''));
      return json(res, 200, { ok: true });
    }

    // ---- 引擎 ----
    if (u.pathname === '/api/distill' && req.method === 'POST') {
      const { deal, model, provider: selectedProvider } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const prompt = `結案蒸餾：案子「${deal}」。照本專案 AGENTS.md 的階段 4 執行：讀取「${deal}/_analysis/diff-reports/」全部審核與差異紀錄、「${deal}/_analysis/drafts/」、「${deal}/qlist/」歷輪最終發出版、以及 _notes.md。把新 pattern（含同事題抽象化：方向＋深度＋問法）、反面規則、per-deal profile 寫回「knowledge/question-bank.md」— 用追加與合併，絕不刪除既有內容。動機推不出來的題目列成「待標註」清單，連同蒸餾摘要寫入「${deal}/_analysis/distill-report.md」。完成後即結束。`;
      startRun(deal, 'distill', prompt, null, model, selectedProvider);
      return json(res, 200, { started: true });
    }
    if (u.pathname === '/api/run' && req.method === 'POST') {
      const { deal, model, provider: selectedProvider } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      if (st.closed) throw httpErr(400, '案件已結案');
      const followup = st.round <= 1 ? '' : `這是第 ${st.round} 輪追問，多兩件必做的事：(A) 上輪回覆判定：讀「${deal}/qlist/」內上一輪最終發出版，以及「${deal}/round${st.round}/」內對方回覆的 Q-list xlsx（檔名通常含「回覆」或「Qlist」，用 python3＋openpyxl 讀回答欄），逐題判定：完整回答／部分回答／迴避／與其他資料矛盾，判定表寫入「${deal}/_analysis/reply-judgment-r${st.round - 1}.md」；後三種進本輪追問，題目中要引用對方的原回覆再往下追。(B) 新文件做增量消化並更新 facts.md，新舊矛盾（含版本 diff）為最高優先出題來源。`;
      const prompt = `跑 Round ${st.round}：案子「${deal}」。照本專案 AGENTS.md 的 pipeline 執行階段 1a（盤點缺件、文件字卡、跨文件對帳）與階段 1b（四 persona 出題、匯整），本輪文件在「${deal}/round${st.round}/」；記得先讀「${deal}/_notes.md」。${followup}產出寫入「${deal}/_analysis/drafts/draft_R${st.round}.md」，表格表頭必須逐字為：| No. | 分類 | 問題 | 出處與動機 | 書面/口頭 | 波次 |。硬性規範：(1) 每份文件的字卡檔名必須與原始檔名完全相同再加 .md（例：「<原始檔名>.pdf.md」），存「${deal}/_analysis/cards/」；(2) facts.md 的缺件盤點用分行列點（已收一行一項、缺件一行一項）；(3) 出處與動機欄完整可讀：檔名＋頁碼/tab＋引用數字＋一句白話動機，禁用內部代號；(4) 分類欄保持乾淨（如「財務面」「股權面」），不要夾帶「（敏感·口頭）」等通路註記——本團隊一律書面詢問，敏感題以波次 2 表達即可。完成後即結束。`;
      startRun(deal, 'pipeline', prompt, () => {
        const s = readState(dp);
        if (fs.existsSync(path.join(dp, '_analysis', 'drafts', `draft_R${s.round}.md`))) {
          s.lifecycle = 'drafted'; writeState(dp, s);
        }
      }, model, selectedProvider);
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
      return json(res,200,questions.load(dp,round,parseDraftTable));
    }
    if (u.pathname === '/api/review' && req.method === 'POST') {
      const { deal, decisions } = JSON.parse(await readBody(req));
      const dp = dealPath(deal);
      const st = readState(dp);
      const current=questions.load(dp,st.round,parseDraftTable).questions;
      const byId=new Map(current.map(q=>[q.question_id,q]));
      if(!Array.isArray(decisions))throw httpErr(400,'decisions must be an array');
      for(const d of decisions){
        d.question_id=d.question_id||current.find(q=>q.no===d.no)?.question_id;
        if(!byId.has(d.question_id))throw httpErr(400,'unknown question_id');
      }
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
      fs.writeFileSync(path.join(dp,'_analysis',`review-state-r${st.round}.json`),JSON.stringify(Object.fromEntries(decisions.map(d=>[d.question_id,{keep:d.keep,reason:d.reason,edited:d.editedText||''} ])),null,2));
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
      const INLINE = { '.pdf': 'application/pdf', '.png': 'image/png', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
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
          startRun(q.get('deal'), 'round-distill', prompt, null, q.get('model'));
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

    // ---- 方法論 skill（knowledge/skills/）----
    if (u.pathname === '/api/skills' && req.method === 'GET') return json(res, 200, { skills: listSkills(), active: readActiveSkills() });
    if (u.pathname === '/api/skills' && req.method === 'POST') {
      // 只有 server 改 active.json；id 必須是實際存在的 skill 資料夾
      const { active } = JSON.parse(await readBody(req));
      const valid = new Set(listSkills().map(k => k.id));
      if(!Array.isArray(active)||active.some(id=>typeof id!=='string'||!valid.has(id)))throw httpErr(400,'未知的 skill id');
      const next = [...new Set(active)];
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
      fs.writeFileSync(SKILLS_ACTIVE, JSON.stringify({ active: next, updated_at: new Date().toISOString(), note: '工作台側欄「方法論」勾選的 skill；派 persona／reviewer 時全文附進派工訊息' }, null, 2) + '\n');
      return json(res, 200, { active: next, skills: listSkills() });
    }
    if (u.pathname === '/api/skills/read') {
      const id = path.basename(q.get('id') || '');
      const fp = path.join(SKILLS_DIR, id, 'SKILL.md');
      if (!id || !fs.existsSync(fp)) throw httpErr(404, '找不到 skill');
      const ref = q.get('ref') ? path.basename(q.get('ref')) : null;
      const target = ref ? path.join(SKILLS_DIR, id, 'references', ref) : fp;
      if (!fs.existsSync(target)) throw httpErr(404, '找不到檔案');
      return json(res, 200, { id, file: ref ? `references/${ref}` : 'SKILL.md', content: fs.readFileSync(target, 'utf8') });
    }
    if (u.pathname === '/api/skills/upload' && req.method === 'POST') {
      // 上傳一份 SKILL.md → knowledge/skills/<id>/SKILL.md；id 取自 ?id（預設檔名去副檔名），只允許安全字元；同名不覆蓋
      const raw = (q.get('id') || path.basename(q.get('name') || 'my-skill').replace(/\.md$/i, ''));
      const id = raw.replace(/[^\w\-一-鿿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      if (!id) throw httpErr(400, 'skill id 不合法');
      const dir = path.join(SKILLS_DIR, id);
      if (fs.existsSync(path.join(dir, 'SKILL.md'))) throw httpErr(409, `已有同名 skill「${id}」，請改名`);
      let md = (await readBody(req, 4 * 1024 * 1024)).toString('utf8');
      if (!/^---\n/.test(md)) md = `---\nname: ${id}\ntitle: ${id}\ndescription: 使用者上傳的方法論\nversion: 1\nscope: persona, reviewer\n---\n\n` + md;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), md);
      const active = [...new Set([...readActiveSkills(), id])];
      fs.writeFileSync(SKILLS_ACTIVE, JSON.stringify({ active, updated_at: new Date().toISOString(), note: '工作台側欄「方法論」勾選的 skill；派 persona／reviewer 時全文附進派工訊息' }, null, 2) + '\n');
      return json(res, 200, { id, active, skills: listSkills() });
    }

    // ---- 搜尋＋問 AI ----
    if (u.pathname === '/api/search') {
      const dp = dealPath(q.get('deal'));
      const needle = (q.get('q') || '').toLowerCase();
      if (!needle) return json(res, 200, { hits: [] });
      // 同義詞放寬：搜「財報」也命中年報/資產負債表/損益表等
      const SYN = [
        ['財報', '年報', '財簽', '財務報表', '資產負債表', '損益表', '現金流量', '自結', 'financial', 'audited', 'balance', 'income'],
        ['股權', 'cap table', 'captable', '股東名簿', '股東', '持股', 'shareholder', 'equity', 'registry'],
        ['章程', '登記', 'incorporation', 'articles'],
        ['合約', 'contract', 'agreement', 'spa', 'sha', 'term sheet'],
        ['簡報', 'deck', 'pitch', '介紹', 'onepager', 'one page'],
        ['財測', 'forecast', '模型', '預估'],
      ];
      let terms = [needle];
      for (const g of SYN) if (g.some(w => needle.includes(w) || w.includes(needle))) terms.push(...g);
      terms = [...new Set(terms.map(s => s.toLowerCase()))];
      const matches = s => { const low = s.toLowerCase(); return terms.some(t => low.includes(t)); };
      const firstIdx = s => { const low = s.toLowerCase(); let best = -1; for (const t of terms) { const i = low.indexOf(t); if (i >= 0 && (best < 0 || i < best)) best = i; } return best; };
      const hits = [];
      for (const doc of listDocs(dp)) {
        if (matches(doc.name))
          hits.push({ src: '文件 · ' + doc.round, line: 0, text: doc.name, doc: { name: doc.name, round: doc.round } });
      }
      // 原文（索引層）：逐頁 / 逐格命中，附頁碼或儲存格，前端可直接開到該處
      let rawHits = 0;
      for (const d of loadAllIndex(dp)) {
        if (rawHits >= 60) break;
        const docRef = { name: d.file, round: d.round };
        if (d.kind === 'xlsx') {
          for (const s of d.sheets || []) for (const c of s.cells || []) {
            if (rawHits >= 60) break;
            const cellText = `${c.value == null ? '' : c.value}${c.formula ? ' ' + c.formula : ''}`;
            if (matches(cellText)) { rawHits++; hits.push({ src: `原文 · ${d.file} · ${s.name}!${c.ref}`, line: 0, text: `${c.ref} = ${cellText}`.slice(0, 300), doc: docRef, sheet: s.name, ref: c.ref }); }
          }
        } else {
          for (const p of d.pages || []) {
            if (rawHits >= 60) break;
            const i = firstIdx(p.text || '');
            if (i < 0) continue;
            rawHits++;
            const snippet = (p.text || '').slice(Math.max(0, i - 110), i + 190).replace(/\s+/g, ' ');
            hits.push({ src: `原文 · ${d.file} · p.${p.n}`, line: 0, text: snippet, doc: docRef, page: p.n });
          }
        }
      }
      const scanFile = (fp, label) => {
        let txt; try { txt = fs.readFileSync(fp, 'utf8'); } catch { return; }
        const lines = txt.split('\n');
        for (let i = 0; i < lines.length && hits.length < 50; i++) {
          if (matches(lines[i])) hits.push({ src: label, line: i + 1, text: lines[i].trim().slice(0, 300) });
        }
      };
      const an = path.join(dp, '_analysis');
      const cardsDir = path.join(an, 'cards');
      if (fs.existsSync(cardsDir)) for (const f of fs.readdirSync(cardsDir)) scanFile(path.join(cardsDir, f), '字卡 · ' + f.replace(/\.md$/, ''));
      for (const f of ['facts.md']) scanFile(path.join(an, f), '對帳表');
      const dr = path.join(an, 'drafts');
      if (fs.existsSync(dr)) for (const f of fs.readdirSync(dr)) if (f.endsWith('.md')) scanFile(path.join(dr, f), '草稿 · ' + f);
      scanFile(path.join(dp, '_notes.md'), '背景備註');
      return json(res, 200, { hits });
    }
    if (u.pathname === '/api/ask' && req.method === 'POST') {
      // SSE 串流：{meta} → {delta}* → {usage} → {done}
      const { deal, question, provider: selectedProvider } = JSON.parse(await readBody(req));
      const config=runConfig(selectedProvider), selected=config.provider, activeProvider=providers[selected], cli=activeProvider.resolveCli(), ask=askConfig(config);
      const dp = dealPath(deal);
      if (!question || !String(question).trim()) throw httpErr(400, '問題不可為空');
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      const send = o => { try { res.write(`data: ${JSON.stringify(o)}\n\n`); } catch {} };
      try {
        const ctx = buildAskContext(dp, question, ask.budget);
        const mode = MOCK ? 'mock' : providerStatus(config,selected).api ? 'api' : (cli ? 'cli' : 'none');
        send({ meta: { mode, provider:selected, model:ask.model, docs: ctx.docs, pages: ctx.pages, chars: ctx.text.length, tokens: ctx.tokens, whole: ctx.whole, totalTokens: ctx.totalTokens, budget: ask.budget } });
        if (mode === 'mock') {
          const fake = `（假引擎）已組好 context：${ctx.docs} 份文件、${ctx.pages} 頁、約 ${ctx.tokens.toLocaleString()} tokens${ctx.whole ? '（整份進 context）' : '（超過預算，已依關鍵字挑頁）'}。正式版會由模型依此回答並標出處，格式 [檔名 p.N]／[檔名 工作表!B4]。`;
          for (const ch of fake.match(/.{1,12}/g)) { send({ delta: ch }); await new Promise(r => setTimeout(r, 25)); }
          send({ mode: 'mock' });
         } else if (mode === 'api') {
          const client=selected==='codex'?new OpenAI({apiKey:process.env.OPENAI_API_KEY||readToken()}):new (require('@anthropic-ai/sdk'))({apiKey:process.env.ANTHROPIC_API_KEY});
          await activeProvider.askViaApi({client,ctx,question,send,system:ASK_SYSTEM,model:ask.model,effort:ask.effort});
        } else if (mode === 'cli') await activeProvider.askViaCli({cli,cwd:ROOT,env:{...engineEnv(selected),QLIST_CODEX_EFFORT:ask.effort},ctx,question,send,system:ASK_SYSTEM,model:ask.model,effort:ask.effort});
        else send({ error: selected+' 未設定 API key，也找不到 CLI' });
      } catch (e) { send({ error: String(e && e.message || e) }); }
      send({ done: true });
      return res.end();
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
if (require.main === module) server.listen(PORT, '127.0.0.1', () => console.log(`Pipeline DD 工作台 http://127.0.0.1:${PORT}  root=${ROOT}  mock=${MOCK}`));

module.exports={server,buildAskContext,parseDraftTable,startRun,runConfig,agentDefinitions};
