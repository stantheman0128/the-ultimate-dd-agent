"""Rebuildable private FTS5 index. Canonical content lives in Markdown entries."""
import sys,json,sqlite3,pathlib,re,os
r=json.load(sys.stdin)
root=pathlib.Path(r['root']);root.mkdir(parents=True,exist_ok=True)
db=root/'memory.sqlite3'
con=sqlite3.connect(db);os.chmod(db,0o600)
con.execute('PRAGMA secure_delete=ON')
con.execute('CREATE TABLE IF NOT EXISTS entries (file TEXT PRIMARY KEY, stamp TEXT, scope TEXT, payload TEXT)')
con.execute('CREATE VIRTUAL TABLE IF NOT EXISTS terms USING fts5(file UNINDEXED, scope UNINDEXED, text)')
def tokens(text):
    parts=re.findall(r'[a-z0-9_]+|[\u3400-\u9fff]+',text.lower());out=[]
    for p in parts:
        if re.match('[\u3400-\u9fff]',p):
            out += [p[i:i+2] for i in range(max(1,len(p)-1))]
        else: out.append(p)
    return out
for scope,directory in r['directories']:
    seen=set()
    for f in (pathlib.Path(directory)/'entries').glob('*.md'):
        name=str(f);seen.add(name);st=f.stat();stamp=f'{st.st_mtime_ns}:{st.st_size}'
        old=con.execute('SELECT stamp FROM entries WHERE file=?',(name,)).fetchone()
        if old and old[0]==stamp:continue
        raw=f.read_text();item=json.loads(raw.split('```json\n',1)[1].rsplit('\n```',1)[0])
        con.execute('DELETE FROM terms WHERE file=?',(name,))
        con.execute('DELETE FROM entries WHERE file=?',(name,))
        if item.get('status')!='active':continue
        payload={k:item.get(k) for k in ['id','scope','title','certainty','revision']};payload['excerpt']=item['content'][:300]
        con.execute('INSERT INTO entries VALUES(?,?,?,?)',(name,stamp,scope,json.dumps(payload,ensure_ascii=False)))
        con.execute('INSERT INTO terms VALUES(?,?,?)',(name,scope,' '.join(tokens(item['title']+' '+item['content']))))
    for (name,) in con.execute('SELECT file FROM entries WHERE scope=?',(scope,)).fetchall():
        if name not in seen:
            con.execute('DELETE FROM terms WHERE file=?',(name,));con.execute('DELETE FROM entries WHERE file=?',(name,))
con.commit()
query=' OR '.join('"'+t.replace('"','""')+'"' for t in dict.fromkeys(tokens(r['query'])))
scopes=[s for s,_ in r['directories']]
rows=[]
if query and scopes:
    rows=con.execute('SELECT entries.payload FROM terms JOIN entries ON entries.file=terms.file WHERE terms MATCH ? AND entries.scope IN ('+','.join('?'*len(scopes))+') ORDER BY rank LIMIT ?', [query,*scopes,r.get('limit',8)]).fetchall()
print(json.dumps([json.loads(x[0]) for x in rows],ensure_ascii=False))
con.close()
