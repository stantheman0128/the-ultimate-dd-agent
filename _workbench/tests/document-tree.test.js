const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {files,resolveDocument}=require('../document-tree');
test('nested originals resolve correctly while duplicates and symlink escapes are rejected',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dd-nested-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const nested=path.join(root,'round1','attachments');fs.mkdirSync(nested,{recursive:true});fs.writeFileSync(path.join(nested,'a.pdf'),'pdf');
 fs.symlinkSync(os.tmpdir(),path.join(nested,'outside'),'dir');
 assert.equal(files(path.join(root,'round1')).length,1);assert.equal(resolveDocument(root,'a.pdf','R1'),path.join(nested,'a.pdf'));
 fs.writeFileSync(path.join(root,'round1','a.pdf'),'duplicate');assert.throws(()=>resolveDocument(root,'a.pdf'),/同名/);assert.throws(()=>resolveDocument(root,'../a.pdf'),/無效/);
});
