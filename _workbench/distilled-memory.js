'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
// Stable logical keys; each table row or paragraph remains independently retrievable.
function sections(raw) {
  const out=[], counts=new Map(); let heading='通用查核規則', block=[], start=0;
  const flush=()=>{if(!block.length)return;const text=block.join('\n').trim();block=[];if(!text)return;
    const label=text.startsWith('|')?text.split('|')[1].trim():text.replace(/^[-*]\s*/, '').slice(0,32);
    const stem=heading+' / '+label,n=counts.get(stem)||0;counts.set(stem,n+1);
    for(let i=0;i<text.length;i+=1800){
      const raw=text.slice(i,i+1800),cells=raw.startsWith('|')?raw.split('|').slice(1,-1).map(x=>x.trim()):[];
      const content=cells.length===4?`${cells[0]}（適用：${cells[1]}；第 ${cells[2]} 波）\n${cells[3]}`:raw;
      out.push({key:hash(stem+' / '+n+' / '+i),title:(heading+' · '+label).slice(0,100),content,raw,line:start+1});
    }};
  const lines=raw.split(/\r?\n/);
  lines.forEach((line,i)=>{
    if (line.startsWith('|') && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i+1] || '')) {flush();return;}
    if(/^#{1,6}\s/.test(line)){flush();heading=line.replace(/^#+\s*/, '');return;}
    if(!line.trim()){flush();return;}
    if(/^\s*\|[\s:|-]+\|\s*$/.test(line)){flush();return;}
    if(line.startsWith('|') || /^[-*]\s/.test(line)){flush();start=i;block=[line];flush();return;}
    if(!block.length)start=i;block.push(line);
  });flush();return out;
}
function sync(store) {
  const file=path.join(store.projectRoot,'knowledge','question-bank.md');
  const raw=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
  const digest=hash(raw);if(store.distilledHash===digest)return;
  const old=store.list('global',true).filter(x=>x.source?.type==='distillation');
  const seen=new Set();let changed=false;
  for(const part of sections(raw)){
    seen.add(part.key);const previous=old.find(x=>x.source.key===part.key);
    const source={type:'distillation',file:'knowledge/question-bank.md',key:part.key,line:part.line,hash:hash(part.raw),original:part.raw};
    if(previous?.status==='deleted')continue;
    if(previous?.source.hash===source.hash && !previous.source.missing && (previous.source.overridden || previous.content===part.content))continue;
    if(previous?.source.overridden){
      store.save("global",{...previous,source:{...source,overridden:true,conflict:true}},{id:previous.id,revision:previous.revision,automatic:true});changed=true;continue;
    }
    store.save('global',{title:part.title,content:part.content,status:'active',kind:'rule',source},{id:previous?.id,revision:previous?.revision,automatic:true});changed=true;
  }
  for(const x of old)if(x.status!=='deleted'&&!seen.has(x.source.key)&&!x.source.missing){
    store.save('global',{...x,status:x.source.overridden?x.status:'disabled',source:{...x.source,missing:true,conflict:!!x.source.overridden}},{id:x.id,revision:x.revision,automatic:true});changed=true;
  }
  store.distilledHash=digest;if(changed)store.invalidate();
}
module.exports={sections,sync};
