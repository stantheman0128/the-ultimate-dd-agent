'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {MemoryStore}=require('../memory-store');
const {sections}=require('../distilled-memory');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'distilled-'));fs.mkdirSync(path.join(root,'knowledge'));fs.mkdirSync(path.join(root,'case'));const file=path.join(root,'knowledge/question-bank.md');const m=new MemoryStore(root,()=>path.join(root,'case'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {m,file,root};}
const bank='# 通用題庫\n\n| 分類 | 規則 |\n|---|---|\n| 毛利 | 核對營收與成本口徑 |\n| 股權 | 核對股東名簿 |\n';
test('distillation is searchable team context, idempotent across restart and paginated without whole-file injection',t=>{
 const {m,file,root}=fixture(t);fs.writeFileSync(file,bank);m.syncDistilled();assert.equal(m.list('global').length,2);const first=m.list('global');m.syncDistilled();assert.deepEqual(m.list('global'),first);
 const again=new MemoryStore(root,()=>path.join(root,'case'));again.syncDistilled();assert.deepEqual(again.list('global'),first);
 assert.ok(m.context(['global','case'],'營收','').matches.some(x=>x.excerpt.includes('口徑')));assert.equal(m.directory().total,2);
 fs.appendFileSync(file,'\n'+Array.from({length:30},(_,i)=>`- 規則${i}：核對出處。`).join('\n'));m.syncDistilled();assert.equal(m.directory().entries.length,12);assert.equal(m.directory().next,12);
 assert.ok(sections('## 長文\n'+ '中'.repeat(5000)).every(x=>x.content.length<=1800));
});
test('manual overrides survive new distillation with visible conflict and stale revisions are rejected',t=>{
 const {m,file}=fixture(t);fs.writeFileSync(file,bank);m.syncDistilled();let x=m.list('global').find(x=>x.content.includes('毛利'));
 x=m.save('global',{content:'人工修訂：核對成本與期間',status:'active'},{id:x.id,revision:x.revision});assert.ok(x.source.overridden);assert.equal(fs.readFileSync(file,'utf8'),bank);
 fs.writeFileSync(file,bank.replace('核對營收與成本口徑','新增成本查核規則'));m.syncDistilled();const changed=m.get('global',x.id);assert.equal(changed.content,x.content);assert.ok(changed.source.conflict);assert.match(changed.source.original,/新增/);assert.throws(()=>m.save('global',{content:'過期修改'},{id:x.id,revision:x.revision}),/已更新/);
 assert.ok(changed.history.length);assert.ok(m.search(['global'],'人工修訂').length);
});
test('removed source invalidates old context and deleted imports stay deleted on restart',t=>{
 const {m,file,root}=fixture(t);fs.writeFileSync(file,bank);m.syncDistilled();const x=m.list('global').find(x=>x.content.includes('毛利'));m.remove('global',x.id,x.revision);
 const again=new MemoryStore(root,()=>path.join(root,'case'));again.syncDistilled();assert.equal(again.list('global').length,1);
 const generation=again.generation();fs.writeFileSync(file,'');again.syncDistilled();assert.ok(again.generation()>generation);assert.equal(again.search(['global'],'股東').length,0);
});
test('chat proposals are persisted for review without changing shared rules; stale proposals fail',async t=>{
 const {m,file,root}=fixture(t);fs.writeFileSync(file,bank);m.syncDistilled();const entry=m.list('global')[0];
 const chat=require('../project-chat'),dp=path.join(root,'case');fs.mkdirSync(path.join(dp,'_analysis/index'),{recursive:true});
 for(const revision of [entry.revision,entry.revision+1]){
  const c=chat.create(dp);let n=0;const outputs=[];
  const client={responses:{create:async args=>{outputs.push(args);return(async function*(){
   if(n++===0)yield {type:'response.completed',response:{output:[{type:'function_call',call_id:'proposal',name:'propose_memory_update',arguments:JSON.stringify({id:entry.id,revision,content:'修改後規則：核對期間、幣別與成本。'})}],usage:{}}};
   else {yield {type:'response.output_text.delta',delta:'修訂草稿需檢視後套用。'};yield {type:'response.completed',response:{output:[],usage:{}}};}
  })();}}};
  await chat.run({dp,conversation:c,question:'請修改這條團隊通則',memory:m,client,send:()=>{}});
  assert.equal(m.get('global',entry.id).content,entry.content);assert.equal(fs.readFileSync(file,'utf8'),bank);
  if(revision===entry.revision){assert.equal(c.messages.at(-1).memoryProposals.length,1);assert.equal(chat.read(dp,c.id).messages.at(-1).memoryProposals[0].before,entry.content);}
  else assert.match(JSON.stringify(outputs.at(-1)),/記憶已更新/);
 }
});
