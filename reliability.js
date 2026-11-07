/* 浏览器与回归测试共用的资料一致性规则。 */
const WorkspaceRules={
 revise(previous,next){
  if(!previous)return next;
  next.manualFields={...previous.manualFields};
  for(const key of ['title','summary','tags'])if(JSON.stringify(previous[key])!==JSON.stringify(next[key]))next.manualFields[key]=true;
  if(previous.body!==next.body){
   next.aiState='stale';next.aiError='正文已修改，请重新分析；旧分析已失效。';
   next.points=[];next.core='';next.quote='';next.aiCategory='';next.aiCategoryId='';
   delete next.aiSuggestion;delete next.aiBody;
   if(!next.manualFields.summary)next.summary=next.body.slice(0,80);
  }
  return next;
 },
 categoryId(result,categories,path){
  if(result.categoryId&&categories.some(c=>c.id===result.categoryId))return result.categoryId;
  const matches=categories.filter(c=>path(c.id)===result.category||c.name===result.category);
  return matches.length===1?matches[0].id:'';
 },
 applyAnalysis(n,result,categoryId){
  const review=!!(n.aiBody||n.manualFields||n.aiState==='stale'||n.aiState==='done');
  n.aiSuggestion={title:result.title,summary:result.summary,tags:result.tags};
  n.aiSuggestionPending=review;
  if(!review)for(const key of ['title','summary','tags'])if(!n.manualFields?.[key])n[key]=result[key];
  Object.assign(n,{points:result.points,core:result.core,quote:result.quote,aiCategory:result.category,aiCategoryId:categoryId,aiState:'done',aiError:'',aiBody:n.body});
 },
 chatScope(notes,selected,visible,scope,includeDemo=false){
  const ids=new Set(scope==='selected'?selected:visible);
  return notes.filter(n=>(includeDemo||!n.demo)&&(scope==='all'||ids.has(n.id)));
 },
 chatCards(notes,message){
  const terms=[...new Set((message.toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]+/gu)||[]).flatMap(t=>t.length>2&&/[\u3400-\u9fff]/u.test(t)?[t,...Array.from({length:t.length-1},(_,i)=>t.slice(i,i+2))]:[t]))];
  const score=s=>terms.reduce((v,t)=>v+(s.toLowerCase().includes(t)?t.length:0),0);
  const ranked=notes.map((n,i)=>({n,i,score:score(n.title+' '+n.summary+' '+n.tags.join(' '))+score(n.body)})).sort((a,b)=>b.score-a.score||a.i-b.i);
  const cards=[],refs=new Map();let chars=0,partial=false;
  for(const {n}of ranked){
   if(cards.length>=40||chars>58000){partial=true;break;}
   const chunks=n.body.match(/[\s\S]{1,800}/g)||[];
   const chosen=chunks.map((s,i)=>({s,i,score:score(s)})).sort((a,b)=>b.score-a.score||a.i-b.i).slice(0,5).sort((a,b)=>a.i-b.i);
   const current=n.aiState!=='stale';
   const card={id:cards.length+1,t:((n.demo?'[示例资料] ':'')+n.title).slice(0,200),one:(current||n.manualFields?.summary?n.summary:'').slice(0,1000),body:chosen.map(x=>x.s),core:(current?n.core||'':'').slice(0,1000),quote:(current?n.quote||'':'').slice(0,1000),ref:((n.demo?'演示示例，非真实研究证据；':'')+n.source).slice(0,500),tags:n.tags.slice(0,6)};
   if(JSON.stringify(card).length+chars>68000){partial=true;continue;}
   chars+=JSON.stringify(card).length;cards.push(card);refs.set(card.id,n.id);if(chosen.length<chunks.length)partial=true;
  }
  return {cards,refs,partial,total:notes.length};
 }
};
