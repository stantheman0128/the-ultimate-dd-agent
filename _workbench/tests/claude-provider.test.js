const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const provider=require('../claude-provider');
const settings=require('../settings');
test('Claude events retain parent agent, document page and failed result',()=>{
 const run={agents:{},counts:{agents:0,reads:0,writes:0}};
 let e=provider.parseStreamLine(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:'child',name:'Agent',input:{subagent_type:'card-extractor'}}]}}),run);
 assert.equal(e[0].kind,'spawn');
 e=provider.parseStreamLine(JSON.stringify({type:'assistant',parent_tool_use_id:'child',message:{content:[{type:'tool_use',name:'Read',input:{file_path:'/case/report.pdf',pages:'5-8'}}]}}),run);
 assert.equal(e[0].agent,'card-extractor');assert.equal(e[0].pages,'5-8');
 provider.parseStreamLine(JSON.stringify({type:'result',is_error:true}),run);assert.equal(run.failed,true);
});
test('Claude fake CLI receives selected model and context; failure does not succeed',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'claude-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const script=path.join(dir,'cli.js');fs.writeFileSync(script,`const assert=require('node:assert/strict');let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{assert.ok(input.includes('test evidence'));assert.ok(process.argv.includes('test-model'));process.stdout.write(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'answer'}]}})+'\\n');process.stdout.write(JSON.stringify({type:'result',is_error:process.env.TEST_FAIL==='1',result:'failure',usage:{input_tokens:10}})+'\\n');});`);
 const output=[];const args={cli:{bin:process.execPath,prefix:[script]},cwd:dir,env:process.env,ctx:{text:'test evidence'},question:'what?',system:'cite sources',model:'test-model',send:e=>output.push(e)};
 await provider.askViaCli(args);assert.equal(output[0].delta,'answer');
 await assert.rejects(provider.askViaCli({...args,env:{...process.env,TEST_FAIL:'1'}}),/failure/);
});
test('settings reject invalid provider, effort and persona but permit new model names',()=>{
 const good=structuredClone(settings.DEFAULTS);good.codex.main_model='future-model';settings.validate(good);
 for(const mutate of [s=>s.provider='unknown',s=>s.codex.effort.main='ultra',s=>s.personas=['unknown'],s=>s.codex.ask_budget_tokens=-1]){
  const s=structuredClone(good);mutate(s);assert.throws(()=>settings.validate(s));
 }
 good.agents['card-extractor'].effort='high';assert.equal(settings.matrix(good).per_agent['card-extractor'].effort,'high');
});
