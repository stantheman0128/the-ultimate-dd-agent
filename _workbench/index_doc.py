#!/usr/bin/env python3
"""Data Room 文件索引：上傳時抽取「每頁文字 / 每格值與公式」，寫到 <案件>/_analysis/index/<檔名>.index.json。

用法：
  python3 _workbench/index_doc.py <案件資料夾>                 # 索引全部文件（已索引且未變動者略過）
  python3 _workbench/index_doc.py <案件資料夾> --file <路徑>   # 只索引這一份（相對案件資料夾或絕對路徑）
  python3 _workbench/index_doc.py <案件資料夾> --force         # 全部重建

索引是引擎與工作台共用的「可定位層」：
- card-extractor 讀它做五段字卡；needs_visual 頁另外讀渲染 PNG
- /api/search 用它搜原文、/api/page 用它回單頁、/api/ask 用它組 context 並標出處 [檔名 p.N] / [檔名 工作表!B4]
"""
import json, os, sys, time, datetime, re, csv, io
from document_enrichment import image_page, describe
SCHEMA_VERSION = 4
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".heic", ".heif"}

SKIP_PREFIX = ('.', '~$')
DOC_EXT = {'.pdf', '.xlsx', '.xlsm', '.pptx', '.docx', '.txt', '.md', '.csv', '.tsv'} | IMAGE_EXT
MAX_CELLS_PER_SHEET = 40000
OCR_MIN_CHARS = 30  # 一頁文字少於此且有圖 → 判為掃描頁

def is_qlist(name):
    return re.search(r'q-?list', name, re.I) is not None

def list_docs(deal):
    out = []
    for e in sorted(os.listdir(deal)):
        p = os.path.join(deal, e)
        if re.fullmatch(r'round\d+', e) and os.path.isdir(p):
            if os.path.islink(p): continue
            for directory, dirs, files in os.walk(p, followlinks=False):
                dirs[:] = sorted(d for d in dirs if not d.startswith(SKIP_PREFIX) and not os.path.islink(os.path.join(directory,d)))
                for f in sorted(files):
                    if not f.startswith(SKIP_PREFIX): out.append((os.path.join(directory, f), 'R' + e[5:]))
        elif os.path.isfile(p) and not e.startswith(SKIP_PREFIX) and e != '_notes.md' and not is_qlist(e):
            out.append((p, '未分輪'))
    return [(p, r) for p, r in out if os.path.isfile(p) and not os.path.islink(p)]

def image_area_ratio(page, infos):
    # Rectangle union, clipped to page bounds: overlapping images count only once.
    rects=[]
    for info in infos:
        r=__import__('pymupdf').Rect(info['bbox']) & page.rect
        if not r.is_empty: rects.append(tuple(r))
    xs=sorted({x for r in rects for x in (r[0],r[2])});area=0
    for left,right in zip(xs,xs[1:]):
        intervals=sorted((r[1],r[3]) for r in rects if r[0]<right and r[2]>left)
        end=None;length=0
        for lo,hi in intervals:
            length+=max(0,hi-max(lo,end if end is not None else lo));end=max(end if end is not None else hi,hi)
        area+=(right-left)*length
    return area/page.rect.get_area() if page.rect.get_area() else 0

def index_pdf(path):
    import pymupdf
    pages=[]
    with pymupdf.open(path) as doc:
        for i,page in enumerate(doc):
            text=page.get_text('text',sort=True) or '';infos=page.get_image_info()
            scan=len(text.strip())<OCR_MIN_CHARS and bool(infos)
            ratio=image_area_ratio(page,infos)
            entry={'n':i+1,'text':text,'chars':len(text),'needs_ocr':scan,'needs_visual':scan or ratio>=.2,
                   'images':len(infos),'image_area_ratio':ratio,'extraction':'native','tables':[],
                   'blocks':[{'bbox':list(b[:4]),'text':b[4]} for b in page.get_text('blocks',sort=True) if b[6]==0]}
            try:
                from contextlib import redirect_stdout
                with redirect_stdout(sys.stderr):entry['tables']=[t.extract() for t in page.find_tables().tables]
            except Exception as e:entry.setdefault('warnings',[]).append('表格抽取失敗：'+str(e)[:150])
            if scan:
                visual=image_page(page.get_pixmap(matrix=pymupdf.Matrix(2,2),alpha=False).tobytes('png'),i+1,os.path.basename(path),allow_ai=False)
                if visual['text'].strip():
                    entry['text']=(text+'\n'+visual['text']).strip();entry['chars']=len(entry['text'])
                entry['needs_ocr']=visual['needs_ocr'];entry['extraction']=visual['extraction']
                entry.setdefault('warnings',[]).extend(visual.get('warnings',[]))
            pages.append(entry)
    return {'kind':'pdf','pages':pages,'page_count':len(pages),'needs_ocr_pages':sum(p['needs_ocr'] for p in pages)}

def read_xlsx(path):
    from openpyxl import load_workbook
    wb_v = load_workbook(path, read_only=True, data_only=True)
    wb_f = load_workbook(path, read_only=True, data_only=False)
    sheets = []
    try:
        for ws in wb_f.worksheets:
            ws_v = wb_v[ws.title]
            cells, truncated = [], False
            for formula_row, value_row in zip(ws.iter_rows(), ws_v.iter_rows()):
                for c, cv in zip(formula_row, value_row):
                    if c.value is None:
                        continue
                    if len(cells) >= MAX_CELLS_PER_SHEET:
                        truncated = True
                        break
                    formula = c.value if isinstance(c.value, str) and c.value.startswith('=') else None
                    value = cv.value if formula else c.value
                    if isinstance(value, (datetime.date, datetime.datetime)):
                        value = value.isoformat()
                    cells.append({'ref': c.coordinate, 'value': value, 'formula': formula})
                if truncated:
                    break
            text = '\n'.join(f"{c['ref']}\t{c['value']}" + (f"\t{c['formula']}" if c['formula'] else '') for c in cells)
            sheets.append({'name': ws.title, 'cells': cells, 'cell_count': len(cells), 'truncated': truncated,
                           'dims': ws.calculate_dimension(), 'text': text})
    finally:
        wb_v.close()
        wb_f.close()
    return {'kind': 'xlsx', 'sheets': sheets, 'sheet_count': len(sheets)}

def index_xlsx(path):
    body=read_xlsx(path)
    missing=[(sh['name'],c) for sh in body['sheets'] for c in sh['cells'] if c['formula'] and c['value'] is None]
    body['formula_cache']={'status':'not_needed','recalculated':0,'missing':len(missing)}
    if missing:
        import tempfile
        from office_convert import convert
        try:
            with tempfile.TemporaryDirectory(prefix='dd-recalc-') as tmp:
                recalculated=read_xlsx(convert(path,tmp,'xlsx'))
            values={(sh['name'],c['ref']):c['value'] for sh in recalculated['sheets'] for c in sh['cells']}
            for name,c in missing:
                c['value']=values.get((name,c['ref']))
                if c['value'] is not None:c['cache_source']='libreoffice_copy'
            body['formula_cache']['recalculated']=sum(c['value'] is not None for _,c in missing)
            body['formula_cache']['status']='recalculated'
        except Exception as e:
            body['formula_cache']['status']='unavailable';body.setdefault('warnings',[]).append('公式無快取值：'+str(e)[:250])
        remaining=sum(c['value'] is None for _,c in missing);body['formula_cache']['missing']=remaining
        if remaining:body.setdefault('warnings',[]).append(f'公式無快取值：{remaining} 格；照抄公式，不得猜值')
    for sh in body['sheets']:
        for c in sh['cells']:
            if c['formula'] and c['value'] is None:c['cache_missing']=True
        sh['text']='\n'.join(f"{c['ref']}\t{c['value'] if c['value'] is not None else '值未快取' if c['formula'] else ''}"+(f"\t{c['formula']}" if c['formula'] else '') for c in sh['cells'])
    return body

def index_pptx(path):
    from pptx import Presentation
    prs=Presentation(path);slides=[]
    def shapes(group):
        for sh in group:
            yield sh
            if getattr(sh,'shape_type',None)==6:yield from shapes(sh.shapes)
    for i,s in enumerate(prs.slides):
        parts=[];charts=[];pictures=False;warnings=[]
        for sh in shapes(s.shapes):
            if getattr(sh,'shape_type',None)==13:pictures=True
            if getattr(sh,'has_text_frame',False) and sh.text_frame.text.strip():parts.append(sh.text_frame.text)
            if getattr(sh,'has_table',False):
                parts.extend('\t'.join(c.text for c in row.cells) for row in sh.table.rows)
            if getattr(sh,'has_chart',False):
                for plot in sh.chart.plots:
                    try:categories=[str(c.label) for c in plot.categories]
                    except (AttributeError,ValueError,TypeError):categories=[]
                    for series in plot.series:
                        try:
                            values=list(series.values);record={'series':series.name,'categories':categories,'values':values}
                            charts.append(record);parts.append('[chart] '+series.name+'\n'+'\n'.join(f"{categories[n] if n<len(categories) else n+1}\t{v}" for n,v in enumerate(values)))
                        except (AttributeError,ValueError,TypeError) as e:warnings.append('圖表資料需視覺核對：'+str(e)[:100]);charts.append({'unreadable':True})
        if s.has_notes_slide and s.notes_slide.notes_text_frame is not None:
            nt=s.notes_slide.notes_text_frame.text.strip()
            if nt:parts.append('[notes] '+nt)
        text='\n'.join(parts)
        slides.append({'n':i+1,'text':text,'chars':len(text),'needs_ocr':False,'needs_visual':pictures or bool(charts),
                       'has_pictures':pictures,'charts':charts,'warnings':warnings,'loc_kind':'slide'})
    return {'kind':'pptx','pages':slides,'page_count':len(slides)}

def index_docx(path):
    try:
        import docx
    except ImportError:
        return {'kind': 'docx', 'pages': [], 'page_count': 0, 'error': 'python-docx not installed'}
    d = docx.Document(path)
    parts = [p.text for p in d.paragraphs if p.text.strip()]
    for t in d.tables:
        for r in t.rows:
            parts.append('\t'.join(c.text for c in r.cells))
    for relation in d.part.rels.values():
        if relation.reltype.endswith('/image') and not relation.is_external:
            visual=image_page(relation.target_part.blob,1,os.path.basename(path),allow_ai=False)
            parts.append('[嵌入圖片 OCR] '+visual['text']+'\n'+'；'.join(visual['warnings']))
    text = '\n'.join(parts)
    # docx 沒有穩定頁碼：以 3,000 字切「頁」
    chunks = [text[i:i + 3000] for i in range(0, max(len(text), 1), 3000)]
    return {'kind': 'docx', 'pages': [{'n': i + 1, 'text': c, 'chars': len(c), 'needs_ocr': False, 'needs_visual':False, 'loc_kind':'segment'} for i, c in enumerate(chunks)],
            'page_count': len(chunks), 'note': '頁碼為 3000 字切分，非原始分頁'}

def index_text(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        text = f.read()
    chunks = [text[i:i + 5000] for i in range(0, max(len(text), 1), 5000)]
    return {'kind': 'text', 'pages': [{'n': i + 1, 'text': c, 'chars': len(c), 'needs_ocr': False, 'needs_visual':False, 'loc_kind':'segment'} for i, c in enumerate(chunks)],
            'page_count': len(chunks), 'note':'段號為 5000 字切分，非原始分頁'}

def index_markup(path, ext):
    from html.parser import HTMLParser
    with open(path, encoding='utf-8', errors='replace') as source:
        text = source.read()
    if ext == '.xml':
        import xml.etree.ElementTree as ET
        tree = ET.fromstring(text)
        text = '\n'.join(node.tag.split('}')[-1]+': '+node.text.strip() for node in tree.iter() if node.text and node.text.strip())
    else:
        class Extract(HTMLParser):
            def __init__(self): super().__init__(); self.parts=[]; self.skip=0
            def handle_starttag(self,tag,attrs):
                if tag in ('script','style'): self.skip+=1
            def handle_endtag(self,tag):
                if tag in ('script','style'): self.skip=max(0,self.skip-1)
            def handle_data(self,data):
                if not self.skip and data.strip(): self.parts.append(data.strip())
        parser=Extract();parser.feed(text);text='\n'.join(parser.parts)
    chunks=[text[i:i+3000] for i in range(0,max(len(text),1),3000)]
    return {'kind':'text','pages':[{'n':i+1,'text':c,'chars':len(c),'needs_ocr':False} for i,c in enumerate(chunks)],'page_count':len(chunks),'note':'結構化文字段落，非實體頁碼'}

def build(path, round_label):
    ext = os.path.splitext(path)[1].lower()
    t0 = time.time()
    if ext == '.pdf':
        body = index_pdf(path)
    elif ext in ('.xlsx', '.xlsm'):
        body = index_xlsx(path)
    elif ext == '.pptx':
        body = index_pptx(path)
    elif ext == '.docx':
        body = index_docx(path)
    elif ext in IMAGE_EXT:
        from render_document import open_image
        with open_image(path) as im:
            pages=[{'n':n+1,'text':'','chars':0,'needs_ocr':True,'needs_visual':True,'extraction':'visual_pending'} for n in range(getattr(im,'n_frames',1))]
        body={'kind':'image','pages':pages,'page_count':len(pages),'needs_ocr_pages':len(pages)}
    elif ext in ('.csv','.tsv'):
        with open(path,'rb') as source: raw=source.read()
        for encoding in ('utf-8-sig','cp950','utf-16'):
            try: text=raw.decode(encoding);break
            except UnicodeError: continue
        else: raise ValueError('無法辨識文字編碼，請轉 UTF-8')
        from openpyxl.utils import get_column_letter
        rows=csv.reader(io.StringIO(text),delimiter='\t' if ext=='.tsv' else ',')
        cells=[{'ref':get_column_letter(c)+str(r),'value':value,'formula':None} for r,row in enumerate(rows,1) for c,value in enumerate(row,1) if value]
        body={'kind':'xlsx','sheets':[{'name':'資料','cells':cells,'dims':'','text':'\n'.join(c['ref']+'\t'+c['value'] for c in cells),'truncated':False}],'sheet_count':1}
    elif ext in ('.html','.htm','.xml'):
        body = index_markup(path, ext)
    elif ext in ('.txt','.md'):
        body = index_text(path)
    else: raise ValueError('不支援的格式；請轉成 PDF、Office XML 或圖片')
    st = os.stat(path)
    body.update({'file': os.path.basename(path), 'round': round_label, 'size': st.st_size, 'mtime': st.st_mtime,
                 'indexed_at': datetime.datetime.now().isoformat(timespec='seconds'), 'seconds': round(time.time() - t0, 2)})
    body['total_chars'] = sum(p.get('chars', 0) for p in body.get('pages', [])) + sum(len(s.get('text', '')) for s in body.get('sheets', []))
    body['schema_version']=SCHEMA_VERSION
    body['needs_visual_pages']=sum(bool(p.get('needs_visual')) for p in body.get('pages',[]))
    body['enrichment']=describe(body) if os.environ.get('QLIST_INDEX_AI')=='1' else {'status':'disabled','summary_zh':'','keywords':[],'coverage':'未啟用額外 AI 描述；原文索引不呼叫模型'}
    body['warnings']=list(dict.fromkeys(body.get('warnings',[])+[w for p in body.get('pages',[]) for w in p.get('warnings',[])]))
    if body['enrichment']['status'] not in ('ready','disabled'): body['warnings'].append('中文 AI 摘要尚未完成，原文仍可搜尋；可重建索引重試')
    body['preprocess_status']='partial' if body.get('needs_ocr_pages') or body['warnings'] or body['enrichment']['status'] not in ('ready','disabled') or any(s.get('truncated') for s in body.get('sheets',[])) else 'ready'
    body['seconds']=round(time.time()-t0,2)
    return body

def save_meta(out, body):
    st = os.stat(out)
    meta = {k: body.get(k) for k in ('kind','page_count','sheet_count','needs_ocr_pages','needs_visual_pages','formula_cache','total_chars','mtime','preprocess_status','warnings','error','enrichment')}
    meta.update(indexSize=st.st_size, indexMtime=st.st_mtime)
    with open(out+'.meta.tmp', 'w', encoding='utf-8') as f:
        json.dump(meta,f)
    os.replace(out+'.meta.tmp',out+'.meta')

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        print(__doc__); sys.exit(2)
    deal = os.path.abspath(args[0])
    force = '--force' in sys.argv
    only = None
    if '--file' in sys.argv:
        only = sys.argv[sys.argv.index('--file') + 1]
        if not os.path.isabs(only) and not os.path.exists(only):
            only = os.path.join(deal, only)  # 相對案件資料夾的路徑（例：round1/x.pdf）
        only = os.path.abspath(only)
    out_dir = os.path.join(deal, '_analysis', 'index')
    os.makedirs(out_dir, exist_ok=True)
    results = []
    documents = list_docs(deal)
    from collections import Counter
    counts = Counter(os.path.basename(p) for p, _ in documents)
    for path, rnd in documents:
        if only and os.path.abspath(path) != only:
            continue
        if counts[os.path.basename(path)] > 1:
            results.append({'file':os.path.basename(path),'error':'同名文件會使來源不明，請先重新命名'})
            continue
        out = os.path.join(out_dir, os.path.basename(path) + '.index.json')
        st = os.stat(path)
        if not force and os.path.exists(out):
            try:
                old = json.load(open(out, encoding='utf-8'))
                if old.get('mtime') == st.st_mtime and old.get('size') == st.st_size and old.get('schema_version') == SCHEMA_VERSION:
                    save_meta(out, old)
                    results.append({'file': os.path.basename(path), 'skipped': True, 'pages': old.get('page_count') or old.get('sheet_count')})
                    continue
            except Exception:
                pass
        try:
            body = build(path, rnd)
            with open(out + '.tmp', 'w', encoding='utf-8') as f:
                json.dump(body, f, ensure_ascii=False)
            os.replace(out + '.tmp', out)
            if body.get('needs_visual_pages'):
                from render_document import render
                try:
                    for r in render(deal,body['file']):body['pages'][r['page']-1]['render_path']=r['path']
                except Exception as e:
                    body['warnings'].append('視覺頁渲染未完成：'+str(e)[:250]);body['preprocess_status']='partial'
                    for page in body.get('pages',[]):
                        if page.get('needs_visual') and not page.get('render_path'):page['render_error']=str(e)[:250]
                with open(out+'.tmp','w',encoding='utf-8') as f:json.dump(body,f,ensure_ascii=False)
                os.replace(out+'.tmp',out)
            save_meta(out,body)
            results.append({'file': body['file'], 'kind': body['kind'], 'pages': body.get('page_count') or body.get('sheet_count'),
                            'needs_ocr_pages': body.get('needs_ocr_pages', 0), 'chars': body['total_chars'], 'seconds': body['seconds']})
        except Exception as e:  # noqa
            body={'file':os.path.basename(path),'round':rnd,'mtime':st.st_mtime,'size':st.st_size,'kind':'error','error':str(e)[:300],'preprocess_status':'failed'}
            with open(out+'.tmp','w',encoding='utf-8') as f: json.dump(body,f,ensure_ascii=False)
            os.replace(out+'.tmp',out);save_meta(out,body)
            results.append({'file': os.path.basename(path), 'error': str(e)[:300]})
    print(json.dumps({'deal': os.path.basename(deal), 'results': results}, ensure_ascii=False))

if __name__ == '__main__':
    main()
