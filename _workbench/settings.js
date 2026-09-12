'use strict';
const fs = require('node:fs');
const path = require('node:path');
const PERSONAS = ['fin', 'ops', 'ind', 'ic', 'tech', 'legal', 'model', 'people'];
const DEFAULTS = {
  provider: 'codex', cost_mode: false, personas: PERSONAS.slice(0, 4),
  claude: { main_model: 'claude-fable-5-1', sub_model: 'claude-opus-5', cheap_model: 'claude-sonnet-5', effort: {main:'medium', sub:'medium', reviewer:'high', mechanical:'low'}, ask_model:'claude-opus-5', ask_effort:'low', ask_budget_tokens:450000 },
  codex: { main_model:'gpt-6-astra', sub_model:'gpt-6-sol', cheap_model:'gpt-6-sol', effort:{main:'medium', sub:'medium', reviewer:'high', mechanical:'low'}, ask_model:'gpt-6-astra', ask_effort:'low', ask_budget_tokens:150000 },
  agents: Object.fromEntries([['card-extractor','mechanical'],['qc-sampler','mechanical'],['question-reviewer','reviewer'],['reconciler','sub'],['distiller','sub'],...PERSONAS.map(p=>['persona-'+p,'sub'])].map(([n,tier])=>[n,{tier}]))
};
const FILE = path.join(__dirname, 'settings.json');
function invalid(message) { throw Object.assign(new Error(message), {status:400}); }
function validate(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) invalid('設定必須是物件');
  if (!['codex','claude'].includes(s.provider)) invalid('provider 只能為 codex 或 claude');
  if (typeof s.cost_mode !== 'boolean') invalid('cost_mode 必須為布林值');
  if (!Array.isArray(s.personas) || !s.personas.length || new Set(s.personas).size !== s.personas.length || s.personas.some(p=>!PERSONAS.includes(p))) invalid('persona 名單不合法');
  const model = v => { if (typeof v !== 'string' || !v.trim() || v.length>200 || /[\x00-\x1f]/.test(v)) invalid('模型必須為非空字串'); };
  const effort = v => { if (!['low','medium','high'].includes(v)) invalid('effort 只能為 low、medium、high'); };
  for (const p of ['codex','claude']) {
    const c=s[p]; if (!c || !c.effort) invalid('缺少 provider 設定');
    for (const k of ['main_model','sub_model','cheap_model','ask_model']) model(c[k]);
    for (const t of ['main','sub','reviewer','mechanical']) effort(c.effort[t]);
    effort(c.ask_effort);
    if (!Number.isSafeInteger(c.ask_budget_tokens) || c.ask_budget_tokens<1000 || c.ask_budget_tokens>2000000) invalid('問答預算須為 1000–2000000 的整數');
  }
  if (!s.agents || typeof s.agents!=='object' || Array.isArray(s.agents)) invalid('agents 必須為物件');
  for (const [n,a] of Object.entries(s.agents)) {
    if (!Object.hasOwn(DEFAULTS.agents,n) || !a || !['sub','reviewer','mechanical'].includes(a.tier)) invalid('代理或 tier 不合法');
    if (a.model!==undefined) model(a.model);
    if (a.effort!==undefined) effort(a.effort);
  }
  return s;
}
function readSettings() {
  const d=structuredClone(DEFAULTS);
  if (fs.existsSync(FILE)) return validate(JSON.parse(fs.readFileSync(FILE,'utf8')));
  if (process.env.QLIST_PROVIDER) d.provider=process.env.QLIST_PROVIDER;
  if (process.env.QLIST_CODEX_MODEL) d.codex.main_model=process.env.QLIST_CODEX_MODEL;
  if (process.env.QLIST_CODEX_EFFORT) d.codex.effort.main=process.env.QLIST_CODEX_EFFORT;
  return validate(d);
}
function writeSettings(s) { validate(s); fs.writeFileSync(FILE+'.tmp',JSON.stringify(s,null,2)+'\n'); fs.renameSync(FILE+'.tmp',FILE); return s; }
function resolveAgent(s,p,n) {
  const c=s[p], a=s.agents[n]||DEFAULTS.agents[n], tier=a?.tier||'main';
  return {model:a?.model||(tier==='main'?c.main_model:(tier==='mechanical'&&s.cost_mode?c.cheap_model:c.sub_model)), effort:a?.effort||c.effort[tier],tier};
}
function matrix(s,p=s.provider) {
  return {main:resolveAgent(s,p,'main'),per_agent:Object.fromEntries(Object.keys(s.agents).filter(n=>!n.startsWith('persona-')||s.personas.includes(n.slice(8))).map(n=>[n,resolveAgent(s,p,n)]))};
}
module.exports={DEFAULTS,PERSONAS,validate,readSettings,writeSettings,resolveAgent,matrix};
