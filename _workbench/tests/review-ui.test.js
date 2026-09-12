const {test}=require('node:test'),assert=require('node:assert/strict');
const ui=require('../public/review-utils');
test('findings prioritize discrepancies, include unverified items and support text search',()=>{
 const facts=[{id:'A',status:'consistent'},{id:'B',status:'single_source'},{id:'C',status:'unverified',label:'銀行同意'},{id:'D',status:'conflict'}];
 assert.deepEqual(ui.findings(facts,'issues','').map(x=>x.id),['D','C','B']);assert.equal(ui.findings(facts,'unverified','銀行')[0].id,'C');assert.equal(ui.findings(facts,'consistent','').length,1);
});
test('successful exit with MCP diagnostic is distinguished from failed or unfinished run',()=>{
 const diagnostic={kind:'stderr',text:'WARN failed to initialize MCP client during shutdown'};
 assert.equal(ui.runState([diagnostic,{kind:'exit',text:'exit=0'}],false).level,'success');
 assert.equal(ui.runState([diagnostic,{kind:'exit',text:'exit=1'}],false).level,'error');
 assert.equal(ui.runState([{kind:'error',text:'turn failed'},{kind:'exit',text:'exit=0'}],false).level,'error');
 assert.equal(ui.runState([diagnostic],false).level,'unknown');
 assert.equal(ui.runState([diagnostic],true).level,'running');
});
test('recoverable command failures do not override a successful completed pipeline',()=>{
 const events=[{kind:'error',text:'指令 exit=1: rg missing'},{kind:'done',text:'Codex 回合完成'},{kind:'exit',text:'exit=0'}];assert.equal(ui.runState(events,false).level,'success');assert.equal(ui.isDiagnostic(events[0]),true);
});
