'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCliClient}=require('../codex-chat-client');
function fixture(t,mode){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dd-cli-test-')),bin=path.join(dir,'fake.cjs');
  fs.writeFileSync(bin,`const assert=require('node:assert/strict');const args=process.argv.slice(2);assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('features.shell_tool=false'));assert.ok(args.includes('features.plugins=false'));assert.equal(args[args.indexOf('--sandbox')+1],'read-only');let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const req=JSON.parse(input.slice(input.lastIndexOf('\\n')+1));assert.ok(req.input);if(${JSON.stringify(mode)}==='wait'){setInterval(()=>{},1000);return;}if(${JSON.stringify(mode)}==='fail'){console.log(JSON.stringify({type:'turn.failed',error:{message:'not logged in'}}));return;}let value=${JSON.stringify(mode)}==='tool'?{text:'',tool_calls:[{name:'search_documents',arguments_json:'{"query":"revenue","document":""}'}]}:{text:'answer',tool_calls:[]};console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(value)}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:3}}));});`);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return createCliClient({cli:{bin:process.execPath,prefix:[bin]},timeoutMs:2000});
}
const request={model:'test',instructions:'test',input:[],tools:[{name:'search_documents'}],tool_choice:'auto'};
test('CLI chat translates scoped tool requests and final answers',async t=>{
  const events=[];for await(const e of await fixture(t,'tool').responses.create(request))events.push(e);
  assert.equal(events[0].response.output[0].name,'search_documents');
  assert.equal(JSON.parse(events[0].response.output[0].arguments).query,'revenue');
  const answer=[];for await(const e of await fixture(t,'answer').responses.create(request))answer.push(e);
  assert.equal(answer[0].delta,'answer');
});
test('CLI errors and forbidden tool choices never become a completed answer',async t=>{
  await assert.rejects(fixture(t,'fail').responses.create(request),/not logged in/);
  await assert.rejects(fixture(t,'tool').responses.create({...request,tool_choice:'none'}),/上限/);
  await assert.rejects(fixture(t,'answer').responses.create({...request,tool_choice:'required'}),/必要/);
});
test('CLI chat cancellation terminates its child process',async t=>{
  const c=new AbortController();const pending=fixture(t,'wait').responses.create(request,{signal:c.signal});
  setTimeout(()=>c.abort(),100);await assert.rejects(pending,/已停止/);
});
