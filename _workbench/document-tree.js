'use strict';
const fs=require('node:fs'),path=require('node:path');
function files(dir){
 if(!fs.existsSync(dir)||fs.lstatSync(dir).isSymbolicLink()||!fs.statSync(dir).isDirectory())return [];
 const out=[];
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(e.name.startsWith('.')||e.name.startsWith('~$')||e.isSymbolicLink())continue;
  const p=path.join(dir,e.name);
  if(e.isDirectory())out.push(...files(p));else if(e.isFile())out.push(p);
 }return out;
}
function resolveDocument(dp,name,round){
 if(!name||path.basename(name)!==name)throw Object.assign(Error('文件名稱無效'),{status:400});
 const rounds=fs.readdirSync(dp).filter(x=>/^round\d+$/.test(x)&&!fs.lstatSync(path.join(dp,x)).isSymbolicLink());
 let roots=round&&/^R\d+$/.test(round)?[path.join(dp,'round'+round.slice(1))]:round?[dp]:rounds.map(x=>path.join(dp,x));
 const matches=roots.flatMap(root=>root===dp?fs.readdirSync(dp).filter(x=>fs.lstatSync(path.join(dp,x)).isFile()).map(x=>path.join(dp,x)):files(root)).filter(x=>path.basename(x)===name&&!fs.lstatSync(x).isSymbolicLink());
 if(!round){const f=path.join(dp,name);if(fs.existsSync(f)&&fs.lstatSync(f).isFile()&&!matches.includes(f))matches.push(f);}
 if(matches.length>1)throw Object.assign(Error('有同名文件，請重新命名後再操作，以免引用錯誤來源'),{status:409});
 return matches[0]||null;
}
module.exports={files,resolveDocument};
