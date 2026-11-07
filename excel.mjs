import {unzipSync} from 'fflate';
import XLSX from 'xlsx';
import {Buffer} from 'buffer';

function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
const MAX_TEXT=20000,MAX_SHEETS=40,MAX_CELLS=20000;
const ole=Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
// Only Excel packages are accepted. Do not let the reader infer HTML/CSV from an Excel extension.
function checkContainer(buffer,ext){
 if(ext==='xls'){
  if(!buffer.subarray(0,8).equals(ole))fail('文件不是受支持的 XLS 工作簿，请用 Excel 另存为 XLSX。');return;
 }
 if(buffer.length<4||buffer.readUInt32LE(0)!==0x04034b50)fail('文件不是有效 XLSX，可能已加密，请解除密码后另存为 XLSX。');
 let size=0,count=0,workbook=false;const names=new Set();
 unzipSync(buffer,{filter:e=>{
  size+=e.originalSize;count++;
  if(size>80000000||count>2000)fail('Excel 解压内容过大，请减少工作表、图片或拆分文件。',413);
  if(names.has(e.name))fail('Excel 包含重复文件记录，请重新另存为 XLSX。');names.add(e.name);
  if(e.name==='xl/workbook.xml')workbook=true;
  if(/(?:^|\/)vbaProject\.bin$/i.test(e.name))fail('暂不支持含宏的工作簿，请另存为不含宏的 XLSX。');
  return false;
 }});
 if(!workbook)fail('XLSX 缺少工作簿内容，不能通过修改扩展名转换文件。');
}
const clean=v=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const quoted=v=>JSON.stringify(clean(v));
export function parseExcel(buffer,ext){
 try{
  checkContainer(buffer,ext);
  // Keep formula text and stored values. No formula, macro or external link is executed/refreshed.
  const book=XLSX.read(buffer,{type:'buffer',cellFormula:true,cellText:true,cellNF:true,cellStyles:true,cellDates:false,sheetStubs:true,WTF:true});
  if(!Array.isArray(book.SheetNames)||!book.SheetNames.length)fail('Excel 工作簿没有可读取的工作表。');
  if(book.SheetNames.length>MAX_SHEETS)fail('Excel 最多解析 40 个工作表，请拆分后上传。',413);
  const sections=[],sheetDetails=[];let length=0,cells=0,formulaCount=0,missingResults=0,errorCount=0,hidden=false;
  function add(text){length+=text.length+1;if(length>MAX_TEXT)fail('Excel 提取内容超过 20000 字，请拆分工作表或减少数据后上传；不会静默截断。',413);sections.push(text);}
  add('[Excel 读取说明] 单元格按工作表、行列地址列出；未列出的空白或仅格式单元格不代表 0。公式结果来自文件中已有的缓存，不重新计算或更新外部链接。');
  for(const [index,name]of book.SheetNames.entries()){
   const sheet=book.Sheets[name];if(!sheet)fail('Excel 工作表内容缺失，请重新另存为 XLSX。');
   const visibility=book.Workbook?.Sheets?.[index]?.Hidden||0;hidden||=!!visibility;
   const metadata={name,hidden:!!visibility,cells:0};sheetDetails.push(metadata);
   add(`\n[工作表 ${index+1}: ${quoted(name)}${visibility?' · 隐藏工作表':''}]`);
   const addresses=Object.keys(sheet).filter(k=>/^[A-Z]+[1-9]\d*$/.test(k)&&sheet[k]&&(sheet[k].f||sheet[k].F||(sheet[k].t!=='z'&&sheet[k].v!==undefined)));
   if(cells+addresses.length>MAX_CELLS)fail('Excel 非空单元格超过 20000 个，请拆分后上传。',413);
   addresses.sort((a,b)=>{const x=XLSX.utils.decode_cell(a),y=XLSX.utils.decode_cell(b);return x.r-y.r||x.c-y.c;});
   const merges=sheet['!merges']||[];
   if(merges.length)add('合并区域：'+merges.map(r=>XLSX.utils.encode_range(r)).join('、')+'（内容保留在左上角单元格）');
   let row=-1,values=[],rowLength=0;
   const flush=()=>{if(values.length)add(`第 ${row+1} 行${sheet['!rows']?.[row]?.hidden?'（隐藏行）':''}: `+values.join(' | '));values=[];rowLength=0;};
   for(const address of addresses){
    const cell=sheet[address],position=XLSX.utils.decode_cell(address);
    if(position.r!==row){flush();row=position.r;}
    let value;
    if(cell.t==='e'){errorCount++;value='错误 '+quoted(cell.w||XLSX.utils.format_cell(cell));}
    else if(cell.t==='z'||cell.v===undefined||cell.v===null)value='[无缓存结果]';
    else if(typeof cell.v==='number'){
     const display=clean(cell.w??XLSX.utils.format_cell(cell));
     value=Number.isFinite(cell.v)?String(cell.v):'[无效数字]';
     if(display!==value)value+=`（显示 ${quoted(display)}）`;
    }else if(typeof cell.v==='boolean')value=cell.v?'TRUE':'FALSE';
    else value=quoted(cell.v);
    if(cell.f){formulaCount++;if(cell.t==='z'||cell.v===undefined||cell.v===null)missingResults++;value=`公式 ${quoted('='+cell.f)}；文件缓存 ${value}`;}
    else if(cell.F)value=`数组公式范围 ${quoted(cell.F)}；文件缓存 ${value}`;
    const entry=address+(sheet['!cols']?.[position.c]?.hidden?'（隐藏列）':'')+'='+value;
    values.push(entry);rowLength+=entry.length+3;cells++;metadata.cells++;
    // Bound intermediate strings before joining a very wide row.
    if(rowLength+length>MAX_TEXT)fail('Excel 提取内容超过 20000 字，请拆分工作表或减少数据后上传；不会静默截断。',413);
   }
   flush();if(!addresses.length)add('（空工作表）');
  }
  if(!cells)fail('Excel 中没有可分析的单元格数据；图片或图表请导出为 PNG/JPG 后上传。');
  const warnings=['已提取各工作表的单元格数据、地址及合并区域；不重新计算公式或更新外部链接。不还原视觉排版，也不识别图片、图表、透视图或批注。'];
  if(formulaCount)warnings.push(`包含 ${formulaCount} 个公式，仅保留公式与文件缓存结果，不重新计算；缓存可能过期${missingResults?'，其中 '+missingResults+' 个公式没有缓存结果':''}。`);
  if(errorCount)warnings.push(`包含 ${errorCount} 个错误单元格，请回到原表核对。`);
  if(hidden)warnings.push('已包含隐藏工作表，正文中已明确标记。');
  if(ext==='xls')warnings.push('旧版 XLS 已读取；复杂格式或公式建议另存为 XLSX 后核对。');
  return {text:sections.join('\n'),method:'excel',pages:null,sheets:sheetDetails,warnings};
 }catch(e){if(e.status)throw e;fail('Excel 无法解析：可能已加密、损坏或不是有效工作簿，请解除密码并重新另存为 XLSX。');}
}
