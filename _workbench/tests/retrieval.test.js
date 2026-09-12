const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {tokenize,bm25Index,bm25Scores,buildAskContext}=require('../server');
const deal=path.resolve(__dirname,'../../演練資料_AcmeRobotics');
test('BM25 indexes English, numbers and CJK; ranks cited annual-report pages',()=>{
 assert.deepEqual(tokenize('GM 1,500,000 股東持股'),['gm','1500000','股東','東持','持股']);
 const index=bm25Index(deal);
 for(const [q,page,file] of [['related party',312,'Annual_Report_Full'],['change of control',486,'Annual_Report_Full'],['Vertex 1,500,000',1,'Shareholder_Registry']]){
  const top=bm25Scores(index,q)[0].u;assert.equal(top.loc.page,page);assert.ok(top.d.file.includes(file));
 }
});
test('low-budget retrieval preserves requested page and does not exceed token budget',()=>{
 const c=buildAskContext(deal,'第 486 頁寫什麼？',120000);
 assert.equal(c.retrieval,'bm25');assert.ok(c.pages<534);assert.ok(c.tokens<=120000);assert.ok(c.text.includes('<page n="486">'));
 assert.ok(!c.text.includes('本案適用方法論'));assert.ok(!c.text.includes('本案適用規則'));
});

test('metric aliases expand at 0.6, retain originals, and avoid short-name substrings',()=>{
 const {expandQuery}=require('../server');
 const q=expandQuery('毛利率');assert.equal(q.get('毛利'),1);assert.equal(q.get('gm'),.6);assert.equal(q.get('margin'),.6);
 assert.equal(expandQuery('GM').get('gm'),1);assert.equal(expandQuery('Hardware').has('receivable'),false);
});
test('search CLI and API scorer share cross-language rankings and sheet coordinates',t=>{
 const fs=require('node:fs'),os=require('node:os'),{spawnSync}=require('node:child_process'),{searchIndex}=require('../server');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dd-search-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const idx=path.join(root,'_analysis/index');fs.mkdirSync(idx,{recursive:true});
 fs.writeFileSync(path.join(idx,'model.xlsx.index.json'),JSON.stringify({file:'model.xlsx',round:'R1',kind:'xlsx',sheets:[{name:'Forecast',text:'B4 Revenue 275',cells:[{ref:'B4',value:'Revenue',formula:null}]}]}));
 fs.writeFileSync(path.join(idx,'source.pdf.index.json'),JSON.stringify({file:'source.pdf',kind:'pdf',pages:[{n:1,text:'Gross margin is 29 percent.'},{n:2,text:'Unrelated terms'}]}));
 const rows=searchIndex(root,'營收',1);assert.equal(rows[0].file,'model.xlsx');assert.equal(rows[0].loc,'Forecast!B4');
 assert.equal(searchIndex(root,'毛利率',1)[0].file,'source.pdf');
 const cli=spawnSync('python3',[path.join(__dirname,'../search.py'),root,'營收','--top','1','--json'],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),JSON.parse(JSON.stringify(rows)));
 const text=spawnSync('python3',[path.join(__dirname,'../search.py'),root,'毛利率','--top','1'],{encoding:'utf8'});assert.match(text.stdout,/source.pdf \| p.1 \|/);
});
