import {Buffer} from 'buffer';
import {parseExcel} from './excel.mjs';
import {parsePptx} from './pptx.mjs';
import mammoth from 'mammoth/mammoth.browser.js';
self.onmessage=async({data:{name,bytes}})=>{
 try{
  const ext=name.split('.').pop().toLowerCase(),buffer=Buffer.from(bytes);let result;
  if(['xlsx','xls'].includes(ext))result=parseExcel(buffer,ext);
  else if(ext==='pptx')result=parsePptx(buffer);
  else if(ext==='docx'){
   // Preflight ZIP limits using the same bounded container validation.
   const {unzipSync}=await import('fflate');let total=0,count=0,found=false;
   unzipSync(buffer,{filter:e=>{total+=e.originalSize;if(total>80000000||++count>2000)throw Error('文档解压内容过大，请拆分。');if(e.name==='word/document.xml')found=true;return false;}});
   if(!found)throw Error('文件不是有效 DOCX。');
   result={text:(await mammoth.extractRawText({arrayBuffer:bytes})).value,method:'docx'};
  }else throw Error('此格式暂不支持本机解析。');
  if(!result.text?.trim())throw Error('没有可提取的正文，扫描件请另传页面图片。');
  if(result.text.length>20000)throw Error('提取正文超过 20000 字，请拆分文件；没有截断原文。');
  self.postMessage({result:{...result,name,warnings:result.warnings||[]}});
 }catch(e){self.postMessage({error:e.message||'文件解析失败，请核对原件。'});}
};
