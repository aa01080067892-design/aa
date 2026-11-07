import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/build/pdf.mjs';
GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
export async function parsePDF(blob,name){
 const pdf=await getDocument({data:new Uint8Array(await blob.arrayBuffer()),cMapUrl:'/cmaps/',cMapPacked:true}).promise;
 try{
  if(pdf.numPages>80)throw Error('PDF 最多解析 80 页，请拆分。');
  const parts=[];let length=0;
  for(let i=1;i<=pdf.numPages;i++){
   const page=await pdf.getPage(i),content=await page.getTextContent();
   const part=content.items.map(x=>x.str+(x.hasEOL?'\n':' ')).join('');length+=part.length;
   if(length>20000)throw Error('提取正文超过 20000 字，请拆分文件；没有截断原文。');
   parts.push(part);page.cleanup();
  }
  const text=parts.join('\n\n').trim();if(!text)throw Error('未提取到 PDF 正文，扫描件请另传页面图片。');
  return {name,text,method:'pdf',pages:pdf.numPages,warnings:[]};
 }finally{await pdf.destroy();}
}
