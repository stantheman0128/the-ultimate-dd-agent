#!/usr/bin/env python3
"""Install official Tesseract fast language data (Apache-2.0) locally."""
from pathlib import Path
from urllib.request import urlopen
root=Path(__file__).resolve().parent/'.tessdata'
root.mkdir(exist_ok=True)
for name in ['eng.traineddata','chi_tra.traineddata','LICENSE']:
    target=root/name
    if target.exists():continue
    with urlopen('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/'+name,timeout=60) as r:
        data=r.read()
    temp=target.with_suffix(target.suffix+'.tmp');temp.write_bytes(data);temp.replace(target)
    print('Installed',name)
