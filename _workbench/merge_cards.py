#!/usr/bin/env python3
"""Merge card shards only after their declared page/tab coverage is complete."""
import json, re, sys, shutil
from pathlib import Path

def merge(deal, filename):
    an=Path(deal)/'_analysis'; cards=an/'cards'; filename=Path(filename).name
    idx=json.loads((an/'index'/(filename+'.index.json')).read_text())
    parts=sorted(cards.glob(filename+'.part-*.md'))
    if not parts: raise ValueError('no shards found')
    summaries=[]; rows=[]; statements=[]; issues=[]; covered=[]; sheets=[]; unknown=[]
    for p in parts:
        text=p.read_text(); m=re.search(r'<!--\s*coverage:\s*(\{.*?\})\s*-->',text,re.S)
        if not m: raise ValueError('missing coverage marker: '+p.name)
        c=json.loads(m[1]); a,b=c['pages']
        if not isinstance(a,int) or not isinstance(b,int) or a<1 or b<a: raise ValueError('invalid coverage: '+p.name)
        covered.extend(range(a,b+1)); sheets.extend(c.get('sheets',[]));unknown.extend(c.get('unreadable',[]))
        sections={}
        for x in re.split(r'^##\s+',text,flags=re.M)[1:]:
            title,_,body=x.partition('\n');sections[title.strip()]=body.strip()
        summary=sections.get('摘要','')
        if summary: summaries.append(re.split(r'[。!?]\s*',summary)[0])
        for k,v in sections.items():
            if '關鍵數字' in k: rows.extend(l for l in v.splitlines() if l.strip().startswith('|') and not re.search(r'項目|^\|[- :|]+$',l))
            if '重要陳述' in k: statements.extend(l for l in v.splitlines() if l.strip().startswith('|') and not re.search(r'^\|\s*陳述\s*\||^\|[- :|]+$',l))
            if '疑點' in k: issues.extend(v.splitlines())
    count=idx.get('page_count') or idx.get('sheet_count') or 0
    missing=sorted(set(range(1,count+1))-set(covered))
    duplicate=sorted(n for n in set(covered) if covered.count(n)>1)
    if missing or duplicate or set(covered)-set(range(1,count+1)):
        raise ValueError(json.dumps({'missing_pages':missing,'overlap':duplicate},ensure_ascii=False))
    if idx.get('kind')=='xlsx' and set(sheets)!=set(sh['name'] for sh in idx.get('sheets',[])):
        raise ValueError('sheet coverage does not match index')
    coverage={'pages':[1,count],'sheets':sheets,'unreadable':unknown}
    out=f'# 字卡：{filename}\n\n## 摘要\n'+ '。'.join(summaries[:3])+'。\n\n## 關鍵數字表\n| 項目 | 數值 | 出處 |\n|---|---|---|\n'+'\n'.join(dict.fromkeys(rows))+'\n\n## 重要陳述（非數字）\n| 陳述 | 原文摘錄 | 出處 |\n|---|---|---|\n'+'\n'.join(dict.fromkeys(statements))+'\n\n## 未明名詞與疑點\n'+'\n'.join(dict.fromkeys(issues))+'\n\n## 覆蓋聲明\n'+f'共 {count} 頁 / tab，分片連續覆蓋；未辨識頁：{unknown}。\n<!-- coverage: '+json.dumps(coverage,ensure_ascii=False)+' -->\n'
    target=cards/(filename+'.md');target.write_text(out)
    archive=cards/'_parts';archive.mkdir(exist_ok=True)
    for p in parts:
        dest=archive/p.name
        if dest.exists(): dest=archive/(str(p.stat().st_mtime_ns)+'_'+p.name)
        shutil.move(str(p),str(dest))
    return {'file':filename,'parts':len(parts),'pages':count,'unreadable':unknown}

if __name__=='__main__':
    try: print(json.dumps(merge(sys.argv[1],sys.argv[2]),ensure_ascii=False))
    except (ValueError,KeyError) as e: print(str(e),file=sys.stderr);sys.exit(1)
