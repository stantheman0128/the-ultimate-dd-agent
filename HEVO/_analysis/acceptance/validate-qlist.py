#!/usr/bin/env python3
"""Validate generated Markdown Q-list structure and physical PDF citations.
Usage: python validate-qlist.py draft.md --deal HEVO [--facts facts.json] [--output result.json]
Exact duplicates are errors; semantic duplicates and actual source support need human review.
"""
import argparse, collections, json, pathlib, re, sys, unicodedata
import fitz

def cells(line):
    return [x.strip().replace(r'\|','|') for x in re.split(r'(?<!\\)\|',line.strip().strip('|'))]

def resolve(deal, info):
    file=info.get('file') or info.get('path')
    if not file:return None,'document has no file/path'
    file=pathlib.Path(file); root=deal.resolve()
    if file.is_absolute(): candidates=[file]
    else:
        rnd=info.get('round',''); folder='round'+rnd[1:] if re.fullmatch(r'R\d+',rnd) else rnd
        candidates=[deal/file]
        if folder and folder!='未分輪':candidates.append(deal/folder/file)
        if not any(p.is_file() for p in candidates):candidates=list(deal.rglob(file.name))
    found=[]
    for p in candidates:
        p=p.resolve()
        if p.is_file() and p.is_relative_to(root) and '_analysis' not in p.relative_to(root).parts and p not in found:found.append(p)
    return (found[0],None) if len(found)==1 else (None,f'file resolution found {len(found)} candidates')

def validate(text,deal,facts):
    errors=[]; warnings=[]; rows=[]; header=None
    required=['No.','分類','問題','出處與動機','書面/口頭','波次','證據']
    for n,line in enumerate(text.splitlines(),1):
        if not line.lstrip().startswith('|'):continue
        row=cells(line)
        if all(x in row for x in required):header=row;continue
        if not header or all(re.fullmatch(r'[:\- ]*',x) for x in row):continue
        if len(row)!=len(header):errors.append({'line':n,'error':'column_count','message':f'{len(row)} cells, expected {len(header)}'});continue
        item=dict(zip(header,row));item['_line']=n;rows.append(item)
    if not rows:errors.append({'error':'no_question_rows','message':'Required seven-column Markdown question table was not found'})
    docs=facts.get('docs',{}); seen={}; numbers=set(); first=0
    for row in rows:
        line=row['_line'];num=row['No.']; evidence=row['證據']; question=row['問題']
        def err(code,message):errors.append({'line':line,'number':num,'error':code,'message':message})
        if num in numbers:err('duplicate_number',num)
        numbers.add(num)
        norm=re.sub(r'[\W_]+','',unicodedata.normalize('NFKC',question)).lower()
        if not norm:err('empty_question','Question must not be empty')
        elif norm in seen:err('duplicate_question',f'Exact normalized duplicate of {seen[norm]}')
        else:seen[norm]=num
        wave=re.sub(r'[\s*`]+','',row['波次']).lower()
        if wave in ('1','第一波','第1波','wave1','w1'):first+=1
        elif wave not in ('2','3','第二波','第三波','第2波','第3波','wave2','wave3','w2','w3'):err('unknown_wave',row['波次'])
        if evidence.strip(' -—*`')=='':err('empty_evidence','Evidence is required');continue
        refs=re.split(r';|；|<br\s*/?>',evidence,flags=re.I)
        for ref in refs:
            ref=ref.strip().strip('`')
            if not ref:continue
            if ':' not in ref:err('invalid_reference',ref);continue
            code,loc=ref.split(':',1);code=code.strip();loc=loc.strip()
            if code not in docs:err('unknown_document',code);continue
            path,reason=resolve(deal,docs[code])
            if reason:err('unresolved_document',f'{code}: {reason}');continue
            if path.suffix.lower()=='.pdf':
                m=re.fullmatch(r'p(?:p)?\.?\s*(\d+)(?:\s*[-–—~]\s*(?:p\.?\s*)?(\d+))?',loc,re.I)
                if not m:err('invalid_pdf_page',ref);continue
                start=int(m[1]);end=int(m[2] or start)
                try:
                    with fitz.open(path) as d:limit=len(d)
                except Exception as exc:err('unreadable_pdf',str(exc));continue
                if not (1<=start<=end<=limit):err('page_out_of_range',f'{ref}; PDF has {limit} pages')
            elif not loc:err('empty_location',ref)
            else:warnings.append({'line':line,'message':f'{code}: Non-PDF location requires manual validation ({loc})'})
    if first>20:errors.append({'error':'first_wave_over_limit','message':f'{first} first-wave questions; maximum 20'})
    return {'pass':not errors,'questions':len(rows),'first_wave_questions':first,'errors':errors,'warnings':warnings,'limits':['Checks exact normalized duplicates only; semantic overlap requires review.','A valid page reference is not proof that the page supports the question.','Missing-document claims must cite a real inventory/notes source; unknown document IDs fail.']}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('draft',type=pathlib.Path);parser.add_argument('--deal',type=pathlib.Path,required=True);parser.add_argument('--facts',type=pathlib.Path);parser.add_argument('--output',type=pathlib.Path);args=parser.parse_args()
    try:result=validate(args.draft.read_text(),args.deal,json.loads((args.facts or args.deal/'_analysis/facts.json').read_text()))
    except (OSError,ValueError) as exc:result={'pass':False,'errors':[{'error':'input_unavailable','message':str(exc)}]}
    body=json.dumps(result,ensure_ascii=False,indent=2);print(body)
    if args.output:args.output.write_text(body+'\n')
    return 0 if result['pass'] else 1
if __name__=='__main__':sys.exit(main())
