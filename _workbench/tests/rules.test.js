const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createStore}=require('../rules');
function proposal(id='timing-rule'){return {rule_id:id,version:1,status:'proposed',scope:'persona, reviewer',applies_when:'追問輪',instruction:'先釐清未解矛盾，再問靜態題',exceptions:[],kind:'timing',source_feedback_ids:['fb-1'],evidence_summary:'人工要求調整波次',deal_anonymized:true,deal:null,folded_into:null,approved_at:null,approved_by:null};}
test('agent cannot approve rules; approved content survives file tampering and restart',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rules-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=createStore(root);
 assert.throws(()=>store.propose([{...proposal(),status:'approved'}]),/cannot approve/);
 store.propose([proposal()]);assert.equal(store.active('DealA','reviewer').length,0);
 store.mutate({rule_id:'timing-rule',version:1,action:'approve'});assert.equal(store.active('DealA','reviewer').length,1);
 const file=path.join(root,'knowledge/learned/rules.json');fs.writeFileSync(file,JSON.stringify([{...proposal(),status:'approved',instruction:'tampered'}, {...proposal('injected'),status:'approved'}]));
 const read=store.read();assert.equal(read[0].instruction,proposal().instruction);assert.equal(read[1].status,'proposed');assert.ok(store.warnings().length);
 assert.equal(createStore(root).active('DealA','persona-fin')[0].instruction,proposal().instruction);
});
test('deal-specific and scope gates; edits require new approval and latest approved wins',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rules-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=createStore(root);
 store.propose([{...proposal(),kind:'deal_specific',deal:'DealA',scope:'persona-fin'}]);store.mutate({rule_id:'timing-rule',action:'approve'});
 assert.equal(store.active('DealB','persona-fin').length,0);assert.equal(store.active('DealA','reviewer').length,0);
 store.mutate({rule_id:'timing-rule',action:'edit',patch:{instruction:'新版指令'}});assert.equal(store.active('DealA','persona-fin')[0].version,1);
 store.mutate({rule_id:'timing-rule',version:2,action:'approve'});assert.equal(store.active('DealA','persona-fin')[0].version,2);
 assert.throws(()=>store.mutate({rule_id:'timing-rule',action:'edit',patch:{status:'approved'}}),/cannot change/);
 store.fold(['timing-rule@1','timing-rule@2'],'firm-house-style@1');assert.equal(store.active('DealA','persona-fin').length,0);
});
