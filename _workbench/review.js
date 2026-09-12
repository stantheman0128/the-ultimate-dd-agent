'use strict';
const fs=require('node:fs'),path=require('node:path');
const VERDICTS=['keep','rewrite','suppress_already_answered','merge_duplicate','defer','needs_human_check'];
function validate(review,questions){
 if(!review||!Array.isArray(review.items))throw new Error('review requires items array');
 const ids=new Set(questions.map(q=>q.question_id)),seen=new Set();
 for(const r of review.items){
  if(!ids.has(r.question_id)||seen.has(r.question_id))throw new Error('review has unknown/duplicate question_id');seen.add(r.question_id);
  if(!VERDICTS.includes(r.verdict)||typeof r.reason!=='string'||!r.reason.trim())throw new Error('review requires valid verdict and reason');
  for(const k of ['requested_facets','covered_facets','missing_facets','answered_at','counter_evidence'])if(!Array.isArray(r[k]))throw new Error('review requires '+k);
  for(const e of [...r.answered_at,...r.counter_evidence])if(typeof e.doc!=='string'||!e.doc||typeof e.loc!=='string'||!e.loc)throw new Error('invalid review citation');
  if(!['company_assertion_only','document_supported'].includes(r.source_support))throw new Error('invalid source_support');
  if(r.verdict==='rewrite'&&(!r.revised_question||typeof r.revised_question!=='string'))throw new Error('rewrite requires revised_question');
  if(r.verdict==='suppress_already_answered'&&!r.answered_at.length)throw new Error('suppression requires evidence');
  if(r.verdict==='merge_duplicate'&&(!ids.has(r.merge_with)||r.merge_with===r.question_id))throw new Error('merge requires another existing question');
 }
 return review;
}
function attach(dp,round,result){
 const file=path.join(dp,'_analysis','drafts',`review_R${round}.json`);
 if(!fs.existsSync(file))return result;
 const review=validate(JSON.parse(fs.readFileSync(file,'utf8')),result.questions),byId=new Map(review.items.map(r=>[r.question_id,r]));
 return {...result,review_provenance:review.provenance||null,questions:result.questions.map(q=>{
  const r=byId.get(q.question_id);if(!r)return q;
  const human=q.source==='你';
  return {...q,original_text:q.text,review:r,review_advisory:human,
   q:!human&&r.verdict==='rewrite'?r.revised_question:q.q,
   wave:!human&&r.verdict==='defer'?Math.max(2,Number(q.wave)||1):q.wave};
 })};
}
module.exports={VERDICTS,validate,attach};
