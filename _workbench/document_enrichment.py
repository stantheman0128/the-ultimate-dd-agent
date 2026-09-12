"""OCR and bounded multilingual descriptions, separate from source extraction."""
import os, json, subprocess, base64, io
from pathlib import Path
VERSION = 1

def ai(request):
    if os.environ.get('QLIST_INDEX_AI') == '0': return {'unavailable': True}
    try:
        p = subprocess.run([os.environ.get('NODE_BIN','node'), str(Path(__file__).with_name('enrich-document.js'))],input=json.dumps(request),text=True,capture_output=True,timeout=210)
        return json.loads(p.stdout)
    except Exception as e: return {'error': str(e)[:200]}

def tessdata():
    candidates=[os.environ.get('TESSDATA_PREFIX',''), str(Path(__file__).parent/'.tessdata'), '/opt/homebrew/share/tessdata','/usr/share/tesseract-ocr/5/tessdata']
    for folder in candidates:
        if folder and all((Path(folder)/(lang+'.traineddata')).is_file() for lang in ['eng','chi_tra']):return folder
    return None

def image_page(blob, number=1, file='image', allow_ai=True):
    from PIL import Image, ImageOps
    import pymupdf
    with Image.open(io.BytesIO(blob)) as original:
        im=ImageOps.exif_transpose(original).convert('RGB')
        original_size=im.size
        im.thumbnail((2400,2400))
        out=io.BytesIO();im.save(out,format='PNG');png=out.getvalue()
    text='';warnings=[];method='none'
    td=tessdata()
    if td:
        try:
            pix=pymupdf.Pixmap(png)
            with pymupdf.open('pdf',pix.pdfocr_tobytes(language='chi_tra+eng',tessdata=td)) as pdf:
                text=pdf[0].get_text(sort=True)
            method='tesseract'
        except Exception: warnings.append('本地 OCR 失敗')
    else:warnings.append('尚未安裝繁體中文／英文 OCR 語言資料')
    result=ai({'mode':'image','file':file,'text':text[:12000],'image':'data:image/png;base64,'+base64.b64encode(png).decode()}) if allow_ai else {}
    if result.get('transcription'):
        text=result['transcription'];method='vision'
    warnings+=result.get('warnings',[])
    if result.get('error') or result.get('unavailable'):warnings.append('AI 視覺描述未完成；僅使用本地 OCR')
    if original_size!=im.size:warnings.append('辨識影像已縮至最長邊2400px，細字請核對原圖')
    if not text.strip():warnings.append('未抽出文字；不代表圖片沒有內容')
    return {'n':number,'text':text,'chars':len(text),'needs_ocr':not bool(text.strip()),'extraction':method,'summary_zh':result.get('summary_zh',''),'keywords':result.get('keywords',[]),'warnings':warnings,'ai_usage':result.get('usage')}

def describe(body):
    units=[('p.'+str(p['n']),p.get('text','')+'\n'+p.get('summary_zh','')) for p in body.get('pages',[])]
    units += [(s['name'],s.get('text','')) for s in body.get('sheets',[])]
    # Evenly distributed samples, including the last page, with explicit source locations.
    selected=sorted(set(round(i*(len(units)-1)/min(31,max(1,len(units)-1))) for i in range(min(32,len(units))))) if units else []
    sample='\n'.join('['+units[i][0]+'] '+units[i][1][:550] for i in selected)
    result=ai({'mode':'text','file':body['file'],'text':sample}) if sample.strip() else {'unavailable':True}
    status='ready' if result.get('summary_zh') else 'unavailable'
    return {'version':VERSION,'status':status,'summary_zh':result.get('summary_zh',''),'keywords':result.get('keywords',[]),'sampled_locations':[units[i][0] for i in selected], 'coverage':'取樣導覽；原文另行完整索引，摘要不代表已覆蓋全文件','warnings':result.get('warnings',[]),'model':result.get('model'),'usage':result.get('usage')}
