/* 拾页真实功能层：原型保留视觉、图谱与路由，本文件接管数据和 AI 行为。 */
const STORE='shiye.workspace.v1';
const seedItems=JSON.parse(JSON.stringify(ITEMS));
const seedClusters=JSON.parse(JSON.stringify(CLUSTERS));
const seedCollection=[...S.collection];
let apiStatus={aiConfigured:false,accessCodeRequired:false}, proposals=null, proposalToken=0;
let assistantBusy=false, searchResults=null, searchVersion=0, composeResult=null, liveError='';
let workspaceRevision=0;
const analyzing=new Set();
const pendingMessages=new Map();

function persist(){
 try{localStorage.setItem(STORE,JSON.stringify({items:ITEMS,clusters:CLUSTERS,collection:S.collection,chat:S.chat,composeResult}));liveError='';return true;}
 catch{liveError='浏览器未能保存数据，请先导出备份，避免关闭后丢失。';toast(liveError);return false;}
}
function loadWorkspace(){
 try{
  const raw=localStorage.getItem(STORE);if(!raw)return;
  const d=JSON.parse(raw);
  if(!Array.isArray(d.items)||!Array.isArray(d.clusters)||!d.items.every(x=>Number.isSafeInteger(x.id)&&typeof x.t==='string'&&Array.isArray(x.body)&&Array.isArray(x.pts)))throw Error();
  ITEMS.splice(0,ITEMS.length,...d.items);CLUSTERS.splice(0,CLUSTERS.length,...d.clusters);
  S.collection=(d.collection||[]).filter(id=>byId(id));S.chat=Array.isArray(d.chat)?d.chat:[];
  composeResult=d.composeResult||null;
  for(const it of ITEMS)if(it.parsing){it.parsing=false;it.aiError='上次整理中断，可点击重新整理。';}
 }catch{liveError='本地资料未能读取；原始存储未覆盖，可在设置中导出原始备份。';}
}
async function api(kind,body){
 let code=sessionStorage.getItem('shiye.access')||'';
 if(apiStatus.accessCodeRequired&&!code){code=prompt('请输入网站管理员提供的体验码')||'';if(!code)throw Error('尚未输入体验码。');sessionStorage.setItem('shiye.access',code);}
 let res;
 try{res=await fetch('/api/'+kind,{method:'POST',headers:{'Content-Type':'application/json','X-Access-Code':code},body:JSON.stringify(body),signal:AbortSignal.timeout(70000)});}catch{throw Error('网络连接失败或请求超时，资料仍保留，可稍后重试。');}
 let data;try{data=await res.json();}catch{throw Error('服务器返回异常，请稍后重试。');}
 if(res.status===401)sessionStorage.removeItem('shiye.access');
 if(!res.ok)throw Error(data.error||'AI 请求失败。');
 return data.result;
}
function category(name){
 let c=CLUSTERS.find(x=>x.n===name);if(c)return c;
 c={id:'custom-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),n:name||'待归类',x:Math.random()*500-250,y:Math.random()*250-125};CLUSTERS.push(c);return c;
}
function sourceText(it){return it.rawContent||it.body.join('\n\n');}
async function analyzeItem(it){
 if(analyzing.has(it.id))return;
 if(/^https?:\/\/\S+$/i.test(sourceText(it).trim())){it.aiError='链接已保存，请编辑资料并补充网页正文后再整理。';persist();render();return;}
 const revision=workspaceRevision,content=sourceText(it);analyzing.add(it.id);it.parsing=true;it.aiError='';persist();render();
 try{
  const r=await api('analyze',{text:content,source:it.attachment?'附件：'+it.attachment.name:(it.source||''),categories:CLUSTERS.map(c=>c.n)});
  if(revision!==workspaceRevision||!ITEMS.includes(it)||sourceText(it)!==content)return;
  Object.assign(it,{t:r.title,one:r.summary,pts:r.points,core:r.core,data:r.data,quote:r.quote,ref:r.ref,type:r.type,tags:r.tags,suggestedCategory:r.category,aiGenerated:true});
  toast('AI 已完成整理；原始内容已保留，请核对后确认归属。');
 }catch(e){if(revision===workspaceRevision&&ITEMS.includes(it))it.aiError=e.message;}
 finally{analyzing.delete(it.id);if(revision===workspaceRevision&&ITEMS.includes(it)){it.parsing=false;persist();render();}}
}
function addNote(text){
 const date=new Date().toLocaleDateString('zh-CN');
 const url=text.match(/https?:\/\/[^\s]+/)?.[0]||'';
 const it={id:Math.max(0,...ITEMS.map(x=>x.id))+1,cid:'inb',t:text.slice(0,40),type:'idea',src:'note',srcName:'随手记',date,triaged:false,one:'已保存原始内容，等待 AI 整理。',pts:[],core:'尚未整理',data:'—',quote:'—',ref:'来源待核实',body:text.split(/\n\s*\n/),rawContent:text,source:url,tags:[]};
 ITEMS.push(it);composeResult=null;
 if(!persist()){toast('内容暂留在当前页面；请立即导出备份。');}
 return it;
}
let attachmentDraft=null,attachmentBusy=false,composerGeneration=0;
const originalComposer=openComposer;
openComposer=function(){
 composerGeneration++;attachmentDraft=null;attachmentBusy=false;originalComposer();
 const button=$('#composer [data-toast]');if(button){button.removeAttribute('data-toast');button.dataset.live='attach';}
 $('#ct').insertAdjacentHTML('afterend','<p id="attachment-status" role="status" style="font-size:12px;line-height:1.7;color:var(--ink-2)">可附 PDF、DOCX、TXT、MD、CSV 或图片，单个不超过 3 MB。解析后请核对正文再保存。图片会发送至 AI 服务识别；原文件不长期保存。</p><input id="attachment-input" type="file" accept=".pdf,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp" hidden>');
};
async function importAttachment(file){
 if(attachmentBusy)return;
 const generation=composerGeneration,field=$('#ct'),before=field.value,status=$('#attachment-status');
 if(!file.size||file.size>3000000){status.textContent='请选择不超过 3 MB 的非空文件。';return;}
 if(before.trim()&&!confirm('解析成功后会替换当前输入框内容，是否继续？'))return;
 attachmentBusy=true;status.textContent='正在解析 '+file.name+'，请稍候…';
 const saveButton=$('#composer [data-comp="save"]'),attachButton=$('#composer [data-live="attach"]');
 if(saveButton)saveButton.disabled=true;if(attachButton)attachButton.disabled=true;
 try{
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('无法读取文件，请重新选择。'));reader.readAsDataURL(file);});
  const result=await api('upload',{name:file.name,data});
  if(generation!==composerGeneration||!$('#composer').classList.contains('on'))return;
  if(field.value!==before){status.textContent='解析已完成，但你已修改正文；为保留修改，请重新选择附件。';return;}
  field.value=result.text;attachmentDraft={name:result.name,bytes:result.bytes,pages:result.pages,method:result.method};
  status.textContent='已解析：'+result.name+(result.pages?' · '+result.pages+' 页':'')+' · '+result.text.length+' 字。'+(result.method==='ocr'?'图片识别可能有误，请逐字核对。':'请核对正文、段落和表格顺序。')+' 点击“存”后保存正文并生成 AI 摘要。';
 }catch(error){if(generation===composerGeneration)status.textContent=error.message+' 当前正文未被替换。';}
 finally{if(generation===composerGeneration){attachmentBusy=false;if(saveButton)saveButton.disabled=false;if(attachButton)attachButton.disabled=false;}}
}
saveNote=function(){
 if(attachmentBusy)return toast('附件正在解析，请稍候。');
 const text=$('#ct')?.value.trim();if(!text)return toast('请先输入内容或选择附件。');if(text.length>20000)return toast('正文最多 20000 字，请分段保存。');
 const it=addNote(text);if(attachmentDraft){it.attachment={...attachmentDraft};it.srcName='附件 · '+attachmentDraft.name;it.ref='附件：'+attachmentDraft.name;it.source='';persist();}
 $('#composer').classList.remove('on');go('#/inbox');analyzeItem(it);
};
document.addEventListener('change',e=>{if(e.target.id==='attachment-input'){const file=e.target.files?.[0];e.target.value='';if(file)importAttachment(file);}});

const originalRender=render;
render=function(){
 originalRender();
 $('#pet').style.display=S.route==='chat'?'none':'';
 if(S.route==='chat'){$('#petdock')?.classList.remove('on');$('#petbub')?.classList.remove('on');document.body.classList.remove('dockopen');PetUI.dockOpen=false;}
 const view=$('#view');
 if(view&&!$('#live-status'))view.insertAdjacentHTML('afterbegin',`<div id="live-status" style="font-size:12px;color:var(--ink-2);margin-bottom:14px;line-height:1.7">${apiStatus.aiConfigured?'AI 已配置':'AI 尚未配置 · 可先保存和搜索资料'} · 数据保存在当前浏览器 · <a href="#/settings">设置与备份</a> · <a href="#/welcome">使用说明</a> <span style="color:var(--danger)">${esc(liveError)}</span></div>`);
 if(S.route==='chat'){$('#send').disabled=assistantBusy;$('#send').textContent=assistantBusy?'思考中…':'发送';}
 if(S.route==='search'){
  const input=$('#q');
  if(input&&!$('#ai-search'))input.parentElement.insertAdjacentHTML('beforeend','<button id="ai-search" class="btn sm" data-live="ai-search">AI 找资料</button>');
  if(searchResults?.query===S.q){view.insertAdjacentHTML('beforeend',`<section class="orig"><h2 class="sec">AI 检索</h2><p style="white-space:pre-wrap">${esc(searchResults.reply)}</p>${searchResults.ids.map(id=>{const it=byId(id);return it?`<button class="btn sm" data-open="${id}">${esc(it.t)}</button>`:'';}).join('')}</section>`);}
 }
 if(S.route==='detail'){
  const it=byId(S.id);if(!it)return;
  if(it.attachment)view.insertAdjacentHTML('afterbegin',`<p style="font-size:12px">附件：${esc(it.attachment.name)} · 已保留解析正文；原文件未存储。${it.attachment.method==='ocr'?'图片识别结果请核对原图。':''}</p>`);
  view.insertAdjacentHTML('afterbegin',`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><button class="btn sm" data-live="edit">编辑资料</button><button class="btn sm" data-live="analyze" ${analyzing.has(it.id)?'disabled':''}>${it.parsing?'AI 整理中…':'AI 重新整理'}</button><button class="btn sm" data-live="proposals">AI 提案</button><button class="btn sm" data-live="related">AI 查找关联</button>${it.source?`<a class="btn sm" target="_blank" rel="noopener noreferrer" href="${esc(safeURL(it.source))}">打开来源链接</a>`:''}</div><p style="font-size:12px;color:var(--ink-2)">${it.demo?'示例资料，未经外部核验。 ':''}${it.aiGenerated?'摘要与核心结论包含 AI 改写；原句须核对原文。 ':''}${esc((it.tags||[]).join(' · '))}</p>${it.aiError?`<p role="alert" style="color:var(--danger)">${esc(it.aiError)}</p>`:''}`);
 }
};
function safeURL(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'#';}catch{return '#';}}
const oldDetail=viewDetail;
viewDetail=function(){
 let html=oldDetail(),it=byId(S.id);if(!it)return html;
 if(it.liveRelated&&!S.reading){const start=html.indexOf('<div class="rel">'),end=html.indexOf('</div>\n    </div>',start);if(start>=0&&end>=0)html=html.slice(0,start)+`<div class="rel"><div class="rh">关联 · AI 推荐</div>${it.liveRelated.map(r=>{const t=byId(r.id);return t?`<button class="rc" data-open="${t.id}"><div class="t">${esc(t.t)}</div><div class="r">${esc(r.reason)}</div></button>`:'';}).join('')||'<p>没有找到合适的关联资料。</p>'}<button class="btn sm" data-live="related">换一批</button>`+html.slice(end);}
 return html;
};

search=function(q){
 const words=q.trim().toLowerCase().split(/\s+/).filter(Boolean);if(!words.length)return [];
 return ITEMS.map(it=>{
  const fields=[['标题',it.t,6],['摘要',it.one,4],['要点',it.pts.join(' '),3],['原文',sourceText(it),2],['结论',it.core,2],['出处',it.ref,2],['原句',it.quote,2],['数据',it.data,2],['标签',(it.tags||[]).join(' '),2]];
  let score=0,fieldName='',snip='';
  if(!words.every(w=>fields.some(([,v])=>String(v||'').toLowerCase().includes(w))))return null;
  for(const [name,text,n]of fields)if(words.some(w=>String(text||'').toLowerCase().includes(w))){score+=n;if(!fieldName){fieldName='命中'+name;snip=String(text||'').slice(0,220);}}
  return {it,score,fieldName,snip};
 }).filter(Boolean).sort((a,b)=>b.score-a.score);
};
suggest=function(q){return (SYN[q]||[]).filter(text=>search(text).length).slice(0,3).map(text=>({text,lab:'相关词'}));};
// 替换搜索输入处理，保留 DOM 和中文组合输入状态。
document.addEventListener('input',e=>{
 if(e.target.id!=='q')return;e.stopImmediatePropagation();S.q=e.target.value;searchVersion++;
 if(e.isComposing)return;updateLocalSearch();
},true);
document.addEventListener('compositionend',e=>{if(e.target.id==='q'){S.q=e.target.value;updateLocalSearch();}});
function updateLocalSearch(){
 let wrap=$('#reswrap');if(!wrap){const p=$('#q')?.parentElement;if(!p)return;const temp=document.createElement('div');temp.id='reswrap';p.insertAdjacentElement('afterend',temp);wrap=temp;}
 // viewSearch 的结果区由 build 脚本包裹到 #reswrap，避免重建输入框。
 wrap.innerHTML=searchBody();
}
async function aiSearch(){
 const q=S.q.trim();if(!q)return toast('请输入你想找的资料。');const token=++searchVersion;
 const button=$('#ai-search');if(button){button.disabled=true;button.textContent='查找中…';}
 try{const r=await api('chat',{message:q,cards:ITEMS});if(token!==searchVersion||S.q.trim()!==q)return;searchResults={query:S.q,...r};if(S.route==='search')render();}
 catch(e){toast(e.message);}finally{if(button?.isConnected){button.disabled=false;button.textContent='AI 找资料';}}
}

openTriage=function(){S.queue=ITEMS.filter(x=>!x.triaged).map(x=>x.id);S.total=S.queue.length;S.done=0;if(!S.total)return toast('没有待整理资料。');$('#triage').classList.add('on');renderTriage();};
renderTriage=function(){
 const it=byId(S.queue[0]);if(!it){closeTriage();render();return;}
 const suggested=it.suggestedCategory||clusterOf(it.id).n;
 $('#triage').innerHTML=`<div class="sheet"><div class="sh"><b>整理 ${S.done}/${S.total}</b><div style="flex:1"></div><button class="btn sm" data-tri="close">退出</button></div><div class="tbody"><div class="tleft"><h2>${esc(it.t)}</h2><p style="white-space:pre-wrap;max-height:45vh;overflow:auto">${esc(sourceText(it))}</p></div><div class="tright"><h3>建议归属</h3><p>${esc(suggested)}${it.suggestedCategory?' · AI 建议':' · 当前分组'}</p><p>${esc(it.one)}</p><label>选择归属<select id="tri-category" class="btn">${[...new Set([suggested,...CLUSTERS.map(c=>c.n)])].map(n=>`<option>${esc(n)}</option>`).join('')}</select></label><label>或新建主题<input id="tri-new" class="btn" placeholder="输入新主题名称"></label><p style="font-size:12px">确认后保存归属；跳过的资料留到下次处理。</p></div></div><div class="tfoot"><button class="btn" data-tri="reject">都不对，稍后处理</button><button class="btn" data-tri="skip">跳过</button><div style="flex:1"></div><button class="btn acc" data-tri="accept">确认归属</button></div></div>`;
};
triageAct=function(kind){
 if(kind==='close')return closeTriage();const it=byId(S.queue[0]);if(!it)return;
 if(kind==='accept'){const n=$('#tri-new')?.value.trim()||$('#tri-category')?.value;it.cid=category(n).id;it.triaged=true;}
 if(kind==='reject'||kind==='skip')it.triaged=false;
 S.queue.shift();S.done++;persist();
 if(S.queue.length)renderTriage();else{closeTriage();render();toast('本次处理结束；跳过的资料仍在待整理中。');}
};

async function assistant(text){
 if(/^(存一条|保存|记下|收下|存)\s*[:：]/.test(text)||/^https?:\/\/\S+$/.test(text)){
  const content=text.replace(/^(存一条|保存|记下|收下|存)\s*[:：]\s*/,'');if(!content)throw Error('请在冒号后填写要保存的内容。');
  if(content.length>20000)throw Error('内容最多 20000 字。');
  const it=addNote(content);analyzeItem(it);return {reply:'原始内容已保存。可以打开资料查看整理状态。',ids:[it.id]};
 }
 return api('chat',{message:text,cards:ITEMS,history:S.chat.filter(x=>!x.pending).slice(-10).map(x=>({role:x.who==='me'?'user':'assistant',content:x.tx}))});
}
async function sendAssistant(text){
 if(assistantBusy)return;if(text.length>4000)return toast('问题最多 4000 字；长资料请使用随手记保存。');assistantBusy=true;
 const revision=workspaceRevision;
 S.chat.push({who:'me',tx:text});const pending={who:'pet',tx:'正在处理…',pending:true};S.chat.push(pending);render();
 try{const r=await assistant(text);if(revision!==workspaceRevision)return;Object.assign(pending,{tx:r.reply,pending:false,res:r.ids.map(id=>byId(id)).filter(Boolean).map(it=>({id:it.id,t:it.t,why:'相关资料',ref:it.ref}))});}
 catch(e){pending.tx=e.message;pending.pending=false;}
 finally{assistantBusy=false;if(revision===workspaceRevision){persist();render();$('#ci')?.focus();}}
}
chatSend=function(){const el=$('#ci'),v=el?.value.trim();if(!v)return;if(assistantBusy)return;el.value='';sendAssistant(v);};
pdSend=function(){const el=$('#pdInput'),v=el?.value.trim();if(!v||assistantBusy)return;el.value='';go('#/chat');sendAssistant(v);};

renderAI=async function(){
 const it=byId(S.id);if(!it)return;const token=++proposalToken,tab=S.tab;
 const box=$('#ai');box.innerHTML='<div class="aih"><h3>正在生成 AI 提案…</h3><button class="btn sm" data-ai="close">收起</button></div>';
 try{
  if(!proposals||proposals.id!==it.id||proposals.variant!==S.redo){const r=await api('proposals',{item:it,cards:[],categories:CLUSTERS.map(c=>c.n),variant:S.redo});if(token!==proposalToken)return;proposals={id:it.id,variant:S.redo,result:r};}
  const r=proposals.result,choices=r[tab]||[];
  box.innerHTML=`<div class="aih"><h3>AI 提案 · ${esc(it.t)}</h3><p>改写仅作摘要；请核对原文。</p></div><div class="tabs">${[['place','放哪'],['write','怎么写'],['tag','贴标签']].map(([k,n])=>`<button data-tab="${k}" aria-selected="${tab===k}">${n}</button>`).join('')}</div><div class="cands">${choices.map((c,i)=>`<button class="cand" data-live="apply-proposal" data-index="${i}"><div class="cn">${esc(c.category||c.title)}</div><p>${esc(c.reason||c.summary||(c.tags||[]).join(' · '))}</p><small>采用此方案</small></button>`).join('')||'<p>没有合适的方案，请编辑资料或重试。</p>'}</div><div class="aif"><button class="btn sm" data-ai="redo">重新生成</button><button class="btn sm" data-ai="close">收起</button></div>`;
 }catch(e){if(token===proposalToken)box.innerHTML=`<div class="aih"><p>${esc(e.message)}</p><button class="btn sm" data-ai="redo">重试</button><button class="btn sm" data-ai="close">收起</button></div>`;}
};
const oldCloseAI=closeAI;closeAI=function(){proposalToken++;oldCloseAI();};
function applyProposal(index){
 const it=byId(S.id),c=proposals?.result[S.tab]?.[index];if(!it||!c||proposals.id!==it.id)return;
 if(S.tab==='place'){it.cid=category(c.category).id;it.triaged=true;}
 if(S.tab==='write'){it.one=c.summary;it.aiGenerated=true;}
 if(S.tab==='tag')it.tags=c.tags;
 persist();closeAI();render();toast('已保存所选方案。');
}
async function related(){
 const it=byId(S.id);if(!it||pendingMessages.has('related-'+it.id))return;
 const key='related-'+it.id,rev=workspaceRevision;pendingMessages.set(key,true);toast('正在查找相关资料…');
 try{const r=await api('related',{item:it,cards:ITEMS,exclude:(it.liveRelated||[]).map(x=>x.id)});if(rev!==workspaceRevision)return;it.liveRelated=r.items;S.reading=false;persist();if(S.id===it.id)render();}
 catch(e){toast(e.message);}finally{pendingMessages.delete(key);}
}
collText=function(){return S.collection.map(byId).filter(Boolean).map((it,i)=>`${i+1}. ${it.t}\n\n核心结论（摘要）：${it.core}\n\n${it.quote&&it.quote!=='—'?'原文摘录：'+it.quote+'\n\n':''}出处：${it.ref}${it.demo?'（示例资料，未经外部核验）':''}`).join('\n\n---\n\n');};
const oldCollection=viewCollection;
viewCollection=function(){return oldCollection()+`${S.collection.length?'<button class="btn acc" data-live="compose">AI 生成写作提纲</button>':''}${composeResult?`<h2 class="sec">${esc(composeResult.title)} · AI 草稿</h2><p>请核对引用和待核实信息后使用。</p><div class="qb" style="white-space:pre-wrap">${esc(composeResult.content)}</div><button class="btn sm" data-live="copy-compose">复制提纲</button><button class="btn sm" data-live="export-compose">下载提纲</button>`:''}`;};
async function compose(){
 if(pendingMessages.has('compose'))return;pendingMessages.set('compose',true);const rev=workspaceRevision,signature=collText();toast('正在生成提纲…');
 try{const r=await api('compose',{cards:S.collection.map(byId).filter(Boolean)});if(rev!==workspaceRevision||signature!==collText())return toast('资料已变化，请重新生成提纲。');composeResult=r;persist();if(S.route==='collection')render();}
 catch(e){toast(e.message);}finally{pendingMessages.delete('compose');}
}
function download(name,text,type='text/markdown;charset=utf-8'){
 const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function copyText(text){try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(text);toast('已复制到剪贴板。');}catch{showDialog('请手动复制',`<textarea style="width:100%;height:40vh" readonly>${esc(text)}</textarea>`);}}

function showDialog(title,body){
 $('#live-dialog')?.remove();const dialog=document.createElement('dialog');dialog.id='live-dialog';dialog.style='width:min(680px,92vw);max-height:85vh;padding:24px;border:1px solid #ddd;border-radius:18px;color:var(--ink);background:var(--paper,#fff);overflow:auto';
 dialog.innerHTML=`<form method="dialog"><button class="btn sm" style="float:right">关闭</button></form><h2>${esc(title)}</h2>${body}`;document.body.appendChild(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove());return dialog;
}
function editItem(){
 const it=byId(S.id);if(!it)return;
 showDialog('编辑资料',`<div style="display:grid;gap:12px;margin-top:18px">${[['title','标题',it.t],['summary','摘要（修改后需自行核对）',it.one],['core','核心结论',it.core],['quote','原文摘录',it.quote],['source','来源网址（可选）',it.source||''],['ref','出处',it.ref],['category','主题',clusterOf(it.id).n],['tags','标签（逗号分隔）',(it.tags||[]).join('，')]].map(([id,label,value])=>`<label>${label}<input id="edit-${id}" style="display:block;width:100%;padding:8px" value="${esc(value)}"></label>`).join('')}<label>原始正文<textarea id="edit-body" style="width:100%;height:180px">${esc(sourceText(it))}</textarea></label><p>仅有网址时，请补充正文再运行 AI 整理。</p><button class="btn acc" data-live="save-edit" data-item="${it.id}">保存修改</button></div>`);
}
function saveEdit(id){
 const it=byId(id);if(!it)return;const v=k=>$('#edit-'+k)?.value.trim()||'';const body=v('body');if(!body||body.length>20000)return toast('正文需为 1–20000 字。');
 const quote=v('quote');if(quote&&quote!=='—'&&!body.includes(quote))return toast('原文摘录必须能在正文中找到；改写请放入摘要。');
 Object.assign(it,{t:v('title')||it.t,one:v('summary'),core:v('core'),quote:quote||'—',source:v('source'),ref:v('ref')||'来源待核实',cid:category(v('category')).id,tags:v('tags').split(/[,，]/).filter(Boolean),rawContent:body,body:body.split(/\n\s*\n/),triaged:true});
 proposals=null;composeResult=null;persist();$('#live-dialog').close();render();toast('资料已保存。');
}
viewSettings=function(){return `<h2>设置与数据</h2><div class="setlist"><div class="setrow"><div class="g"><div class="t">AI 服务</div><div class="d">${apiStatus.aiConfigured?'已配置':'待管理员配置接口、密钥和模型'} · 密钥保留在服务器</div></div><button class="btn sm" data-live="access">设置体验码</button></div><div class="setrow"><div class="g"><div class="t">当前浏览器资料</div><div class="d">${ITEMS.length} 条；无账号、无云端同步。清理浏览器数据会移除资料，请定期备份。</div></div><button class="btn sm" data-live="backup">导出备份</button></div><div class="setrow"><div class="g"><div class="t">恢复备份</div><div class="d">导入后替换当前资料；请先导出当前备份。</div></div><input type="file" id="import-backup" accept="application/json,.json"></div></div><h2 class="sec">示例与测试</h2><p>初始资料用于交互演示，未经外部核验，不能当作真实研究证据。</p><button class="btn sm" data-live="reset">重置为示例资料</button>`;};
viewWelcome=function(){return `<h2>你好，我是小拾</h2><p>保存原文、确认 AI 整理结果、找回证据，再组合成写作材料。</p><p>资料保存在当前浏览器。使用 AI 时，本次问题和相关资料会发送到网站配置的 AI 服务处理。</p><button class="btn acc" onclick="location.hash='#/inbox'">开始使用</button>`;};

document.addEventListener('click',async e=>{
 const live=e.target.closest('[data-live]'),act=e.target.closest('[data-act]'),copy=e.target.closest('[data-copy]'),hint=e.target.closest('[data-hint]');
 if(e.target.closest('#send')){e.stopImmediatePropagation();chatSend();return;}
 if(copy){e.stopImmediatePropagation();copyText(copy.dataset.copy);return;}
 if(hint){e.stopImmediatePropagation();if(hint.dataset.hint==='存一条')return openComposer();if(hint.dataset.hint==='整理一下')return openTriage();$('#ci').value='请帮我找关于';$('#ci').focus();return;}
 if(act&&['export','copy-coll','shuffle','dismiss','reset'].includes(act.dataset.act)){
  e.stopImmediatePropagation();switch(act.dataset.act){case 'export':download('拾页资料合辑.md',collText());break;case 'copy-coll':copyText(collText());break;case 'shuffle':related();break;case 'dismiss':{const it=byId(S.id);if(it){it.liveRelated=[];persist();render();}}break;case 'reset':resetWorkspace();break;}return;
 }
 // 资料的合辑操作失效旧提纲；事件冒泡完成后持久化实际状态。
 if(e.target.closest('[data-coll],[data-rm],[data-kind],[data-act="to-coll"]')){composeResult=null;setTimeout(persist,0);}
 if(!live)return;e.stopImmediatePropagation();
 switch(live.dataset.live){
  case 'attach':$('#attachment-input')?.click();break;
  case 'edit':editItem();break;
  case 'save-edit':saveEdit(+live.dataset.item);break;
  case 'analyze':analyzeItem(byId(S.id));break;
  case 'proposals':S.tab='place';S.redo=0;$('#ai').classList.add('on');renderAI();break;
  case 'related':related();break;
  case 'apply-proposal':applyProposal(+live.dataset.index);break;
  case 'ai-search':aiSearch();break;
  case 'compose':compose();break;
  case 'copy-compose':if(composeResult)copyText(composeResult.content);break;
  case 'export-compose':if(composeResult)download('拾页写作提纲.md',composeResult.content);break;
  case 'access':{const value=prompt('输入体验码（不是 AI API 密钥）',sessionStorage.getItem('shiye.access')||'');if(value!==null)sessionStorage.setItem('shiye.access',value);break;}
  case 'backup':download('拾页备份.json',localStorage.getItem(STORE)||JSON.stringify({items:ITEMS,clusters:CLUSTERS,collection:S.collection,chat:S.chat}),'application/json');break;
  case 'reset':resetWorkspace();break;
 }
},true);
function resetWorkspace(){
 if(!confirm('重置将替换当前浏览器中的资料和合辑。是否已备份并继续？'))return;
 workspaceRevision++;ITEMS.splice(0,ITEMS.length,...JSON.parse(JSON.stringify(seedItems)));CLUSTERS.splice(0,CLUSTERS.length,...JSON.parse(JSON.stringify(seedClusters)));S.collection=[...seedCollection];S.chat=[];S.queue=[];composeResult=null;proposals=null;searchResults=null;closeAI();closeTriage();persist();go('#/inbox');render();
}
document.addEventListener('change',async e=>{
 if(e.target.id!=='import-backup')return;const file=e.target.files?.[0];if(!file)return;
 try{
  if(file.size>4000000)throw Error('备份过大，请选择小于 4 MB 的文件。');
  const d=JSON.parse(await file.text());
  if(!Array.isArray(d.items)||d.items.length>1000||!d.items.every(x=>Number.isSafeInteger(x.id)&&typeof x.t==='string'&&Array.isArray(x.body)&&x.body.every(v=>typeof v==='string')&&Array.isArray(x.pts)&&x.pts.every(v=>typeof v==='string')&&typeof x.ref==='string')||!Array.isArray(d.clusters)||!d.clusters.every(x=>typeof x.id==='string'&&typeof x.n==='string')||!Array.isArray(d.collection))throw Error('备份格式不正确。');
  if(!confirm('用备份替换当前资料？请先备份当前内容。'))return;
  workspaceRevision++;ITEMS.splice(0,ITEMS.length,...d.items);CLUSTERS.splice(0,CLUSTERS.length,...d.clusters);S.collection=d.collection.filter(id=>byId(id));S.chat=[];composeResult=null;proposals=null;persist();go('#/inbox');render();
 }catch(err){toast(err.message);}
});
document.addEventListener('keydown',e=>{if(e.isComposing&&(e.key==='Enter'||e.keyCode===229))e.stopImmediatePropagation();},true);

// 标识内置示例，首次访问不冒充用户真实档案。
seedItems.forEach(x=>x.demo=true);ITEMS.forEach(x=>x.demo=true);
loadWorkspace();
try{const sp=localStorage.getItem('shiye_pet');if(sp)PetUI.pos=JSON.parse(sp);}catch{}
parse();render();palBind();petIdleLoop();
fetch('/api/health').then(r=>r.json()).then(status=>{apiStatus=status;render();}).catch(()=>{liveError='服务器无法连接，请通过启动服务后的网址访问。';render();});
