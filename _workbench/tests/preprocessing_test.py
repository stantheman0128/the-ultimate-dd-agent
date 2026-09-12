import unittest, tempfile, os, sys, json
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import index_doc as idx
import document_enrichment as enrich
import retrieval
from PIL import Image, ImageDraw, ImageFont
from openpyxl import Workbook
import pymupdf

class Preprocessing(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.env=patch.dict(os.environ,{'QLIST_INDEX_AI':'0'});self.env.start();self.addCleanup(self.env.stop)
 def test_images_and_scanned_pdf(self):
  im=Image.new('RGB',(1200,500),'white');draw=ImageDraw.Draw(im)
  font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',48) if Path('/System/Library/Fonts/Supplemental/Arial.ttf').exists() else ImageFont.load_default(size=48)
  draw.text((50,80),'Invoice Total USD 18600',font=font,fill='black')
  for ext in ('png','jpg','webp','tiff','bmp','gif'):
   file=self.root/('image.'+ext);im.save(file);r=idx.build(str(file),'R1')
   self.assertEqual(r['kind'],'image');self.assertEqual(r['page_count'],1)
   if enrich.tessdata():self.assertIn('18600',r['pages'][0]['text'])
  pdf=pymupdf.open();page=pdf.new_page();page.insert_image(page.rect,filename=str(self.root/'image.png'));pdf.save(self.root/'scan.pdf');pdf.close()
  r=idx.build(str(self.root/'scan.pdf'),'R1');self.assertEqual(r['kind'],'pdf')
  if enrich.tessdata():self.assertIn('18600',r['pages'][0]['text'])
 def test_structured_csv_and_formula(self):
  f=self.root/'x.csv';f.write_bytes('客戶,營收\n極光,18600\n'.encode('cp950'));r=idx.build(str(f),'R1')
  self.assertEqual(r['sheets'][0]['cells'][2]['value'],'極光')
  w=Workbook();w.active.append(['Revenue',100]);w.active.append(['Total','=SUM(B1:B1)']);w.save(self.root/'x.xlsx')
  r=idx.build(str(self.root/'x.xlsx'),'R1');self.assertEqual(r['sheets'][0]['cells'][-1]['formula'],'=SUM(B1:B1)')
 def test_chinese_search_english_sources_and_generated_separation(self):
  f=self.root/'odd.pdf';pdf=pymupdf.open();page=pdf.new_page();page.insert_text((50,50),'Equipment pledged as collateral');pdf.save(f);pdf.close()
  body=idx.build(str(f),'R1');body['enrichment']={'summary_zh':'銀行貸款設備質押條款','keywords':['銀行同意','bank consent'],'coverage':'取樣'}
  folder=self.root/'_analysis'/'index';folder.mkdir(parents=True);(folder/'odd.pdf.index.json').write_text(json.dumps(body))
  db,warnings=retrieval.prepare(self.root)
  try:
   result=retrieval.execute(db,{'op':'search','query':'設備質押'},warnings);self.assertTrue(any(m['page']==1 for m in result['matches']))
   meta=[m for m in result['matches'] if m['kind']=='metadata'];self.assertTrue(meta);self.assertIn('不是原文證據',meta[0]['snippet'])
  finally:db.close()
 def test_summary_failure_preserves_native_and_is_visible(self):
  f=self.root/'x.txt';f.write_text('Revenue is USD 18600')
  r=idx.build(str(f),'R1');self.assertIn('18600',r['pages'][0]['text']);self.assertEqual(r['preprocess_status'],'partial')
  with self.assertRaises(ValueError):idx.build(str(self.root/'x.exe'),'R1')
 def test_description_sampling_includes_last_page_and_is_bounded(self):
  def fake(req):
   self.assertLess(len(req['text']),20000);self.assertIn('p.1000',req['text']);return {'summary_zh':'取樣年報'}
  with patch.object(enrich,'ai',fake):
   r=enrich.describe({'file':'big.pdf','pages':[{'n':i+1,'text':'revenue '*1000} for i in range(1000)]})
  self.assertEqual(len(r['sampled_locations']),32)
if __name__=='__main__':unittest.main()
