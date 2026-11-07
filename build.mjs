import fs from 'node:fs/promises';
// 只把明确的前端资源复制到公开目录，禁止暴露后端及环境文件。
await fs.mkdir('public',{recursive:true});
for(const file of ['index.html','reliability.js','app.js'])await fs.copyFile(file,'public/'+file);
// 中文 PDF 的 CID 字体映射仅供后端读取。
await fs.cp(new URL('./cmaps/',import.meta.resolve('pdfjs-dist/package.json')),new URL('./pdf-assets/cmaps/',import.meta.url),{recursive:true});
