import path from 'node:path';
import {unzipSync} from 'fflate';
import {XMLParser,XMLValidator} from 'fast-xml-parser';

function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
const local=name=>name.split(':').pop();
const key=node=>Object.keys(node).find(k=>k!==':@'&&!k.startsWith('#')&&!k.startsWith('?'));
const children=node=>node[key(node)]||[];
function find(nodes,name){const result=[];for(const n of nodes){if(local(key(n)||'')===name)result.push(n);result.push(...find(children(n),name));}return result;}
const attr=(node,name)=>node[':@']?.['@_'+name];
function textRuns(nodes){let value='';for(const n of nodes){const name=local(key(n)||'');if(name==='t')value+=children(n).map(x=>x['#text']??'').join('');else if(name==='br')value+='\n';else if(name==='tab')value+='\t';else value+=textRuns(children(n));}return value;}
function paragraphs(nodes,notes=false){
 const lines=[];
 for(const n of nodes){const name=local(key(n)||'');
  if(notes&&name==='sp'&&find(children(n),'ph').some(p=>['sldNum','hdr','ftr','dt','sldImg'].includes(attr(p,'type'))))continue;
  if(name==='p'){const t=textRuns(children(n)).trim();if(t)lines.push(t);}
  else if(name==='tr'){const cells=find(children(n),'tc').map(c=>paragraphs(children(c),notes).join(' / '));if(cells.some(Boolean))lines.push(cells.join('\t'));}
  else lines.push(...paragraphs(children(n),notes));
 }
 return lines;
}
// Only package-internal relationships are followed; external links are never fetched.
function target(part,value){
 if(typeof value!=='string'||/[\\?#%]/.test(value)||/^[a-z][a-z0-9+.-]*:/i.test(value))fail('PPTX 的内部引用无效，请重新导出。');
 const result=path.posix.normalize(value.startsWith('/')?value.slice(1):path.posix.join(path.posix.dirname(part),value));
 if(!result.startsWith('ppt/')||result.includes('..'))fail('PPTX 的内部引用超出文档范围。');return result;
}
export function parsePptx(buffer){
 if(buffer.length<4||buffer.readUInt32LE(0)!==0x04034b50)fail('文件不是有效 PPTX；旧版 PPT 请另存为 PPTX。');
 try{
  let total=0,count=0;const names=new Set();
  const files=unzipSync(buffer,{filter:e=>{
   total+=e.originalSize;count++;
   if(total>20000000||count>2000)fail('PPTX 解压内容过大，请精简图片或拆分文件。',413);
   if(names.has(e.name))fail('PPTX 含重复文件记录，请重新导出。');names.add(e.name);
   return /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/(slide\d+\.xml|_rels\/slide\d+\.xml\.rels)|notesSlides\/notesSlide\d+\.xml)$/.test(e.name);
  }});
  const parser=new XMLParser({ignoreAttributes:false,preserveOrder:true,trimValues:false,parseTagValue:false,parseAttributeValue:false,processEntities:true,htmlEntities:true});
  function read(name,root){
   if(!files[name])fail('PPTX 缺少必要内容（'+name+'），请重新导出。');
   const xml=new TextDecoder('utf-8',{fatal:true}).decode(files[name]);
   if(xml.length>2000000)fail('PPTX 单页内容过大，请拆分文件。',413);
   if(/<!\s*(DOCTYPE|ENTITY)/i.test(xml)||XMLValidator.validate(xml)!==true)fail('PPTX 的 XML 内容无效，请重新导出。');
   const tree=parser.parse(xml);if(!tree.some(n=>local(key(n)||'')===root))fail('PPTX 的文档结构无效。');return tree;
  }
  function relationships(part){const rel=path.posix.join(path.posix.dirname(part),'_rels',path.posix.basename(part)+'.rels');return files[rel]?find(read(rel,'Relationships'),'Relationship'):[];}
  const main='ppt/presentation.xml',presentation=read(main,'presentation'),rels=relationships(main),ids=find(presentation,'sldId');
  if(!ids.length)fail('PPTX 没有幻灯片。');if(ids.length>80)fail('PPTX 最多 80 页，请拆分后上传。',413);
  const used=new Set(),slides=[];let textLength=0,hasText=false,hasVisuals=false;
  for(const [i,id]of ids.entries()){
   const refName=Object.keys(id[':@']||{}).find(k=>/^@_.+:id$/.test(k)),rid=id[':@']?.[refName];
   const matches=rels.filter(r=>attr(r,'Id')===rid&&/\/slide$/.test(attr(r,'Type')||'')&&attr(r,'TargetMode')!=='External');
   if(matches.length!==1)fail('PPTX 幻灯片顺序引用无效，请重新导出。');
   const part=target(main,attr(matches[0],'Target'));if(used.has(part))fail('PPTX 含重复幻灯片引用。');used.add(part);
   const tree=read(part,'sld'),body=paragraphs(tree).join('\n');
   const notesRels=relationships(part).filter(r=>/\/notesSlide$/.test(attr(r,'Type')||'')&&attr(r,'TargetMode')!=='External');
   if(notesRels.length>1)fail('PPTX 备注引用无效。');
   const notes=notesRels.length?paragraphs(read(target(part,attr(notesRels[0],'Target')),'notes'),true).join('\n'):'';
   const visuals=find(tree,'pic').length+find(tree,'chart').length+find(tree,'relIds').length;
   hasVisuals||=visuals>0;hasText||=!!(body||notes);
   const hidden=tree.some(n=>local(key(n)||'')==='sld'&&['0','false'].includes(attr(n,'show')));
   const text=`[第 ${i+1} 页${hidden?' · 隐藏页':''}]\n${body||'（本页没有可提取文字）'}${notes?'\n[演讲者备注]\n'+notes:''}${visuals?'\n（含图片、图表或 SmartArt，视觉内容未提取）':''}`;
   textLength+=text.length+2;if(textLength>20000)fail('PPTX 解析正文超过 20000 字，请拆分文件后上传；不会截断正文。',413);
   slides.push(text);
  }
  if(!hasText)fail('PPTX 中没有可提取的文字或备注。纯图片幻灯片请导出为 PNG/JPG 后上传识别。');
  return {text:slides.join('\n\n'),pages:slides.length,method:'pptx',warnings:[hasVisuals?'已提取逐页文字、表格和备注；图片、复杂图表和 SmartArt 的视觉内容未识别，请将相关页导出为图片补充。':'已提取逐页文字、表格和备注；未还原幻灯片的视觉排版、动画和母版内容。']};
 }catch(e){if(e.status)throw e;fail('PPTX 无法解析：文件可能已加密、损坏或格式不受支持，请重新另存为 PPTX。');}
}
