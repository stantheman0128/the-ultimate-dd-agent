#!/usr/bin/env python3
"""Plan bounded document extraction units: shard_plan.py DEAL [FILE]."""
import json, os, sys
from pathlib import Path

def est_tokens(text):
    cjk = sum('\u3400' <= c <= '\u9fff' for c in text)
    return int((len(text)-cjk)/3.2 + cjk*1.2 + .5)

def plan(deal, only=None, budget=None):
    budget = int(budget or os.environ.get('QLIST_SHARD_TOKENS', 60000))
    if budget <= 0:
        raise ValueError('QLIST_SHARD_TOKENS must be positive')
    out = []
    for fp in sorted((Path(deal)/'_analysis/index').glob('*.index.json')):
        d = json.loads(fp.read_text())
        if only and d['file'] != Path(only).name:
            continue
        sheets = d.get('kind') == 'xlsx'
        units = d.get('sheets', []) if sheets else d.get('pages', [])
        groups, group, tokens = [], [], 0
        for i, u in enumerate(units):
            cost = est_tokens(u.get('text') or json.dumps(u.get('cells', []), ensure_ascii=False))
            if group and tokens + cost > budget:
                groups.append((group, tokens)); group, tokens = [], 0
            group.append((i+1, u)); tokens += cost
        if group:
            groups.append((group, tokens))
        for n, (g, cost) in enumerate(groups, 1):
            row = {'file':d['file'], 'part':n, 'pages':[g[0][0],g[-1][0]], 'est_tokens':cost,
                   'output':f"cards/{d['file']}"+(f'.part-{n:02d}.md' if len(groups)>1 else '.md')}
            if sheets:
                row['sheets'] = [u['name'] for _, u in g]
            if cost > budget:
                row['warning'] = 'single unit exceeds budget; extract in bounded cell/text ranges'
            out.append(row)
    return out

if __name__ == '__main__':
    print(json.dumps(plan(sys.argv[1], sys.argv[2] if len(sys.argv)>2 else None), ensure_ascii=False))
