#!/usr/bin/env bash
# Export native Codex engine, public knowledge and synthetic demo only.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="${1:?請指定目標資料夾}"
python3 - "$SRC" "$DST" <<'PY'
from pathlib import Path
import shutil,sys
src,dst=map(lambda s:Path(s).resolve(),sys.argv[1:])
if src==dst or src in dst.parents or dst in src.parents:
    raise SystemExit('來源與目標不能相同或互相包含')
dst.mkdir(parents=True,exist_ok=True)
def ignore(directory,names):
    return [n for n in names if n in {'node_modules','__pycache__','.git','token','auth.json','.env','settings.local.json','run.events.jsonl'} or n.endswith(('.log','.pyc')) or (n.startswith('.env.') and n!='.env.example')]
for name in ['AGENTS.md','CODEX.md','MIGRATION.md','README.md','HACKATHON.md','ROADMAP.md','.gitignore','.codex','.agents','knowledge','演練資料_AcmeRobotics']:
    a,b=src/name,dst/name
    if a.is_dir():
        if b.exists():shutil.rmtree(b)
        shutil.copytree(a,b,ignore=ignore)
    elif a.is_file():
        if name=='README.md' and b.exists() and b.read_bytes()!=a.read_bytes():
            b.write_text(b.read_text().rstrip()+'\n\n'+a.read_text())
        else:shutil.copy2(a,b)
    print('+',name)
w=dst/'_workbench'
if w.exists():shutil.rmtree(w)
w.mkdir()
for name in ['server.js','codex-provider.js','make_xlsx.py','read_xlsx.py','index_doc.py','recompute.py','package.json','package-lock.json','requirements.txt','README.md','export_demo.sh','public','tests']:
    a,b=src/'_workbench'/name,w/name
    if a.is_dir():shutil.copytree(a,b,ignore=ignore)
    else:shutil.copy2(a,b)
print('+ _workbench（不含 dependencies、認證與執行紀錄）')
print('匯出完成；提交前檢查允許目錄內的內容是否仍僅有通用知識與合成資料。')
PY
