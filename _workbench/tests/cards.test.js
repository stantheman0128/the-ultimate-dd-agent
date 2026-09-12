const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {spawnSync}=require('node:child_process');
test('card verifier catches changed values, missing coverage, numeric substrings and critical clauses',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'card-verify-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const an=path.join(root,'_analysis');fs.mkdirSync(path.join(an,'index'),{recursive:true});fs.mkdirSync(path.join(an,'cards'));
 fs.writeFileSync(path.join(an,'index','sample.pdf.index.json'),JSON.stringify({file:'sample.pdf',kind:'pdf',page_count:1,pages:[{n:1,text:'Revenue 1,200.00; Margin 20%; Pledged assets 80; expense (50).'}]}));
 const card=path.join(an,'cards','sample.pdf.md');
 const good='# 字卡\n## 關鍵數字表\n| 項目 | 數值 | 出處 |\n|---|---|---|\n| Revenue | $１，２００ | p.1 |\n| Margin | 20% | p.1 |\n| 質押 | 80 | p.1 |\n| Expense | (50) | p.1 |\n## 覆蓋聲明\n共 1 頁，已全數處理';
 const run=()=>spawnSync('python3',[path.join(__dirname,'../verify_cards.py'),root],{encoding:'utf8'});
 fs.writeFileSync(card,good);assert.equal(run().status,0);
 fs.writeFileSync(card,good.replace('| 80 |','| 8 |'));assert.equal(run().status,1);let report=JSON.parse(fs.readFileSync(path.join(an,'card-verify.json'))).cards[0];assert.equal(report.critical_miss,1);assert.equal(report.miss[0].value,'8');
 fs.writeFileSync(card,good.replace('共 1 頁','共 2 頁'));assert.equal(run().status,1);
});
test('shard plan covers annual report continuously in 7–9 bounded shards',()=>{
 const root=path.resolve(__dirname,'../../演練資料_AcmeRobotics');
 const r=spawnSync('python3',[path.join(__dirname,'../shard_plan.py'),root],{encoding:'utf8'});assert.equal(r.status,0);
 const shards=JSON.parse(r.stdout).filter(x=>x.file.includes('Annual_Report_Full'));
 assert.ok(shards.length>=7&&shards.length<=9);let next=1;for(const s of shards){assert.equal(s.pages[0],next);next=s.pages[1]+1;assert.ok(s.est_tokens<=60000);}assert.equal(next,521);
});
