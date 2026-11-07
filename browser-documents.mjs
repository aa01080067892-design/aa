import {Buffer} from 'buffer';
import {parseExcel} from './excel.mjs';
import {parsePptx} from './pptx.mjs';
import mammoth from 'mammoth/mammoth.browser.js';
import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/build/pdf.mjs';
GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
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
  }else if(ext==='pdf'){
   const pdf=await getDocument({data:new Uint8Array(bytes),cMapUrl:'/cmaps/',cMapPacked:true}).promise;
   try{if(pdf.numPages>80)throw Error('PDF 最多解析 80 页，请拆分。');const parts=[];let length=0;
    for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),content=await page.getTextContent();const part=content.items.map(x=>x.str+(x.hasEOL?'\n':' ')).join('');length+=part.length;if(length>20000)throw Error('提取正文超过 20000 字，请拆分文件。');parts.push(part);page.cleanup();}
    result={text:parts.join('\n\n'),method:'pdf',pages:pdf.numPages};
   }finally{await pdf.destroy();}
  }else throw Error('此格式暂不支持本机解析。');
  if(!result.text?.trim())throw Error('没有可提取的正文，扫描件请另传页面图片。');
  if(result.text.length>20000)throw Error('提取正文超过 20000 字，请拆分文件；没有截断原文。');
  self.postMessage({result:{...result,name,warnings:result.warnings||[]}});
 }catch(e){self.postMessage({error:e.message||'文件解析失败，请核对原件。'});}
};
