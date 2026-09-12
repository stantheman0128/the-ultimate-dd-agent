#!/usr/bin/env python3
"""facts.json 的程式驗算（「算法不同要自己再算一次」交給程式，不交給模型心算）。

用法：python3 _workbench/recompute.py <案件資料夾> [--metrics knowledge/metrics.json] [--dry]

做三件事：
1. derived：fact.derived.formula + inputs → 用受限 eval 重算 computed，和文件揭露值比 delta_pct，填 match。
   fact 沒填 derived 但登記表有公式、且同案其他 fact 提供了輸入指標時，自動補算（auto_derived=True）。
2. 跨文件比對：同一 fact 的 values[] 依 basis 分組；同 basis 差異超過容忍 → conflict；不同 basis 差異 → basis_mismatch；
   只有一個值 → single_source；否則 consistent。只覆寫 status 為空或 "auto" 的列；人工填的 status 不動，但不一致時加 check_note。
3. 印出摘要，並把結果寫回 facts.json（--dry 只印不寫）。
"""
import json, math, re, sys, os, datetime

TOL_DEFAULT = 2.0  # %

def num(v):
    """把 '1,234'、'12%'、'US$3.2M'、'(2,782,281)' 這類字串轉數字；轉不了回 None。"""
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return None
    neg = s.startswith('(') and s.endswith(')')
    s = s.strip('()')
    mult = 1.0
    m = re.search(r'([0-9][0-9,\.]*)\s*([MmKk億萬]?)', s)
    if not m:
        return None
    body = m.group(1).replace(',', '')
    suffix = m.group(2)
    try:
        x = float(body)
    except ValueError:
        return None
    if suffix in ('M', 'm'): mult = 1e6
    elif suffix in ('K', 'k'): mult = 1e3
    elif suffix == '億': mult = 1e8
    elif suffix == '萬': mult = 1e4
    x *= mult
    if '%' in s and x > 1.0:
        x = x / 100.0  # 12% → 0.12（與 0.12 同口徑比較）
    return -x if neg else x

def pct_diff(a, b):
    if a is None or b is None:
        return None
    base = max(abs(a), abs(b), 1e-12)
    return abs(a - b) / base * 100.0

SAFE_FUNCS = {'abs': abs, 'min': min, 'max': max, 'round': round, 'sqrt': math.sqrt}

def safe_eval(formula, inputs):
    names = {k: float(v) for k, v in inputs.items() if num(v) is not None}
    for k, v in inputs.items():
        if k not in names and num(v) is not None:
            names[k] = num(v)
    if not re.fullmatch(r"[A-Za-z0-9_\s\+\-\*/\(\)\.,]+", formula):
        raise ValueError('formula contains disallowed characters')
    return eval(formula, {'__builtins__': {}}, {**SAFE_FUNCS, **names})

def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        print(__doc__); sys.exit(2)
    deal = args[0]
    dry = '--dry' in sys.argv
    mpath = 'knowledge/metrics.json'
    if '--metrics' in sys.argv:
        mpath = sys.argv[sys.argv.index('--metrics') + 1]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.isabs(mpath):
        mpath = os.path.join(root, mpath)
    fpath = os.path.join(deal, '_analysis', 'facts.json')
    facts_doc = load(fpath)
    registry = {m['id']: m for m in load(mpath)['metrics']} if os.path.exists(mpath) else {}
    facts = facts_doc.get('facts', [])

    # (metric, period, entity) → 可用數值（供自動補算）：優先 audited，值彼此相差在容忍內才採用
    def key_of(f):
        return (f.get('metric'), (f.get('period') or '').strip(), (f.get('entity') or '').strip())
    by_key = {}
    for f in facts:
        vs = [(v.get('source_kind'), num(v.get('value'))) for v in f.get('values', [])]
        vs = [(k, x) for k, x in vs if x is not None]
        if not vs:
            continue
        xs = [x for _, x in vs]
        tol_f = float(f.get('tolerance_pct') or registry.get(f.get('metric'), {}).get('tolerance_pct') or TOL_DEFAULT)
        if pct_diff(min(xs), max(xs)) > tol_f:
            continue  # 彼此矛盾的值不拿來當輸入
        audited = [x for k, x in vs if k == 'audited']
        by_key.setdefault(key_of(f), audited[0] if audited else xs[0])

    summary = {'derived': 0, 'derived_mismatch': 0, 'auto_derived': 0, 'conflict': 0, 'basis_mismatch': 0, 'single_source': 0, 'consistent': 0, 'unverified': 0}

    for f in facts:
        metric = registry.get(f.get('metric'), {})
        tol = float(f.get('tolerance_pct') or metric.get('tolerance_pct') or TOL_DEFAULT)
        disclosed = [num(v.get('value')) for v in f.get('values', [])]
        disclosed = [d for d in disclosed if d is not None]

        # 1. derived
        d = f.get('derived')
        if (not d) and metric.get('formula'):
            needed = re.findall(r'[A-Za-z_][A-Za-z0-9_]*', metric['formula'])
            needed = [n for n in needed if n not in SAFE_FUNCS]
            period = (f.get('period') or '').strip(); entity = (f.get('entity') or '').strip()
            found = {n: by_key.get((n, period, entity)) for n in needed}
            if all(v is not None for v in found.values()):
                d = {'formula': metric['formula'], 'inputs': found, 'auto_derived': True, 'note': f'自動補算（同期間 {period}、同實體 {entity} 的輸入）'}
                f['derived'] = d
                summary['auto_derived'] += 1
        if d and d.get('formula') and d.get('inputs'):
            try:
                computed = safe_eval(d['formula'], d['inputs'])
                d['computed'] = computed
                if disclosed:
                    deltas = [pct_diff(computed, x) for x in disclosed]
                    d['delta_pct'] = round(min(deltas), 2)
                    d['match'] = d['delta_pct'] <= tol
                    summary['derived'] += 1
                    if not d['match']:
                        summary['derived_mismatch'] += 1
                else:
                    d['match'] = None
                d.pop('error', None)
            except Exception as e:  # noqa
                d['error'] = str(e)

        # 2. 跨文件比對：basis＝口徑（含硬體 / fully diluted / GAAP…），unspecified 視為與任何口徑可比
        groups = {}
        for v in f.get('values', []):
            x = num(v.get('value'))
            if x is None:
                continue
            groups.setdefault((v.get('basis') or 'unspecified').strip().lower(), []).append(x)
        auto = (not f.get('status')) or f.get('status') == 'auto'
        new_status = None
        if len(disclosed) <= 1:
            new_status = 'single_source' if disclosed or f.get('values') else 'unverified'
        else:
            specified = [b for b in groups if b != 'unspecified']
            same_basis_conflict = any(pct_diff(min(g), max(g)) > tol for g in groups.values() if len(g) > 1)
            all_vals = [x for g in groups.values() for x in g]
            overall_diff = pct_diff(min(all_vals), max(all_vals)) if all_vals else 0
            if same_basis_conflict:
                new_status = 'conflict'
            elif overall_diff > tol and len(set(specified)) > 1:
                new_status = 'basis_mismatch'
            elif overall_diff > tol:
                new_status = 'conflict'
            else:
                new_status = 'consistent'
        if d and d.get('match') is False and new_status in ('consistent', 'single_source', None):
            new_status = 'conflict'  # 揭露值與程式重算對不上
        if auto:
            f['status'] = new_status
        elif disclosed and new_status and new_status != f.get('status'):
            f['check_note'] = f'recompute 判定 {new_status}，人工標 {f.get("status")}'
        summary[f.get('status', 'unverified')] = summary.get(f.get('status', 'unverified'), 0) + 1

    facts_doc['recomputed_at'] = datetime.datetime.now().isoformat(timespec='seconds')
    facts_doc['recompute_summary'] = summary
    if not dry:
        with open(fpath, 'w', encoding='utf-8') as fh:
            json.dump(facts_doc, fh, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False))
    for f in facts:
        d = f.get('derived') or {}
        flag = ''
        if d.get('match') is False:
            flag = f"  ⚠ 重算 {d.get('computed'):.4g} vs 揭露 {[num(v.get('value')) for v in f.get('values', [])]} (Δ{d.get('delta_pct')}%)"
        print(f"{f.get('id','?'):>5} {f.get('status','?'):15} {f.get('severity','-'):6} {f.get('label','')}{flag}")

if __name__ == '__main__':
    main()
