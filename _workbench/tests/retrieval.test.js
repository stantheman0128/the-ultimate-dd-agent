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
