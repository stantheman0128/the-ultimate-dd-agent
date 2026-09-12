"""Convert a temporary copy using an isolated LibreOffice profile; never edit the source."""
import os, shutil, subprocess, tempfile
from pathlib import Path

def office_bin():
    return os.environ.get('LIBREOFFICE_BIN') or shutil.which('libreoffice') or shutil.which('soffice')

def convert(source, output_dir, target):
    source=Path(source).resolve();output_dir=Path(output_dir).resolve();output_dir.mkdir(parents=True,exist_ok=True)
    binary=office_bin()
    if not binary: raise RuntimeError('未安裝 LibreOffice，無法轉換／重算副本')
    with tempfile.TemporaryDirectory(prefix='dd-office-') as tmp:
        work=Path(tmp);profile=work/'profile';user=profile/'user';user.mkdir(parents=True)
        # Disable macros and external document link updates in this disposable profile.
        (user/'registrymodifications.xcu').write_text('''<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item></oor:items>''')
        copied=work/source.name;shutil.copy2(source,copied)
        p=subprocess.run([binary,'-env:UserInstallation='+profile.as_uri(),'--headless','--convert-to',target,'--outdir',str(output_dir),str(copied)],capture_output=True,text=True,timeout=90)
        dest=output_dir/(source.stem+'.'+target.split(':')[0])
        if p.returncode or not dest.is_file(): raise RuntimeError('LibreOffice 轉換失敗：'+(p.stderr or p.stdout)[-400:])
        return dest
