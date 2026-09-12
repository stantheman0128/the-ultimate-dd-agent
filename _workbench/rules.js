'use strict';
const fs=require('node:fs'),path=require('node:path');
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const clone=x=>JSON.parse(JSON.stringify(x));
function scopesMatch(scope,name){const a=Array.isArray(scope)?scope:String(scope).split(/[,，]/).map(x=>x.trim());return a.includes('all')||a.includes(name)||(name.startsWith('persona-')&&a.includes('persona'))||(name==='question-reviewer'&&a.includes('reviewer'));}
function validate(r){
 if(!r||typeof r!=='object'||!/^[a-z0-9][a-z0-9-]{0,100}$/.test(r.rule_id)||!Number.isSafeInteger(r.version)||r.version<1)fail('invalid rule identity');
 if(!['proposed','approved','retired'].includes(r.status))fail('invalid rule status');
 if(!['timing','method','wording','deal_specific'].includes(r.kind))fail('invalid rule kind');
 for(const k of ['scope','applies_when','instruction','evidence_summary'])if(typeof r[k]!=='string'||!r[k].trim())fail('rule requires '+k);
 const allowed=['all','reviewer','question-reviewer','persona',...['fin','ops','ind','ic','tech','legal','model','people'].map(p=>'persona-'+p)];
 if(r.scope.split(/[,，]/).some(x=>!allowed.includes(x.trim())))fail('invalid rule scope');
 if(!Array.isArray(r.exceptions)||r.exceptions.some(x=>typeof x!=='string')||!Array.isArray(r.source_feedback_ids)||r.source_feedback_ids.some(x=>typeof x!=='string'))fail('invalid rule evidence or exceptions');
 if(r.deal_anonymized!==true)fail('rule must be anonymized');
 if(r.kind==='deal_specific'&&(typeof r.deal!=='string'||!r.deal.trim()))fail('deal_specific requires deal');
 if(r.kind!=='deal_specific'&&r.deal!=null)fail('generic rule must not specify deal');
 return r;
}
function createStore(root){
 const dir=path.join(root,'knowledge','learned'),file=path.join(dir,'rules.json');
 const ledgerFile=path.join(root,'_workbench','.rule-approvals.json');
 let trusted={};try{trusted=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));}catch{}
 let warnings=[];
 const key=r=>r.rule_id+'@'+r.version;
 const write=(fp,value)=>{fs.mkdirSync(path.dirname(fp),{recursive:true});fs.writeFileSync(fp+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(fp+'.tmp',fp);};
 const persist=rows=>{write(file,rows);write(ledgerFile,trusted);};
 function read(){
  let input=[];warnings=[];
  try{input=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(input))throw new Error('rules must be array');}catch(e){if(e.code!=='ENOENT')warnings.push(e.message);}
  const rows=[],seen=new Set();
  for(let r of Array.isArray(input)?input:[]){
   try{
    const k=key(r);if(seen.has(k))fail('duplicate rule version');seen.add(k);
    if(trusted[k]){if(JSON.stringify(r)!==JSON.stringify(trusted[k]))warnings.push(k+': unauthorized status/content change restored');r=clone(trusted[k]);}
    else if(r.status!=='proposed'||r.approved_at||r.approved_by||r.folded_into){warnings.push(k+': approval not in server ledger rejected');r={...r,status:'proposed',approved_at:null,approved_by:null,folded_into:null};}
    validate(r);rows.push(r);
   }catch(e){warnings.push(e.message);}
  }
  for(const [k,r]of Object.entries(trusted))if(!rows.some(x=>key(x)===k))rows.push(clone(r));
  if(warnings.length)write(file,rows);
  return rows;
 }
 function propose(proposals){
  if(!Array.isArray(proposals)||proposals.length>3)fail('distiller may propose at most three rules');
  const current=read(),seen=new Set(current.map(key));
  const validated=proposals.map(r=>{
   validate(r);if(r.status!=='proposed'||r.approved_at||r.approved_by||r.folded_into)fail('agent cannot approve or retire rules');
   if(seen.has(key(r)))fail('rule version already exists');seen.add(key(r));
   return {...r,deal:r.deal??null,folded_into:null,approved_at:null,approved_by:null,proposed_at:r.proposed_at||new Date().toISOString()};
  });persist([...current,...validated]);return validated;
 }
 function mutate({rule_id,version,action,patch},actor='local-user'){
  const rows=read(),matching=rows.filter(r=>r.rule_id===rule_id&&(!version||r.version===version)).sort((a,b)=>b.version-a.version),r=matching[0];
  if(!r)fail('rule not found');
  if(action==='edit'){
   const allowed=['scope','applies_when','instruction','exceptions','kind','deal','evidence_summary'];
   if(!patch||Object.keys(patch).some(k=>!allowed.includes(k)))fail('edit cannot change rule status or identity');
   const next={...r,...patch,version:Math.max(...rows.filter(x=>x.rule_id===rule_id).map(x=>x.version))+1,status:'proposed',approved_at:null,approved_by:null,folded_into:null,proposed_at:new Date().toISOString()};validate(next);rows.push(next);persist(rows);return next;
  }
  if(action==='approve'){
   if(r.status!=='proposed')fail('only proposed rules can be approved');
   r.status='approved';r.approved_at=new Date().toISOString();r.approved_by=actor;
  }else if(action==='retire'){r.status='retired';}else fail('unknown rule action');
  trusted[key(r)]=clone(r);persist(rows);return r;
 }
 function active(deal,scope){
  const byId=new Map();
  for(const r of read())if(r.status==='approved'&&scopesMatch(r.scope,scope)&&(r.kind!=='deal_specific'||r.deal===deal)){
   const old=byId.get(r.rule_id);if(!old||r.version>old.version)byId.set(r.rule_id,r);
  }
  return [...byId.values()];
 }
 function fold(ids,into){
  const rows=read();for(const ref of ids){const [id,v]=ref.split('@');const r=rows.find(r=>r.rule_id===id&&r.version===Number(v)&&r.status==='approved');if(!r)fail('fold source rule must still be approved: '+ref);}
  for(const ref of ids){const r=rows.find(r=>key(r)===ref);r.status='retired';r.folded_into=into;trusted[key(r)]=clone(r);}persist(rows);
 }
 return {read,propose,mutate,active,fold,warnings:()=>warnings};
}
module.exports={createStore,validate,scopesMatch};
