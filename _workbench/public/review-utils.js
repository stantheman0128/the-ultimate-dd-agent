/* Shared, testable presentation rules for findings and process diagnostics. */
(function(root){
 const priority={conflict:0,basis_mismatch:1,unverified:2,single_source:3,consistent:4};
 const labels={conflict:'資料不一致',basis_mismatch:'口徑待釐清',unverified:'尚待確認',single_source:'待交叉驗證',consistent:'核對一致'};
 function findings(facts,filter,query){const q=(query||'').trim().toLowerCase();return facts.filter(f=>(!filter||(filter==='issues'?f.status!=='consistent':f.status===filter))&&(!q||[f.label,f.id,f.note,...(f.values||[]).map(v=>String(v.value))].join(' ').toLowerCase().includes(q))).sort((a,b)=>(priority[a.status]??2)-(priority[b.status]??2));}
 function isDiagnostic(e){return e.kind==='stderr'||e.kind==='command_error'||(e.kind==='error'&&/^指令 exit=/.test(e.text||''));}
 function runState(events,running){const exit=[...events].reverse().find(e=>e.kind==='exit');const error=events.some(e=>e.kind==='error'&&!isDiagnostic(e));const match=exit&&String(exit.text).match(/exit=(-?\d+)/);if(running)return {label:'分析進行中',level:'running'};if(match&&match[1]!=='0')return {label:'分析未完成',level:'error'};if(error)return {label:'有執行錯誤，請查看紀錄',level:'error'};if(match&&match[1]==='0')return {label:events.some(isDiagnostic)?'分析完成（含過程警告）':'分析完成',level:'success'};return {label:'尚無完成狀態',level:'unknown'};}
 const api={labels,findings,runState,isDiagnostic};if(typeof module!=='undefined')module.exports=api;else root.ReviewUI=api;
})(typeof window==='undefined'?{}:window);
