/* 新版界面连接现有同源服务；密钥只保留在服务器。 */
const liveJobs=new Map(),liveQueue=[];
let liveQueueRunning=false,liveProgress='';
async function liveAPI(kind,body){
 const r=await fetch('/api/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(70000)}),d=await r.json();
 if(!r.ok)throw Error(d.error||'服务暂不可用，请重试。');return d.result;
}
const liveCategoryPath=id=>pathCats(id).map(c=>c.name).join(' / ');
function liveCategory(n){return WorkspaceRules.categoryId({categoryId:n.aiCategoryId,category:n.aiCategory},categories,liveCategoryPath);}
function liveSaveStatus(){
 let banner=$('#live-save-warning');
 if(storageOK&&!storageReadBlocked&&!storageRecovered){banner?.remove();return;}
 if(!banner){banner=document.createElement('div');banner.id='live-save-warning';banner.className='live-save-warning';banner.setAttribute('role','alert');document.body.append(banner);}
 banner.textContent=storageReadBlocked?'未能读取原有资料，已停止覆盖保存。请检查此浏览器的网站存储或导入完整备份。':!storageOK?'当前修改尚未保存到浏览器。请勿关闭页面，先导出完整备份。':'已从本机恢复副本找回资料，请核对最近修改并导出完整备份。';
 const button=document.createElement('button');button.textContent='导出完整备份';button.addEventListener('click',exportAssistantBackup);banner.append(button);
}
const liveRememberBefore=remember;
remember=function(){liveRememberBefore();liveSaveStatus();};
window.addEventListener('error',event=>{if(event.message?.includes('没有保存成功')){event.preventDefault();liveSaveStatus();toast('没有保存成功，请保留草稿并导出备份。');}});
window.addEventListener('unhandledrejection',event=>{if(event.reason?.message?.includes('没有保存成功')){event.preventDefault();liveSaveStatus();toast(event.reason.message);}});
async function liveParseAttachment(n){
 if(!/^(image|file)-pending$/.test(n.captureState))return;
 const record=await getAttachment(n.attachment?.id);if(!record)throw Error('找不到原始附件，请重新添加原件或补充正文。');
 const ext=record.name.split('.').pop().toLowerCase();
 if(!['pptx','pdf','docx','png','jpg','jpeg','webp','txt','md','csv'].includes(ext)||record.blob.size>3000000)throw Error('原件已保留。在线解析支持 3 MB 内 PPTX、PDF、DOCX、TXT、MD、CSV、PNG、JPG、WebP，请补充正文或拆分文件。');
 n.captureNote='正在重新解析原附件…';
 const parsed=await liveAPI('upload',{name:record.name,data:String(await blobDataURL(record.blob)).split(',')[1]});
 if(note(n.id)!==n)throw Error('资料已修改或移除，解析结果未覆盖新内容。');
 n.body=parsed.text;n.attachmentAnalysis={method:parsed.method,pages:parsed.pages,warnings:parsed.warnings||[]};n.captureState='text-ready';n.captureNote='正文已提取，原附件仍保留。';save();
}
async function liveAnalyze(n){
 if(liveJobs.has(n.id))return liveJobs.get(n.id);
 const job=(async()=>{
  try{
   await liveParseAttachment(n);
   const body=n.body;
   if(!body?.trim()||n.captureState==='link-only')throw Error('请先补充正文；链接不会自动抓取网页。');
   if(body.length>20000)throw Error('原文已保留，AI 单次最多整理 20000 字，请分段整理。');
   if(n.aiState==='done'||n.aiState==='stale'||n.points?.length)n.manualFields??={};
   n.aiState='processing';n.aiError='';n.captureNote='原文已保存，AI 整理中…';save();
   const r=await liveAPI('analyze',{text:body,source:n.source,categories:categories.map(c=>liveCategoryPath(c.id)),categoryOptions:categories.map(c=>({id:c.id,path:liveCategoryPath(c.id)}))});
   if(note(n.id)!==n||n.body!==body)throw Error('资料已修改，本次结果未覆盖新内容，请重试。');
   const previous=structuredClone(n);
   WorkspaceRules.applyAnalysis(n,r,WorkspaceRules.categoryId(r,categories,liveCategoryPath));
   const draft=IntakeUI.drafts.get(n.id);
   if(n.aiCategoryId&&!draft?.chosenByUser)IntakeUI.drafts.set(n.id,{category:n.aiCategoryId,tags:(draft?.tagsEdited?draft.tags:n.tags.join('，')),tagsEdited:!!draft?.tagsEdited,chosenByUser:false});
   n.captureNote=n.aiSuggestionPending?'新分析已生成；标题、摘要与标签保留，请在详情选择采用建议。':'原文已保留，AI 摘要与标签已生成，请核对。';
   try{save();}catch(error){Object.assign(n,previous);throw error;}return r;
  }catch(error){if(note(n.id)===n){n.aiState='error';n.aiError=error.message;n.captureNote=error.message;try{save();}catch{liveSaveStatus();}}throw error;}
 })();liveJobs.set(n.id,job);try{return await job;}finally{liveJobs.delete(n.id);}
}
function liveSchedule(notes){
 for(const n of notes)if(!liveQueue.includes(n.id)){n.aiState='queued';n.captureNote='原件已保存，正在等待后台整理。';liveQueue.push(n.id);}
 if(notes.length)save();setTimeout(liveRunQueue,0);
}
async function liveRunQueue(){
 if(liveQueueRunning)return;liveQueueRunning=true;let done=0,failed=0;
 try{while(liveQueue.length){const id=liveQueue.shift(),n=note(id);if(!n)continue;liveProgress='后台整理：剩余 '+(liveQueue.length+1)+' 条';render();try{await liveAnalyze(n);done++;}catch{failed++;}if(S.modal==='detail'&&S.detail===n.id)renderDetail();}}
 finally{liveQueueRunning=false;liveProgress='';render();toast('后台整理完成：'+done+' 条成功'+(failed?'，'+failed+' 条失败，可在详情重试':'')+'。');}
}
const liveTextBefore=ingestText;
ingestText=async function(text){const ids=new Set(data.notes.map(n=>n.id));await liveTextBefore(text);liveSchedule(data.notes.filter(n=>!ids.has(n.id)&&n.captureState!=='link-only'));};
const liveFilesBefore=ingestFiles;
ingestFiles=async function(files){const ids=new Set(data.notes.map(n=>n.id));await liveFilesBefore(files);liveSchedule(data.notes.filter(n=>!ids.has(n.id)&&n.attachment));};
const livePredictBefore=intakePredict;
intakePredict=function(n){return liveCategory(n)||livePredictBefore(n);};
intakeAutoOrganize=async function(){
 if(IntakeUI.busy)return;const pending=filtered().filter(n=>!n.category&&!n.demo);if(!pending.length){toast('当前范围没有待整理的真实资料。');return;}
 if(!confirm('将整理当前筛选中的 '+pending.length+' 条真实资料，隐藏项目和示例资料不会处理。完成后可整批撤销归档，是否继续？'))return;
 IntakeUI.busy=true;IntakeUI.openFor=null;render();let failed=0;const plan=[];
 try{
  for(const n of pending){try{
   if(note(n.id)!==n||n.category)continue;
   liveProgress='整理当前资料：'+(plan.length+failed+1)+' / '+pending.length;render();
   if(n.aiState!=='done'||n.aiBody&&n.aiBody!==n.body)await liveAnalyze(n);
   if(note(n.id)!==n||n.category)continue;
   const draft=IntakeUI.drafts.get(n.id),destination=draft?.chosenByUser&&cat(draft.category)?draft.category:liveCategory(n);
   if(!destination){failed++;continue;}plan.push({n,body:n.body,destination,draft});
  }catch{failed++;}}
  const valid=plan.filter(x=>note(x.n.id)===x.n&&!x.n.category&&x.n.body===x.body);
  if(valid.length){snapshot();const before=structuredClone(data);
   for(const {n,destination,draft}of valid){n.category=destination;orbitMarkAuto(n);if(draft?.tagsEdited){n.tags=parseTags(draft.tags);n.manualFields={...n.manualFields,tags:true};}IntakeUI.drafts.delete(n.id);}
   try{save();}catch(error){data=before;throw error;}
  }
  V.review=null;V.skipped.clear();toast('已归档 '+valid.length+' 条'+(failed?'，'+failed+' 条保留待处理，可在详情重试':'')+'。',valid.length>0);
 }catch(error){toast(error.message);}finally{IntakeUI.busy=false;liveProgress='';render();}
};
const liveDetailBefore=renderDetail;
renderDetail=function(){liveDetailBefore();const n=note(S.detail),article=$('#overlay .detailmain');if(!n||!article)return;
 const section=document.createElement('section');section.className='detailsection';
 section.innerHTML=`<button class="btn small" data-live-analyze="${esc(n.id)}" ${liveJobs.has(n.id)?'disabled':''}>${/^(image|file)-pending$/.test(n.captureState)?'重新解析附件并整理':liveJobs.has(n.id)?'AI 整理中…':'AI 重新整理'}</button><p class="helptext">${esc(n.aiError||n.captureNote||(n.aiState==='done'?'AI 已生成摘要与标签，请核对原文。':'原文已保存，可使用 AI 生成摘要与分类建议。'))}</p>${n.attachmentAnalysis?.method==='pptx'?`<p class="helptext">PPTX 已提取 ${Number(n.attachmentAnalysis.pages)||0} 页。${esc((n.attachmentAnalysis.warnings||[]).join(' '))}</p>`:''}${n.aiSuggestionPending&&n.aiSuggestion?`<form class="live-ai-suggestion" data-live-apply="${esc(n.id)}"><strong>新分析建议 · 采用前保留现有内容</strong>${['title','summary','tags'].map(key=>`<label class="formfield"><span><input type="checkbox" name="${key}">采用${{title:'标题',summary:'摘要',tags:'标签'}[key]}</span><span>${esc(key==='tags'?n.aiSuggestion.tags.join('，'):n.aiSuggestion[key])}</span></label>`).join('')}<button class="btn small" type="submit">采用所选建议</button></form>`:''}`;article.prepend(section);
};
// 问答会话只保存在本机；打开资料后可返回同一回答。
let LiveChat={messages:[],draft:'',scope:'current',includeDemo:false};
try{const saved=JSON.parse(localStorage.getItem(KEY+'.chat')||'null');if(saved&&Array.isArray(saved.messages))LiveChat={...LiveChat,...saved,busy:false};}catch{}
function liveSaveChat(){try{localStorage.setItem(KEY+'.chat',JSON.stringify({...LiveChat,messages:LiveChat.messages.slice(-20),busy:false}));}catch{toast('问答记录暂未保存，请复制需要保留的回答。');}}
function liveChatHTML(){return LiveChat.messages.map(m=>`<div class="live-chat-message"><strong>${m.role==='user'?'我':'拾页'}</strong><p>${esc(m.content)}</p>${(m.refs||[]).map(r=>`<button type="button" class="btn small" data-live-citation="${esc(r.id)}">${esc(r.title)}</button>`).join('')}</div>`).join('');}
function liveOpenChat(){
 S.modal='live-chat';const count=filtered().filter(n=>!n.demo).length;
 openModal('AI 找资料',`<form id="live-chat-form" class="modalbody"><div class="live-chat-scope"><label>问答范围 <select name="scope"><option value="current" ${LiveChat.scope==='current'?'selected':''}>当前筛选（${count} 条真实资料）</option><option value="selected" ${LiveChat.scope==='selected'?'selected':''}>已勾选（${S.selected.size} 条）</option><option value="all" ${LiveChat.scope==='all'?'selected':''}>全部真实资料</option></select></label><label><input type="checkbox" name="demo" ${LiveChat.includeDemo?'checked':''}>包含示例资料</label><button type="button" class="btn small" data-live-clear-chat>清空对话</button></div><div id="live-chat-messages">${liveChatHTML()}</div><label class="formfield"><span>向自己的资料提问</span><textarea name="message" ${LiveChat.busy?'disabled':''} required maxlength="4000" placeholder="例如：已有资料中有哪些值得写入报告的观点？">${esc(LiveChat.draft)}</textarea></label><p class="helptext">按问题关键词检索相关资料片段后发送至本站 AI；较长正文按片段读取，请核对引用。当前筛选随主页面变化。</p><button class="btn primary" type="submit" ${LiveChat.busy?'disabled':''}>${LiveChat.busy?'查阅中…':'发送'}</button><div id="live-chat-result" role="status">${esc(LiveChat.error||(LiveChat.busy?'正在查阅资料，可关闭窗口，结果会保留。':''))}</div></form>`);
}
demoAI=liveOpenChat;
const liveRenderBefore=render;
render=function(){if(TextInput.composing.size){TextInput.pendingRender=true;return;}liveRenderBefore();const actions=$('.ux-header-actions');if(actions&&!$('#live-ai-button')){const button=document.createElement('button');button.id='live-ai-button';button.className='btn small';button.textContent='AI';button.setAttribute('aria-label','AI 找资料');button.addEventListener('click',liveOpenChat);actions.prepend(button);}liveSaveStatus();const progress=$('#live-background-progress');progress?.remove();if(liveProgress){const p=document.createElement('div');p.id='live-background-progress';p.setAttribute('role','status');p.style.cssText='position:fixed;bottom:72px;right:20px;z-index:50;background:var(--panel);color:var(--ink);padding:10px;border:1px solid var(--hairline);border-radius:10px';p.textContent=liveProgress;document.body.append(p);}};
document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-live-analyze],[data-live-citation],[data-live-back-chat],[data-live-clear-chat]');if(!button)return;
 if(button.hasAttribute('data-live-clear-chat')){if(confirm('清空本机的问答记录？')){LiveChat.messages=[];LiveChat.draft='';liveSaveChat();liveOpenChat();}return;}
 if(button.dataset.liveCitation){const id=button.dataset.liveCitation;if(!note(id)){toast('这条资料已移除。');return;}openDetail(id);const article=$('#overlay .detailmain');if(article){const back=document.createElement('button');back.className='btn small';back.textContent='返回 AI 对话';back.dataset.liveBackChat='';article.prepend(back);}return;}
 if(button.hasAttribute('data-live-back-chat')){liveOpenChat();return;}
 button.disabled=true;button.textContent='AI 整理中…';const n=note(button.dataset.liveAnalyze);try{if(n)await liveAnalyze(n);}catch(error){toast(error.message);}finally{render();if(S.modal==='detail'&&S.detail===n?.id)renderDetail();}
});
document.addEventListener('submit',async e=>{
 if(e.target.hasAttribute('data-live-apply')){e.preventDefault();const n=note(e.target.dataset.liveApply);if(!n?.aiSuggestion)return;const fields=new FormData(e.target),keys=['title','summary','tags'].filter(k=>fields.has(k));if(!keys.length){toast('请先勾选要采用的建议。');return;}snapshot();const old=structuredClone(n);for(const k of keys){n[k]=structuredClone(n.aiSuggestion[k]);n.manualFields={...n.manualFields,[k]:false};}n.aiSuggestionPending=false;n.captureNote='已采用所选建议，其他手动内容已保留。';try{save();render();renderDetail();toast('已采用所选建议，可撤销。',true);}catch(error){Object.assign(n,old);toast(error.message);}return;}
 if(e.target.id!=='live-chat-form')return;e.preventDefault();if(LiveChat.busy)return;
 const form=e.target,fields=new FormData(form),message=String(fields.get('message')||'').trim(),result=form.querySelector('#live-chat-result');
 if(!message)return;LiveChat.scope=String(fields.get('scope'));LiveChat.includeDemo=fields.has('demo');LiveChat.draft=message;
 const notes=WorkspaceRules.chatScope(data.notes,S.selected,filtered().map(n=>n.id),LiveChat.scope,LiveChat.includeDemo),selection=WorkspaceRules.chatCards(notes,message);
 if(!selection.cards.length){result.textContent='所选范围没有可用资料。请选择全部资料、调整筛选或勾选资料。';return;}
 const history=LiveChat.messages.slice(-10).map(m=>({role:m.role,content:m.content.replace(/\[(\d+)\]/g,(match,id)=>m.refs?.find(r=>r.title.startsWith('['+id+'] '))?.title.replace(/^\[\d+\] /,'资料：')||match)}));
 LiveChat.error='';LiveChat.busy=true;liveSaveChat();form.querySelector('button[type=submit]').disabled=true;form.querySelector('[name=message]').disabled=true;result.textContent='正在查阅 '+selection.cards.length+' / '+selection.total+' 条资料'+(selection.partial?'的相关片段':'')+'…';
 try{
  const answer=await liveAPI('chat',{message,cards:selection.cards,history});
  const refs=answer.ids.map(id=>({id:selection.refs.get(id),title:'['+id+'] '+(note(selection.refs.get(id))?.title||'已移除资料')})).filter(r=>r.id);
  LiveChat.messages.push({role:'user',content:message},{role:'assistant',content:answer.reply+'\n\n本次范围：'+selection.total+' 条，读取 '+selection.cards.length+' 条'+(selection.partial?'相关片段（未读取全部正文）。':'。'),refs});LiveChat.draft='';
 }catch(error){LiveChat.error=error.message;if(result.isConnected)result.textContent=error.message;toast(error.message);}finally{LiveChat.busy=false;liveSaveChat();if(S.modal==='live-chat')liveOpenChat();}
});
// 自动保留收录草稿；附件在本次打开期间保留，刷新前明确提醒。
let liveCaptureDraft='';try{liveCaptureDraft=localStorage.getItem(KEY+'.capture-draft')||'';}catch{}
function liveRememberCapture(){const input=$('#ux-capture-text');if(!input)return;liveCaptureDraft=input.value;try{localStorage.setItem(KEY+'.capture-draft',liveCaptureDraft);}catch{toast('草稿暂未保存，请复制文字后再关闭。');}}
const liveCaptureBefore=uxOpenCapture;
let liveDraftFiles=[];
uxOpenCapture=function(){liveCaptureBefore();const input=$('#ux-capture-text');if(input){input.value=liveCaptureDraft;UX.files=liveDraftFiles.slice();uxRenderFiles();uxUpdateCapture();}};
function liveClearCaptureDraft(){liveCaptureDraft='';liveDraftFiles=[];UX.files=[];const input=$('#ux-capture-text');if(input)input.value='';try{localStorage.removeItem(KEY+'.capture-draft');}catch{}}
const liveCloseBefore=closeModal;
closeModal=function(){if(S.modal==='ux-capture'&&!UX.captureBusy){liveRememberCapture();liveDraftFiles=UX.files.slice();}liveCloseBefore();};
document.addEventListener('input',e=>{if(e.target.id==='ux-capture-text')liveRememberCapture();if(e.target.closest('#live-chat-form')){const f=new FormData(e.target.closest('form'));LiveChat.draft=String(f.get('message')||'');LiveChat.scope=String(f.get('scope'));LiveChat.includeDemo=f.has('demo');liveSaveChat();}});
window.addEventListener('beforeunload',e=>{if(!storageOK||liveQueueRunning||liveQueue.length||UX.captureBusy||UX.files?.length){e.preventDefault();e.returnValue='';}});
// 同域升级时复制旧版真实资料，保留旧存储以便回退。
function liveMigrate(){
 if(data.legacyAIImported)return;
 try{const raw=localStorage.getItem('shiye.workspace.v1');if(!raw)return;const old=JSON.parse(raw);
  if(!Array.isArray(old.items)||!Array.isArray(old.clusters))return;
  for(const item of old.items.filter(n=>!n.demo)){
   const id='legacy-ai-'+item.id;if(data.notes.some(n=>n.id===id))continue;
   const name=old.clusters.find(c=>c.id===item.cid)?.n;let destination=categories.find(c=>c.name===name);
   if(item.triaged&&name&&!destination){destination={id:'legacy-category-'+item.cid,name,parent:UX.space,color:'#819d91',keywords:[name]};categories.push(destination);}
   data.notes.push({id,title:item.t||'旧版资料',summary:item.one||'',body:item.rawContent||(item.body||[]).join('\n\n'),source:item.source||item.ref||'旧版导入',category:item.triaged?destination?.id||null:null,date:today(),tags:item.tags||[],points:item.pts||[],kind:item.attachment?'附件解析正文':'旧版资料',demo:false,core:item.core||'',quote:item.quote||'',aiState:item.aiGenerated?'done':undefined,captureState:'text-ready',captureNote:item.attachment?'从旧版迁移的解析正文；旧版未保留原始附件。':'已从旧版迁移，旧存储仍保留。'});
   if(old.collection?.includes(item.id)&&!data.collection.includes(id))data.collection.push(id);
  }data.legacyAIImported=true;save();
 }catch{toast('旧版资料仍保留在此浏览器，自动迁移未完成，请先备份。');}
}
for(const n of data.notes)if(['processing','queued'].includes(n.aiState)){n.aiState='error';n.aiError='上次整理被中断，原文已保留，可在详情重试。';}
for(const n of data.notes)if(n.aiState==='done'&&!n.aiBody){n.aiState='stale';n.aiError='旧版分析未记录正文版本，请重新分析后使用分类建议。';n.aiCategory='';n.aiCategoryId='';}
liveMigrate();render();
