#!/usr/bin/env python3
"""Group card rows by metric/entity/period; candidates are not reconciled facts."""
import json, re, sys, unicodedata
from pathlib import Path
from verify_cards import card_rows, norm, CRITICAL

def normalize(s): return re.sub(r'\s+','',unicodedata.normalize('NFKC',s)).casefold()

def period(text):
    m=re.search(r'民國\s*(\d{2,3})\s*年',text)
    if m:return str(int(m[1])+1911)
    m=re.search(r'(20\d{2})\s*H([12])',text,re.I)
    if m:return m[1]+'H'+m[2]
    m=re.search(r'(20\d{2})[-/]([01]\d)',text)
    if m:return m[1]+'-'+m[2]
    m=re.search(r'(?:FY\s*)?(20\d{2})',text,re.I)
    return m[1] if m else None

def candidates(deal):
    metrics=json.loads((Path(__file__).resolve().parent.parent/'knowledge/metrics.json').read_text())['metrics']
    groups={}; unmatched=[]
    for card in sorted((Path(deal)/'_analysis/cards').glob('*.md')):
        if '.part-' in card.name:continue
        for row in card_rows(card.read_text()):
            item=row['item']; matches=[]
            for metric in metrics:
                for alias in metric['aliases']:
                    # Latin short aliases require word boundaries (AR must not match shares).
                    match=(normalize(alias) in normalize(item)) if re.search(r'[\u3400-\u9fff]',alias) else re.search(r'(?<![a-z])'+re.escape(alias)+r'(?![a-z])',item,re.I)
                    if match:matches.append((len(normalize(alias)),metric,alias))
            match=max(matches,key=lambda m:m[0]) if matches else None
            metric=match[1] if match else None
            nums=norm(row['value']);value=float(nums[0][0]/100 if nums[0][1] else nums[0][0]) if nums else None
            # Proper-name extraction is explicitly a heuristic; retain raw labels for reconciliation.
            entity=None
            if metric and metric['id'] in ('holder_shares','holder_pct'):
                entity=re.sub(r'股東[:：]?|持股數|持股比例|股數|shares held|ownership %','',item,flags=re.I).strip(' ：:（）()') or None
            entry={'doc':card.name[:-3],'loc':row['loc'],'item':item,'value_raw':row['value'],'value_num':value,'unit':metric.get('unit') if metric else None,'metric_id':metric['id'] if metric else None,'entity':entity,'period':period(item),'entity_inferred':bool(entity)}
            if not metric: unmatched.append(entry);continue
            key=(entry['metric_id'],normalize(entity or ''),entry['period'])
            groups.setdefault(key,[]).append(entry)
    result=[]
    for key,rows in groups.items():
        multiple=len(set(r['doc'] for r in rows))>=2
        critical=any(any(k in r['item'].casefold() for k in CRITICAL) for r in rows)
        result.append({'metric_id':key[0],'entity':rows[0]['entity'],'period':key[2],'multiple_sources':multiple,'critical':critical,'rows':rows})
    result.sort(key=lambda g:(0 if g['multiple_sources'] else 1 if g['critical'] else 2,g['metric_id']))
    output={'groups':result,'unmatched':unmatched,'note':'候選分群，不是矛盾判定；期間未載明為 null，不從檔名猜期間。實體為待核對的文字啟發式。'}
    (Path(deal)/'_analysis/candidates.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    return output

if __name__=='__main__':
    output=candidates(sys.argv[1]);print(json.dumps({'groups':len(output['groups']),'metrics':sorted(set(g['metric_id'] for g in output['groups'])),'unmatched':len(output['unmatched'])},ensure_ascii=False))
