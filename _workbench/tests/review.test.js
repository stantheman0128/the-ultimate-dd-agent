const test=require('node:test'),assert=require('node:assert/strict');
const {validate}=require('../review');
const questions=[{question_id:'q-r1-001'},{question_id:'q-r1-002'}];
const item={question_id:'q-r1-001',verdict:'rewrite',reason:'需要釐清口徑',requested_facets:['口徑'],covered_facets:[],missing_facets:['口徑'],answered_at:[],counter_evidence:[],source_support:'company_assertion_only',revised_question:'請說明計算口徑。'};
test('Reviewer schema rejects suppression without evidence and invalid merge targets',()=>{
 validate({items:[item]},questions);
 assert.throws(()=>validate({items:[{...item,verdict:'suppress_already_answered'}]},questions),/requires evidence/);
 assert.throws(()=>validate({items:[{...item,verdict:'merge_duplicate',merge_with:'q-r1-001'}]},questions),/another existing/);
 assert.throws(()=>validate({items:[{...item,verdict:'delete'}]},questions),/valid verdict/);
 assert.throws(()=>validate({items:[item,item]},questions),/duplicate/);
});
