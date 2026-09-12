#!/usr/bin/env python3
"""Data Room 文件索引：上傳時抽取「每頁文字 / 每格值與公式」，寫到 <案件>/_analysis/index/<檔名>.index.json。

用法：
  python3 _workbench/index_doc.py <案件資料夾>                 # 索引全部文件（已索引且未變動者略過）
  python3 _workbench/index_doc.py <案件資料夾> --file <路徑>   # 只索引這一份（相對案件資料夾或絕對路徑）
  python3 _workbench/index_doc.py <案件資料夾> --force         # 全部重建

索引是引擎與工作台共用的「可定位層」：
- card-extractor 讀它做字卡（掃描頁 needs_ocr=true 時才回頭用視覺讀原檔）
- /api/search 用它搜原文、/api/page 用它回單頁、/api/ask 用它組 context 並標出處 [檔名 p.N] / [檔名 工作表!B4]
"""
import json, os, sys, time, datetime, re, csv, io
from document_enrichment import image_page, describe
SCHEMA_VERSION = 2
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif"}

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
            for f in sorted(os.listdir(p)):
                if not f.startswith(SKIP_PREFIX):
                    out.append((os.path.join(p, f), 'R' + e[5:]))
        elif os.path.isfile(p) and not e.startswith(SKIP_PREFIX) and e != '_notes.md' and not is_qlist(e):
            out.append((p, '未分輪'))
    return [(p, r) for p, r in out if os.path.isfile(p) and not os.path.islink(p)]

def index_pdf(path):
    import pymupdf
    doc = pymupdf.open(path)
    pages, ocr_pages = [], 0
    for i, page in enumerate(doc):
        text = page.get_text('text', sort=True) or ''
        # Native text can coexist with scanned sections. OCR image-bearing pages as well.
        needs_ocr = len(text.strip()) < OCR_MIN_CHARS or bool(page.get_images(full=False))
        entry = {'n':i+1,'text':text,'chars':len(text),'needs_ocr':False,'extraction':'native','blocks':[{'bbox':list(b[:4]),'text':b[4]} for b in page.get_text('blocks',sort=True) if b[6]==0]}
        if needs_ocr:
            pix = page.get_pixmap(matrix=__import__('pymupdf').Matrix(2,2), alpha=False)
            visual = image_page(pix.tobytes('png'), i+1, os.path.basename(path))
            # Keep native extraction even if OCR / vision fails.
            if text.strip():
                visual['text'] = text + '\n[影像區域辨識，可能與原生文字重複]\n' + visual['text']
                visual['chars'] = len(visual['text'])
            entry = visual
        if entry['needs_ocr']: ocr_pages += 1
        pages.append(entry)
    doc.close()
    return {'kind': 'pdf', 'pages': pages, 'page_count': len(pages), 'needs_ocr_pages': ocr_pages}

def index_xlsx(path):
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

def index_pptx(path):
    from pptx import Presentation
    prs = Presentation(path)
    slides = []
    for i, s in enumerate(prs.slides):
        parts = []
        for sh in s.shapes:
            if getattr(sh,'shape_type',None) == 13:
                visual=image_page(sh.image.blob,i+1,os.path.basename(path))
                parts.append('[嵌入圖片辨識] '+visual['text']+'\n[AI 圖片描述] '+visual['summary_zh']+'\n'+'；'.join(visual['warnings']))
            if sh.has_text_frame and sh.text_frame.text.strip():
                parts.append(sh.text_frame.text)
            if getattr(sh, 'has_table', False) and sh.has_table:
                for r in sh.table.rows:
                    parts.append('\t'.join(c.text for c in r.cells))
        if s.has_notes_slide and s.notes_slide.notes_text_frame is not None:
            nt = s.notes_slide.notes_text_frame.text.strip()
            if nt:
                parts.append('[notes] ' + nt)
        text = '\n'.join(parts)
        slides.append({'n': i + 1, 'text': text, 'chars': len(text), 'needs_ocr': len(text.strip()) < OCR_MIN_CHARS})
    return {'kind': 'pptx', 'pages': slides, 'page_count': len(slides)}

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
            visual=image_page(relation.target_part.blob,1,os.path.basename(path))
            parts.append('[嵌入圖片 OCR] '+visual['text']+'\n[AI 圖片描述] '+visual['summary_zh']+'\n'+'；'.join(visual['warnings']))
    text = '\n'.join(parts)
    # docx 沒有穩定頁碼：以 3,000 字切「頁」
    chunks = [text[i:i + 3000] for i in range(0, max(len(text), 1), 3000)]
    return {'kind': 'docx', 'pages': [{'n': i + 1, 'text': c, 'chars': len(c), 'needs_ocr': False} for i, c in enumerate(chunks)],
            'page_count': len(chunks), 'note': '頁碼為 3000 字切分，非原始分頁'}

def index_text(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        text = f.read()
    chunks = [text[i:i + 5000] for i in range(0, max(len(text), 1), 5000)]
    return {'kind': 'text', 'pages': [{'n': i + 1, 'text': c, 'chars': len(c), 'needs_ocr': False} for i, c in enumerate(chunks)],
            'page_count': len(chunks)}

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
        from PIL import Image, ImageSequence, ImageOps
        pages=[]
        with Image.open(path) as im:
            for n,frame in enumerate(ImageSequence.Iterator(im)):
                buf=io.BytesIO(); ImageOps.exif_transpose(frame).convert('RGB').save(buf,format='PNG')
                pages.append(image_page(buf.getvalue(),n+1,os.path.basename(path)))
        body={'kind':'image','pages':pages,'page_count':len(pages),'needs_ocr_pages':sum(p['needs_ocr'] for p in pages)}
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
    elif ext in ('.txt','.md'):
        body = index_text(path)
    else: raise ValueError('不支援的格式；請轉成 PDF、Office XML 或圖片')
    st = os.stat(path)
    body.update({'file': os.path.basename(path), 'round': round_label, 'size': st.st_size, 'mtime': st.st_mtime,
                 'indexed_at': datetime.datetime.now().isoformat(timespec='seconds'), 'seconds': round(time.time() - t0, 2)})
    body['total_chars'] = sum(p.get('chars', 0) for p in body.get('pages', [])) + sum(len(s.get('text', '')) for s in body.get('sheets', []))
    body['schema_version']=SCHEMA_VERSION
    body['enrichment']=describe(body)
    body['warnings']=list(dict.fromkeys([w for p in body.get('pages',[]) for w in p.get('warnings',[])]))
    if body['enrichment']['status']!='ready': body['warnings'].append('中文 AI 摘要尚未完成，原文仍可搜尋；可重建索引重試')
    body['preprocess_status']='partial' if body.get('needs_ocr_pages') or body['warnings'] or body['enrichment']['status']!='ready' or any(s.get('truncated') for s in body.get('sheets',[])) else 'ready'
    body['seconds']=round(time.time()-t0,2)
    return body

def save_meta(out, body):
    st = os.stat(out)
    meta = {k: body.get(k) for k in ('kind','page_count','sheet_count','needs_ocr_pages','total_chars','mtime','preprocess_status','warnings','error','enrichment')}
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
    for path, rnd in list_docs(deal):
        if only and os.path.abspath(path) != only:
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
