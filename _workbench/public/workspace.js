/* Lucide icons are local, decorative, and always paired with visible labels. */
function decorateWorkspace(){
 const nav={chat:'message-square',overview:'layout-dashboard',docs:'folder-open',recon:'git-compare-arrows',review:'list-checks',search:'search',notes:'notebook-pen',help:'circle-help'};
 document.querySelectorAll('button, summary').forEach(b=>{
  if(b.classList.contains('deal')||b.classList.contains('ibtn')||b.querySelector('.ui-icon'))return;
  const t=b.textContent.trim();
  const name=nav[b.dataset.t]||b.dataset.icon||(/^新增|新對話|新討論/.test(t)?'plus':/送出提問|送出 ↑/.test(t)?'arrow-up':/開始盡調|重新分析/.test(t)?'play':/上傳|加入文件/.test(t)?'upload':/下載|匯出/.test(t)?'download':/設定|進階/.test(t)?'settings-2':/複製/.test(t)?'copy':/停止/.test(t)?'circle-stop':/重建|重新整理/.test(t)?'refresh-cw':/審核/.test(t)?'clipboard-check':null);
  if(!name)return;
  const icon=document.createElement('span');icon.className='ui-icon';icon.style.setProperty('--icon',`url('/icons/${name}.svg')`);icon.setAttribute('aria-hidden','true');b.prepend(icon);
 });
 document.querySelectorAll('.tabs .tab').forEach(b=>b.setAttribute('aria-current',b.classList.contains('on')?'page':'false'));
}
function updateWorkflow(){
 if(typeof D==='undefined'||!D)return;
 const stage=D.state.closed?3:D.state.lifecycle==='drafted'?2:D.docs?.length?1:0;
 document.querySelectorAll('.workflow button').forEach((b,i)=>{b.classList.toggle('current',i===stage);if(i===stage)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
}
document.addEventListener('DOMContentLoaded',()=>{
 const remove=document.getElementById('delCaseBtn');if(remove)document.querySelector('.more-content').append(remove);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.more-menu[open]').forEach(x=>x.open=false)});
 document.addEventListener('click',e=>document.querySelectorAll('.more-menu[open]').forEach(x=>{if(!x.contains(e.target))x.open=false}));
 decorateWorkspace();updateWorkflow();
 let pending=false;new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;decorateWorkspace();updateWorkflow()})}).observe(document.querySelector('.app'),{childList:true,subtree:true});
});
// Dialogs share focus management; Escape closes the topmost visible dialog.
document.addEventListener('DOMContentLoaded',()=>{
 const labels={ncOverlay:'新增案件',cardOverlay:'文件摘要',pvOverlay:'文件預覽',runOverlay:'分析進度',evOverlay:'資料來源'};
 let returnFocus=null;
 document.querySelectorAll('.overlay').forEach(dialog=>{
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',labels[dialog.id]||'視窗');
  new MutationObserver(()=>{if(dialog.classList.contains('on')){returnFocus=document.activeElement;const first=dialog.querySelector('input,textarea,button');first?.focus();}else if(returnFocus?.isConnected)returnFocus.focus();}).observe(dialog,{attributes:true,attributeFilter:['class']});
 });
 document.addEventListener('keydown',event=>{
  const open=Array.from(document.querySelectorAll('.overlay.on')).at(-1);if(!open)return;
  if(event.key==='Escape'){event.preventDefault();if(open.id==='inputOverlay')finishWorkspaceInput(false);else hide(open.id);return;}
  if(event.key==='Tab'){const nodes=Array.from(open.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')).filter(e=>!e.disabled&&e.getClientRects().length);if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
 });
 const upload=document.getElementById('dz');upload.setAttribute('role','button');upload.setAttribute('tabindex','0');upload.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();document.getElementById('fileInput').click()}});
});
let inputResolve=null;
function workspaceInput({title,label,hint,value='',secret=false}){
 if(inputResolve)finishWorkspaceInput(false);
 document.getElementById('inputTitle').textContent=title;document.getElementById('inputLabel').textContent=label;document.getElementById('inputHint').textContent=hint;
 const field=document.getElementById('workspaceInputValue');field.type=secret?'password':'text';field.value=value;field.placeholder=secret?'sk-…':'';
 show('inputOverlay');return new Promise(resolve=>inputResolve=resolve);
}
function finishWorkspaceInput(save){const resolve=inputResolve;inputResolve=null;const value=document.getElementById('workspaceInputValue').value;document.getElementById('workspaceInputValue').value='';hide('inputOverlay');resolve?.(save?value:null);}
function filterCases(){const query=document.getElementById('caseFilter').value.trim().toLocaleLowerCase();let shown=0;document.querySelectorAll('.deal-entry').forEach(row=>{const match=row.querySelector('.deal').dataset.name.toLocaleLowerCase().includes(query);row.hidden=!match;if(match)shown++});document.getElementById('caseFilterEmpty').hidden=shown>0;}
document.addEventListener('DOMContentLoaded',()=>{
 const filter=document.getElementById('caseFilter');new MutationObserver(filterCases).observe(document.getElementById('dealList'),{childList:true});
 document.getElementById('notesTa').addEventListener('input',()=>document.getElementById('notesStatus').textContent='有未儲存的修改');
 document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&!document.querySelector('.overlay.on, dialog[open]')){e.preventDefault();pickTab('search');document.getElementById('kbQ').focus();}});
 document.getElementById('kbQ').setAttribute('aria-keyshortcuts','Meta+K Control+K');
 const log=document.getElementById('chatLog');const jump=document.createElement('button');jump.id='jumpLatest';jump.textContent='回到最新訊息 ↓';jump.hidden=true;jump.onclick=()=>{log.scrollTop=log.scrollHeight};log.after(jump);
 log.addEventListener('scroll',()=>jump.hidden=log.scrollHeight-log.scrollTop-log.clientHeight<120);
});
