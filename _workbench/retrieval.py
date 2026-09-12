#!/usr/bin/env python3
"""Local, incremental SQLite/BM25 evidence index. JSON request on stdin; no network."""
import os, sys, json, re, sqlite3, hashlib
from pathlib import Path

VERSION = '5'
CHUNK = 2400

def terms(text):
    out = re.findall(r'[a-z0-9][a-z0-9_-]*', str(text).lower())
    for run in re.findall(r'[\u3400-\u9fff]+', str(text)):
        out.extend(run[i:i+2] for i in range(max(1, len(run)-1)))
    aliases = [
      ('股權 股东 股東 持股 股數 股数 股份', 'equity shares shareholder captable cap table registry'),
      ('營收 营收 收入 營業額', 'revenue sales income'),
      ('現金 现金 現金流', 'cash cashflow liquidity'),
      ('質押 质押 擔保 担保 抵押', 'pledge pledged collateral security'),
      ('終止 终止 解約 解约', 'termination terminate cancellation'),
      ('財報 财报 年報 年报 財務 财务', 'financial annual audited balance'),
      ('合約 合同 契約', 'contract agreement'),
      ('發票 发票 收據 收据', 'invoice receipt'),
      ('組織 组织 架構 架构 流程', 'organization chart workflow architecture'),
      ('客戶 客户', 'customer client'),
      ('銀行 银行 募資 融資 融资', 'bank financing fundraising'),
    ]
    lower=str(text).lower()
    for zh,en in aliases:
        if any(w in lower for w in zh.split()):out.extend(en.split())
    return out

def pieces(text):
    # Overlap preserves clauses straddling boundaries; explicit chunk offsets remain available.
    for start in range(0, max(1, len(text)), CHUNK-200):
        yield start, text[start:start+CHUNK]

def prepare(deal):
    base = Path(deal).resolve()
    folder = base/'_analysis'/'retrieval'
    folder.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(folder/'evidence.sqlite', timeout=30)
    db.row_factory = sqlite3.Row
    db.executescript('''CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, signature TEXT, file TEXT, round TEXT, kind TEXT, description TEXT, warning TEXT);
    CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, doc TEXT, file TEXT, round TEXT, location TEXT, page INTEGER, text TEXT, kind TEXT);
    CREATE INDEX IF NOT EXISTS chunk_doc ON chunks(doc);
    CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, words, tokenize='unicode61');''')
    active = {}
    originals = {}
    for f in base.iterdir():
        if f.is_dir() and re.fullmatch(r'round\d+', f.name):
            for raw in f.iterdir():
                if raw.is_file() and not raw.is_symlink(): originals.setdefault(raw.name, []).append(raw)
        elif f.is_file() and not f.name.startswith(('_', '.')):
            originals.setdefault(f.name, []).append(f)
    warnings = []
    indexed_names = set()
    sources = []
    for p in sorted((base/'_analysis'/'index').glob('*.index.json')):
        if p.is_symlink(): continue
        name = p.name[:-11]
        raw = originals.get(name, [])
        if not raw: continue  # archived/deleted evidence cannot reappear
        if len(raw) != 1:
            warnings.append(name+': 同名文件跨輪次重複，請重新命名後索引'); continue
        indexed_names.add(name)
        sources.append((p, raw[0], 'source'))
    for name in originals:
        if name not in indexed_names: warnings.append(name+': 尚無可用索引')
    derived = [base/'_notes.md', base/'_analysis'/'facts.md']
    for sub in ['cards', 'drafts']:
        derived += sorted((base/'_analysis'/sub).glob('*.md'))
    for p in derived:
        if p.is_file() and not p.is_symlink(): sources.append((p, None, 'derived'))
    db.execute('BEGIN IMMEDIATE')
    try:
        for p, raw, category in sources:
            docid = hashlib.sha256(str(p.relative_to(base)).encode()).hexdigest()[:20]
            pst=p.stat()
            signature=f'{VERSION}:{pst.st_mtime_ns}:{pst.st_size}'
            if raw:
                st=raw.stat(); signature += f':{st.st_mtime_ns}:{st.st_size}'
            active[docid]=True
            old=db.execute('SELECT signature FROM docs WHERE id=?',(docid,)).fetchone()
            if old and old['signature']==signature: continue
            db.execute('DELETE FROM search WHERE id IN (SELECT id FROM chunks WHERE doc=?)',(docid,))
            db.execute('DELETE FROM chunks WHERE doc=?',(docid,))
            db.execute('DELETE FROM docs WHERE id=?',(docid,))
            rows=[]; warning=''; description=''
            if category=='source':
                try: data=json.loads(p.read_text())
                except (ValueError,OSError): warnings.append(raw.name+': 索引無法讀取'); continue
                file=raw.name; kind=data.get('kind','text'); rnd=data.get('round','')
                if data.get('error'): warning='抽取失敗：'+data['error']
                source_current = abs(data.get('mtime',0)-st.st_mtime)<=0.001 and data.get('size')==st.st_size
                if not source_current:
                    warning='原檔已變更，請重建索引；舊內容已排除'
                else:
                    if kind=='xlsx':
                        for sheet in data.get('sheets',[]):
                            cells=sheet.get('cells',[])
                            header='\n'.join(f"{c['ref']}\t{c.get('value')}" for c in cells[:12])[:500]
                            for offset in range(0,len(cells),35):
                                group=cells[offset:offset+35]
                                loc=sheet['name']+'!'+group[0]['ref']
                                text='欄位導覽（原表前12個非空格）：\n'+header+'\n資料：\n'+'\n'.join(f"{c['ref']}\t{c.get('value')}"+(f"\t公式:{c['formula']}" if c.get('formula') else '') for c in group)
                                rows.append((loc,0,text))
                            if sheet.get('truncated'): warning+=' 工作表 '+sheet['name']+' 超過抽取上限，內容不完整。'
                    else:
                        for page in data.get('pages',[]):
                            loc=('段落 ' if kind in ('docx','text') else 'p.')+str(page['n'])
                            text=page.get('text','')
                            if page.get('needs_ocr'): text+='\n[此頁需要 OCR；尚未完整讀取]'; warning='含未完成 OCR 的頁面'
                            rows.append((loc,page['n'],text))
                            if page.get('summary_zh'):
                                rows.append((loc+' 圖片描述（AI 推論，需核對原圖）',-page['n'],page['summary_zh']+'\n中英關鍵字：'+' '.join(page.get('keywords',[]))))
                warning+='；'.join(data.get('warnings',[]))
                enrichment=data.get('enrichment',{}) if source_current else {}
                if enrichment.get('summary_zh'):
                    routing='[AI 文件導覽，不是原文證據] '+enrichment['summary_zh']+'\n中英關鍵字：'+' '.join(enrichment.get('keywords',[]))+'\n'+enrichment.get('coverage','')+'\n取樣位置：'+', '.join(enrichment.get('sampled_locations',[]))
                    rows.append(('文件導覽（AI）',-1000000,routing))
                description=(file+' | '+kind+' | '+str(len(rows))+' 頁/區塊 | '+ ' '.join(t[:140].replace('\n',' ') for _,_,t in rows[:2]))[:500]
                if enrichment.get('summary_zh'): description=(file+' | '+enrichment['summary_zh'])[:500]
            else:
                file=str(p.relative_to(base));kind='derived';rnd=''
                text=p.read_text(errors='replace')
                rows=[('L1',0,text)]
                description=(file+' | 分析產物，需以原件核對 | '+text[:250].replace('\n',' '))[:500]
            db.execute('INSERT INTO docs VALUES (?,?,?,?,?,?,?)',(docid,signature,file,rnd,kind,description,warning))
            for n,(loc,page,text) in enumerate(rows):
                for offset,part in pieces(text):
                    revision=hashlib.sha256(signature.encode()).hexdigest()[:10]
                    cid=f'{docid}:{revision}:{n}:{offset}'
                    location=loc if kind!='derived' else 'L'+str(text[:offset].count('\n')+1)
                    db.execute('INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?)',(cid,docid,file,rnd,location,page,part,'metadata' if page<0 else kind))
                    db.execute('INSERT INTO search VALUES (?,?)',(cid,' '.join(terms(file+' '+location+' '+part))))
        for row in db.execute('SELECT id FROM docs').fetchall():
            if row['id'] not in active:
                db.execute('DELETE FROM search WHERE id IN (SELECT id FROM chunks WHERE doc=?)',(row['id'],))
                db.execute('DELETE FROM chunks WHERE doc=?',(row['id'],))
                db.execute('DELETE FROM docs WHERE id=?',(row['id'],))
        db.commit()
    except Exception:
        db.rollback(); raise
    return db, warnings

def execute(db, req, warnings):
    op=req.get('op','catalog'); q=str(req.get('query',''))[:2000]
    warnings += [r['file']+': '+r['warning'] for r in db.execute("SELECT file,warning FROM docs WHERE warning != '' LIMIT 10")]
    if op=='catalog':
        offset=max(0,min(int(req.get('offset',0)),1000000))
        rows=db.execute('SELECT id,file,round,kind,description,warning FROM docs ORDER BY file LIMIT 12 OFFSET ?',(offset,)).fetchall()
        total=db.execute('SELECT count(*) FROM docs').fetchone()[0]
        return dict(documents=[dict(x) for x in rows],totalDocuments=total,nextOffset=offset+len(rows) if offset+len(rows)<total else None,warnings=warnings[:10])
    if op=='read':
        row=db.execute('SELECT * FROM chunks WHERE id=?',(str(req.get('id','')),)).fetchone()
        if not row:return {'error':'片段不存在或已更新，請重新搜尋'}
        row=dict(row)
        siblings=db.execute('SELECT id,location FROM chunks WHERE doc=? AND page=? ORDER BY rowid LIMIT 12',(row['doc'],row['page'])).fetchall()
        return {'evidence':row,'relatedChunks':[dict(x) for x in siblings]}
    if op=='search':
        ts=list(dict.fromkeys(terms(q)))[:70]
        query=' OR '.join('"'+t.replace('"','')+'"' for t in ts)
        found=[]
        doc=str(req.get('document',''))
        scope=' AND (doc=? OR file=?)' if doc else ''
        scope_args=(doc,doc) if doc else ()
        pages=[int(x) for x in re.findall(r'(?:第\s*|page\s*|p\.\s*)(\d{1,5})(?:\s*頁)?',q,re.I)]
        if pages:
            placeholders=','.join('?' for _ in pages)
            found.extend(db.execute(f'SELECT *, -100 AS rank FROM chunks WHERE page IN ({placeholders}) AND kind != ?{scope} LIMIT 20',(*pages,'derived',*scope_args)).fetchall())
        if query:
            found.extend(db.execute('SELECT c.*,bm25(search) AS rank FROM search JOIN chunks c ON c.id=search.id WHERE search MATCH ?'+scope+' ORDER BY rank LIMIT 50',(query,*scope_args)).fetchall())
        doc=str(req.get('document',''))
        seen=set(); results=[]
        for x in found:
            if x['id'] in seen or (doc and doc not in (x['doc'],x['file'])):continue
            seen.add(x['id'])
            d=dict(x); d['snippet']=d.pop('text')[:650]; results.append(d)
            if len(results)>=8:break
        return {'matches':results,'warnings':warnings[:5],'scope':'僅搜尋本案目前可用索引；無命中不代表原件不存在'}
    raise ValueError('unknown operation')

def main():
    req=json.load(sys.stdin)
    db,warnings=prepare(sys.argv[1])
    try: print(json.dumps(execute(db,req,warnings),ensure_ascii=False))
    finally: db.close()
if __name__=='__main__': main()
