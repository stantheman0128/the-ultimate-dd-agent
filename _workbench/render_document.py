#!/usr/bin/env python3
"""Render only needs_visual pages: render_document.py DEAL FILE [--page N]."""
import argparse, json, os, tempfile
from pathlib import Path
from office_convert import convert

def open_image(source):
    if Path(source).suffix.lower() in ('.heic','.heif'):
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except ImportError as e: raise RuntimeError('HEIC 需要 pillow-heif，請安裝 requirements.txt') from e
    from PIL import Image
    return Image.open(source)

def render(deal, filename, page=None):
    deal=Path(deal).resolve()
    if Path(filename).name!=filename or filename in ('.','..'): raise ValueError('invalid filename')
    index=deal/'_analysis/index'/(filename+'.index.json');d=json.loads(index.read_text())
    from index_doc import list_docs
    candidates=[Path(p).resolve() for p,_ in list_docs(str(deal)) if Path(p).name==filename]
    if len(candidates)!=1:raise ValueError('原始文件不存在或有同名文件，請先重新命名並重建索引')
    source=candidates[0]
    if not source.is_relative_to(deal) or not source.is_file(): raise ValueError('source unavailable or outside deal')
    st=source.stat()
    if abs(st.st_mtime-d.get('mtime',-1))>.001 or st.st_size!=d.get('size'): raise ValueError('原檔已改變，請先重建索引')
    selected=[p['n'] for p in d.get('pages',[]) if p.get('needs_visual') and (page is None or p['n']==page)]
    if page is not None and page not in selected: raise ValueError('此頁未標 needs_visual')
    out=deal/'_analysis/index/_render'/filename;out.mkdir(parents=True,exist_ok=True)
    fingerprint=[st.st_mtime_ns,st.st_size,d.get('schema_version'),2]
    meta=out/'render.json'
    try:cached=json.loads(meta.read_text())
    except (OSError,ValueError):cached={}
    results=[];missing=[]
    for n in selected:
        dest=out/(str(n)+'.png')
        if cached.get('source')==fingerprint and dest.is_file() and str(n) in cached.get('pages',[]):
            results.append({'page':n,'path':str(dest.relative_to(deal))})
        else:missing.append(n)
    if missing:
        with tempfile.TemporaryDirectory(prefix='dd-render-') as tmp:
            pdf=None
            if d['kind'] in ('pdf','pptx'):
                import pymupdf
                pdf=pymupdf.open(str(source if d['kind']=='pdf' else convert(source,tmp,'pdf')))
            try:
                for n in missing:
                    dest=out/(str(n)+'.png');temp=Path(tmp)/(str(n)+'.png')
                    if pdf is not None:
                        if n>len(pdf):raise ValueError('轉換頁数與索引不一致')
                        pdf[n-1].get_pixmap(matrix=pymupdf.Matrix(2,2),alpha=False).save(temp)
                    elif d['kind']=='image':
                        from PIL import ImageOps
                        with open_image(source) as im:
                            im.seek(n-1);ImageOps.exif_transpose(im).convert('RGB').save(temp,format='PNG')
                    else:raise ValueError('此格式尚未支援視覺頁渲染')
                    # Temporary file on the destination filesystem allows atomic replacement.
                    import shutil
                    with tempfile.NamedTemporaryFile(dir=out,suffix='.tmp',delete=False) as f:staged=Path(f.name)
                    try:shutil.copyfile(temp,staged);os.replace(staged,dest)
                    finally:staged.unlink(missing_ok=True)
                    results.append({'page':n,'path':str(dest.relative_to(deal))})
            finally:
                if pdf is not None:pdf.close()
        pages=set(cached.get('pages',[])) if cached.get('source')==fingerprint else set()
        pages.update(str(r['page']) for r in results)
        with tempfile.NamedTemporaryFile(mode='w',dir=out,suffix='.tmp',delete=False) as f:
            json.dump({'source':fingerprint,'pages':sorted(pages)},f);staged=Path(f.name)
        os.replace(staged,meta)
    return sorted(results,key=lambda r:r['page'])

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('deal');p.add_argument('file');p.add_argument('--page',type=int);a=p.parse_args()
    try:print(json.dumps({'pages':render(a.deal,a.file,a.page)},ensure_ascii=False))
    except Exception as e:print(json.dumps({'error':str(e)},ensure_ascii=False));raise SystemExit(1)
