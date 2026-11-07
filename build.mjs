import fs from 'node:fs/promises';
import {build} from 'esbuild';
// 只把明确的前端资源复制到公开目录，禁止暴露后端及环境文件。
await fs.mkdir('public',{recursive:true});
for(const file of ['index.html','reliability.js','app.js','media.js'])await fs.copyFile(file,'public/'+file);
await build({entryPoints:['browser-documents.mjs'],bundle:true,platform:'browser',format:'esm',minify:true,outfile:'public/document-worker.js',alias:{'node:path':'path-browserify'}});
await fs.copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','public/pdf.worker.min.mjs');
await fs.cp('node_modules/pdfjs-dist/cmaps','public/cmaps',{recursive:true});
// 中文 PDF 的 CID 字体映射仅供后端读取。
await fs.cp(new URL('./cmaps/',import.meta.resolve('pdfjs-dist/package.json')),new URL('./pdf-assets/cmaps/',import.meta.url),{recursive:true});
