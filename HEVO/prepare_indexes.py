#!/usr/bin/env python3
"""Validate shared source bytes and bind existing indexes to this checkout."""
import hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parent
entries=json.loads((root/'index-sources.json').read_text())
for row in entries:
 source=root/row['source']
 if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest()!=row['sha256']:
  raise SystemExit('Source changed or missing: '+row['source']+'; rebuild its index.')
for row in entries:
 p=root/row['index']; source=root/row['source']; d=json.loads(p.read_text()); st=source.stat()
 d['mtime']=st.st_mtime;d['size']=st.st_size
 p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
print(f'Ready: {len(entries)} validated indexes. Schema and coverage flags preserved.')
