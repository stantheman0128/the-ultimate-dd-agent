'use strict';
const fs=require('node:fs'),path=require('node:path');
function normalize(rows,round) {
 if(!Array.isArray(rows))throw new Error('questions JSON must be an array');
 const ids=new Set();
 return rows.map((q,i)=>{
  const id=q.question_id;
  if(typeof id!=='string'||!/^q-[a-z0-9-]+$/.test(id)||ids.has(id))throw new Error('invalid or duplicate question_id');
  ids.add(id);
  if(typeof q.text!=='string'||!q.text.trim()||!Array.isArray(q.evidence))throw new Error('question requires text and evidence array');
  if(q.evidence.some(e=>typeof e.doc!=='string'||typeof e.loc!=='string'))throw new Error('invalid evidence');
  return {...q,no:q.no||i+1,q:q.text,revision:q.revision||1,source:q.source||'AI'};
 });
}
function load(dp,round,parseDraftTable){
 const dir=path.join(dp,'_analysis','drafts');
 const canonical=path.join(dir,`questions_R${round}.json`);
 const merged=path.join(dir,`draft_R${round}_merged.md`);
 if(fs.existsSync(canonical))return {round,merged:fs.existsSync(merged),canonical:true,questions:normalize(JSON.parse(fs.readFileSync(canonical,'utf8')),round)};
 const plain=path.join(dir,`draft_R${round}.md`),delta=path.join(dir,`draft_R${round}_delta.md`),f=fs.existsSync(merged)?merged:plain;
 let rows=fs.existsSync(f)?parseDraftTable(fs.readFileSync(f,'utf8'),f===merged):[];
 if(fs.existsSync(delta))rows.push(...parseDraftTable(fs.readFileSync(delta,'utf8'),false).map(x=>({...x,delta:true})));
 rows=rows.map(q=>({...q,question_id:`q-r${round}-${String(q.no).padStart(3,'0')}`,text:q.q,revision:1,persona:null}));
 return {round,merged:f===merged,canonical:false,questions:normalize(rows,round),hasDelta:fs.existsSync(delta)};
}
module.exports={normalize,load};
