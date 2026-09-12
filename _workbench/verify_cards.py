#!/usr/bin/env python3
"""Verify card values against their cited locations. Exit 1 requests re-extraction."""
import json, re, sys, unicodedata
from decimal import Decimal, InvalidOperation
from pathlib import Path

CRITICAL = ('質押','擔保','保證','終止','關係人','期後','pledg','guarant','terminat','related part','subsequent')

def norm(text):
    s=unicodedata.normalize('NFKC', str(text)).replace(',','').replace('−','-')
    s=re.sub(r'\(\s*([$€¥£]?\s*\d+(?:\.\d+)?)\s*\)',
             lambda m:m.group() if s[:m.start()].rstrip().endswith('%') else '-'+m[1],s)
    result=[]
    for m in re.finditer(r'-?\d+(?:\.\d+)?\s*%?',s):
        raw=m.group().strip(); pct=raw.endswith('%')
        try: value=Decimal(raw.rstrip('%').strip())
        except InvalidOperation: continue
        result.append((value,pct))
    return result

def card_rows(text):
    active=False
    for line in text.splitlines():
        if line.startswith('## '):
            active='關鍵數字' in line
        if not active or not line.strip().startswith('|'): continue
        cells=[c.strip() for c in re.split(r'(?<!\\)\|',line.strip().strip('|'))]
        if len(cells)<3 or cells[0] in ('項目','指標') or re.fullmatch(r'[- :]+',cells[0]): continue
        yield {'item':cells[0], 'value':cells[1], 'loc':cells[2]}

def source_text(index, loc):
    if index.get('kind')=='xlsx':
        chunks=[]
        for sh in index.get('sheets',[]):
            # Do not let a reference to one tab match a different tab with the same cell.
            pattern=re.escape(sh['name'])+r"'?\s*!\s*\$?([A-Z]{1,3})\$?(\d+)"
            for m in re.finditer(pattern,loc,re.I):
                ref=m[1].upper()+m[2]
                for c in sh.get('cells',[]):
                    if c['ref']==ref: chunks.append(str(c.get('value',''))+' '+str(c.get('formula') or ''))
        return '\n'.join(chunks)
    pages={p['n']:p.get('text','') for p in index.get('pages',index.get('slides',[]))}
    refs=re.findall(r'(?:p\.\s*|slide\s*)(\d+)',loc,re.I)
    return '\n'.join(pages.get(int(n),'') for n in refs)

def verify(deal, only=None):
    an=Path(deal)/'_analysis'; reports=[]
    for card in sorted((an/'cards').glob('*.md')):
        if '.part-' in card.name: continue
        file=card.name[:-3]
        if only and file!=Path(only).name: continue
        ip=an/'index'/(file+'.index.json')
        index=json.loads(ip.read_text()) if ip.exists() else {}
        text=card.read_text()
        rows=list(card_rows(text)); hit=[]; miss=[]
        expected=index.get('page_count') or index.get('sheet_count') or 0
        marker=re.search(r'<!--\s*coverage:\s*(\{.*?\})\s*-->',text,re.S)
        declaration=re.search(r'共\s*(\d+)\s*(?:個\s*)?(?:頁|tab)',text.split('## 覆蓋聲明')[-1])
        coverage_ok=False
        if marker:
            c=json.loads(marker[1]);coverage_ok=c.get('pages')==[1,expected] and not c.get('unreadable')
        elif declaration:
            coverage_ok=int(declaration[1])==expected

        for row in rows:
            evidence=source_text(index,row['loc']); values=norm(row['value']); found=norm(evidence)
            # Numeric tokens match exactly, never 12 inside 120. Permit the equivalent
            # decimal for a percent only when the source actually contains that number.
            if values:
                valid=bool(evidence.strip()) and all((v,pct) in found or (pct and (v/100,False) in found) for v,pct in values)
            else:
                compact=lambda s:re.sub(r'\s+','',unicodedata.normalize('NFKC',s)).casefold()
                valid=bool(evidence.strip()) and compact(row['value']) in compact(evidence)
            (hit if valid else miss).append(row)
        critical=[r for r in miss if any(k in r['item'].lower() for k in CRITICAL)]
        rate=len(hit)/len(rows) if rows else 0
        reports.append({'file':file,'rows':len(rows),'hit':len(hit),'miss':miss,'hit_rate':rate,'critical_miss':len(critical),'critical_rows':critical,'coverage_ok':coverage_ok,'passed':bool(rows) and rate>=.95 and not critical and coverage_ok})
    # A single-file check updates that card without discarding other results.
    if only and (an/'card-verify.json').exists():
        old=json.loads((an/'card-verify.json').read_text()).get('cards',[])
        all_reports=[r for r in old if r['file']!=Path(only).name]+reports
    else: all_reports=reports
    an.mkdir(parents=True,exist_ok=True)
    output={'cards':all_reports,'note':'Location/value agreement only; this does not establish completeness or truth.'}
    (an/'card-verify.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    lines=['# 字卡逐筆核對','', '| 文件 | rows | hit | hit rate | critical miss |','|---|---:|---:|---:|---:|']
    for r in all_reports: lines.append(f"| {r['file']} | {r['rows']} | {r['hit']} | {r['hit_rate']:.1%} | {r['critical_miss']} |")
    for r in all_reports:
        lines.extend(['', '## '+r['file']]+[f"- 未命中：{x['item']} — {x['value']} [{x['loc']}]" for x in r['miss']])
    (an/'card-verify.md').write_text('\n'.join(lines)+'\n')
    return reports

if __name__=='__main__':
    results=verify(sys.argv[1],sys.argv[2] if len(sys.argv)>2 else None)
    print(json.dumps({'cards':results},ensure_ascii=False))
    sys.exit(0 if results and all(r['passed'] for r in results) else 1)
