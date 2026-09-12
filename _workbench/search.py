#!/usr/bin/env python3
"""Search indexed pages without starting a server: search.py DEAL QUERY [--top 20]."""
import argparse, json, os, subprocess
from pathlib import Path

def search(deal,query,top=20):
    if not 1<=top<=60:raise ValueError('--top must be 1–60')
    root=Path(deal).resolve()
    if not (root/'_analysis/index').is_dir():raise ValueError('案件尚無索引')
    # Reuse the workbench scorer, aliases and weights exactly; no Python/JS drift.
    script="const s=require(process.argv[1]);process.stdout.write(JSON.stringify(s.searchIndex(process.argv[2],process.argv[3],Number(process.argv[4]))));"
    proc=subprocess.run([os.environ.get('NODE_BIN','node'),'-e',script,str(Path(__file__).with_name('server.js')),str(root),query,str(top)],capture_output=True,text=True,timeout=60)
    if proc.returncode:raise RuntimeError(proc.stderr[-600:])
    return json.loads(proc.stdout)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('deal');p.add_argument('query');p.add_argument('--top',type=int,default=20);p.add_argument('--json',action='store_true');a=p.parse_args()
    try:
        rows=search(a.deal,a.query,a.top)
        if a.json:print(json.dumps(rows,ensure_ascii=False))
        else:
            for r in rows:print(f"{r['file']} | {r['loc']} | {r['score']:.4f} | {r['snippet'].replace('|','／')}")
            if not rows:print('查無命中；請改寫查詢或核對索引覆蓋範圍。')
    except Exception as e:p.exit(1,str(e)+'\n')
