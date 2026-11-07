/* 新版界面连接现有同源服务；密钥只保留在服务器。 */
const liveJobs=new Map();
async function liveAPI(kind,body){
 const r=await fetch('/api/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(70000)}),d=await r.json();
 if(!r.ok)throw Error(d.error||'服务暂不可用，请重试。');return d.result;
}
async function liveAnalyze(n){
 if(liveJobs.has(n.id))return liveJobs.get(n.id);
 const job=(async()=>{
  const body=n.body;
  if(!body?.trim()||n.captureState==='link-only'||/^(image|file)-pending$/.test(n.captureState))throw Error('请先补充正文；链接不会自动抓取网页。');
  if(body.length>20000)throw Error('原文已保留，AI 单次最多整理 20000 字，请分段整理。');
  n.aiState='processing';n.aiError='';save();
  try{const r=await liveAPI('analyze',{text:body,source:n.source,categories:categories.map(c=>c.name)});
   if(note(n.id)!==n||n.body!==body)throw Error('资料已修改，本次结果未覆盖新内容，请重试。');
   Object.assign(n,{title:r.title,summary:r.summary,points:r.points,tags:r.tags,core:r.core,quote:r.quote,aiCategory:r.category,aiState:'done',aiError:''});
   const c=categories.find(c=>c.name===r.category),draft=IntakeUI.drafts.get(n.id);
   if(c&&!draft?.chosenByUser)IntakeUI.drafts.set(n.id,{category:c.id,tags:r.tags.join('，'),tagsEdited:false,chosenByUser:false});
   n.captureNote='原文已保留，AI 摘要与标签已生成，请核对。';save();return r;
  }catch(error){n.aiState='error';n.aiError=error.message;save();throw error;}
 })();liveJobs.set(n.id,job);try{return await job;}finally{liveJobs.delete(n.id);}
}
const liveTextBefore=ingestText;
ingestText=async function(text){
 const ids=new Set(data.notes.map(n=>n.id));await liveTextBefore(text);
 for(const n of data.notes.filter(n=>!ids.has(n.id)&&n.captureState!=='link-only')){
  const status=$('#ux-capture-state');if(status)status.textContent='原文已保存，正在生成 AI 摘要…';
  try{await liveAnalyze(n);}catch(error){toast('原文已保存：'+error.message);}
 }
};
const liveFilesBefore=ingestFiles;
ingestFiles=async function(files){
 const ids=new Set(data.notes.map(n=>n.id));await liveFilesBefore(files);
 for(const n of data.notes.filter(n=>!ids.has(n.id)&&n.attachment)){
  try{const record=await getAttachment(n.attachment.id);if(!record)throw Error('找不到原始附件。');
   const ext=record.name.split('.').pop().toLowerCase();
   if(['pdf','docx','png','jpg','jpeg','webp','txt','md','csv'].includes(ext)&&record.blob.size<=3000000){
    const status=$('#ux-capture-state');if(status)status.textContent='正在解析 '+record.name+'…';
    const parsed=await liveAPI('upload',{name:record.name,data:String(await blobDataURL(record.blob)).split(',')[1]});
    n.body=parsed.text;n.captureState='text-ready';n.captureNote='已提取正文并保留原始附件，请核对。';save();
   }else if(/^(image|file)-pending$/.test(n.captureState))throw Error('原件已保留。在线解析支持 3 MB 内 PDF、DOCX、TXT、MD、CSV、PNG、JPG、WebP，其他文件请补充正文。');
   await liveAnalyze(n);
  }catch(error){n.aiState='error';n.aiError=error.message;n.captureNote=error.message;save();}
 }
};
const livePredictBefore=intakePredict;
intakePredict=function(n){return categories.find(c=>c.name===n.aiCategory)?.id||livePredictBefore(n);};
intakeAutoOrganize=async function(){
 if(IntakeUI.busy)return;const pending=allPending();if(!pending.length)return;IntakeUI.busy=true;render();let done=0,failed=0;
 try{for(const n of pending){try{
  if(n.aiState!=='done')await liveAnalyze(n);if(note(n.id)!==n)continue;
  const draft=IntakeUI.drafts.get(n.id),destination=draft?.chosenByUser&&cat(draft.category)?draft.category:categories.find(c=>c.name===n.aiCategory)?.id;
  if(!destination){failed++;continue;}snapshot();n.category=destination;orbitMarkAuto(n);if(draft?.tagsEdited)n.tags=parseTags(draft.tags);IntakeUI.drafts.delete(n.id);save();done++;
 }catch{failed++;}}}finally{IntakeUI.busy=false;V.review=null;V.skipped.clear();render();toast(`AI 已整理 ${done} 条${failed?'，'+failed+' 条保留待处理，请核对正文与分类':''}。`);}
};
const liveDetailBefore=renderDetail;
renderDetail=function(){liveDetailBefore();const n=note(S.detail),article=$('#overlay .detailmain');if(!n||!article)return;
 const section=document.createElement('section');section.className='detailsection';section.innerHTML=`<button class="btn small" data-live-analyze="${esc(n.id)}">AI 重新整理</button><p class="helptext">${esc(n.aiError||(n.aiState==='done'?'AI 已生成摘要与标签，请核对原文。':'原文已保存，可使用 AI 生成摘要与分类建议。'))}</p>`;article.prepend(section);
};
function liveOpenChat(){S.modal='live-chat';openModal('AI 找资料',`<form id="live-chat-form" class="modalbody"><label class="formfield"><span>向自己的资料提问</span><textarea name="message" required maxlength="4000" placeholder="例如：已有资料中有哪些值得写入报告的观点？"></textarea></label><p class="helptext">问题与当前资料会发送至本站配置的 AI 服务；请核对引用。</p><button class="btn primary" type="submit">发送</button><div id="live-chat-result" style="white-space:pre-wrap;margin-top:18px" role="status"></div></form>`);}
demoAI=liveOpenChat;
const liveRenderBefore=render;
render=function(){if(TextInput.composing.size){TextInput.pendingRender=true;return;}liveRenderBefore();const actions=$('.ux-header-actions');if(actions&&!$('#live-ai-button')){const button=document.createElement('button');button.id='live-ai-button';button.className='btn small';button.textContent='AI';button.setAttribute('aria-label','AI 找资料');button.addEventListener('click',liveOpenChat);actions.prepend(button);}};
document.addEventListener('click',async e=>{const button=e.target.closest('[data-live-analyze]');if(!button)return;button.disabled=true;button.textContent='AI 整理中…';const n=note(button.dataset.liveAnalyze);try{if(n)await liveAnalyze(n);}catch(error){toast(error.message);}finally{render();if(S.detail===n?.id)renderDetail();}});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='live-chat-form')return;e.preventDefault();const form=e.target,result=form.querySelector('#live-chat-result'),button=form.querySelector('button[type=submit]');button.disabled=true;result.textContent='正在查阅资料…';
 const refs=new Map(data.notes.map((n,i)=>[i+1,n.id])),cards=data.notes.map((n,i)=>({id:i+1,t:n.title,one:n.summary,body:n.body.match(/[\s\S]{1,1000}/g)||[],core:n.core||'',quote:n.quote||'',ref:n.source,tags:n.tags}));
 try{const answer=await liveAPI('chat',{message:new FormData(form).get('message'),cards,history:[]});result.textContent=answer.reply;for(const id of answer.ids){const n=note(refs.get(id));if(!n)continue;const link=document.createElement('button');link.type='button';link.className='btn small';link.textContent='['+id+'] '+n.title;link.addEventListener('click',()=>openDetail(n.id));result.append(document.createElement('br'),link);}}
 catch(error){result.textContent=error.message;}finally{button.disabled=false;}
});
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
liveMigrate();render();
