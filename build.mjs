import fs from 'node:fs/promises';
// 只把明确的前端资源复制到公开目录，禁止暴露后端及环境文件。
await fs.mkdir('public',{recursive:true});
for(const file of ['index.html','app.js'])await fs.copyFile(file,'public/'+file);
