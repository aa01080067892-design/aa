/* File bytes stay in the browser. Only transcripts and sampled images go to the existing API. */
const MediaFiles=(()=>{
 const MAX=40*1048576,AUDIO=['mp3','wav','m4a','aac','ogg','flac','webm'],VIDEO=['mp4','mov','m4v','webm'];
 let speech;
 const stamp=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
 const isMedia=(ext,type='')=>AUDIO.includes(ext)||VIDEO.includes(ext)||/^(audio|video)\//.test(type);
 function parseDocument(blob,name){return new Promise((resolve,reject)=>{
  const worker=new Worker('/document-worker.js',{type:'module'}),timer=setTimeout(()=>{worker.terminate();reject(Error('文件解析超时，请拆分后重试。'));},120000);
  const done=()=>{clearTimeout(timer);worker.terminate();};worker.onmessage=({data})=>{done();data.error?reject(Error(data.error)):resolve(data.result);};worker.onerror=()=>{done();reject(Error('本机解析组件加载失败，请刷新后重试。'));};blob.arrayBuffer().then(bytes=>worker.postMessage({name,bytes},[bytes])).catch(e=>{done();reject(e);});
 });}
 async function transcribe(blob,progress){
  progress('正在本机解码音轨…');
  const context=new AudioContext();let decoded;try{decoded=await context.decodeAudioData(await blob.arrayBuffer());}catch{throw Error('浏览器无法解码音轨，请转换为 MP3/WAV，或上传字幕文件。');}finally{await context.close();}
  if(decoded.duration>1800)throw Error('音轨最长支持 30 分钟，请拆分后上传。');
  const rate=16000,offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*rate),rate),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
  const pcm=(await offline.startRendering()).getChannelData(0);
  progress('首次加载本机语音模型（约 150 MB），请保持页面打开…');
  if(!speech)speech=(async()=>{const {pipeline,env}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2');env.allowLocalModels=false;env.backends.onnx.wasm.numThreads=1;return pipeline('automatic-speech-recognition','onnx-community/whisper-base',{dtype:'q8',device:'wasm'});})().catch(e=>{speech=undefined;throw Error('语音模型下载失败，请检查网络后重试。');});
  const recognizer=await speech,parts=[];let length=0;
  for(let start=0;start<pcm.length;start+=rate*25){progress('正在本机转写 '+stamp(start/rate)+' / '+stamp(decoded.duration));
   const r=await recognizer(pcm.slice(start,Math.min(start+rate*25,pcm.length)),{language:'chinese',task:'transcribe'});
   const text=String(r.text||'').trim();if(text){length+=text.length;if(length>16000)throw Error('语音转写超过 16000 字，请拆分后重试。');parts.push(`[${stamp(start/rate)}] ${text}`);}
  }
  if(!parts.length)throw Error('未识别到语音，音乐或静音不能生成语音正文。');
  return {text:parts.join('\n'),duration:decoded.duration};
 }
 async function frames(blob,progress,api){
  const video=document.createElement('video'),url=URL.createObjectURL(blob);video.preload='auto';video.muted=true;video.playsInline=true;video.src=url;
  const event=(name,action)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(Error('视频读取超时，请转为 MP4/H.264。')),20000);const ok=()=>finish(),bad=()=>finish(Error('浏览器无法读取此视频编码，请转换为 MP4/H.264。'));function finish(error){clearTimeout(timer);video.removeEventListener(name,ok);video.removeEventListener('error',bad);error?reject(error):resolve();}video.addEventListener(name,ok,{once:true});video.addEventListener('error',bad,{once:true});action?.();});
  try{await event('loadedmetadata',()=>video.load());if(!Number.isFinite(video.duration)||video.duration>1800)throw Error('视频最长支持 30 分钟，请拆分。');
   const count=Math.min(6,Math.max(1,Math.ceil(video.duration/20))),parts=[];
   for(let i=0;i<count;i++){const time=Math.min(Math.max(.01,video.duration*(i+.5)/count),Math.max(.01,video.duration-.1));progress(`正在分析关键画面 ${i+1}/${count}（${stamp(time)}）…`);await event('seeked',()=>{video.currentTime=time;});
    const canvas=document.createElement('canvas'),scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const result=await api('upload',{mode:'video-frame',data:canvas.toDataURL('image/jpeg',.72).split(',')[1]});parts.push(`[画面 ${stamp(time)}] ${result.text}`);
   }return {text:parts.join('\n'),duration:video.duration,count};
  }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
 }
 async function parse(blob,name,type,progress,api){
  if(!blob.size||blob.size>MAX)throw Error('请选择 40 MB 以内的非空文件。');
  const ext=name.split('.').pop().toLowerCase();
  if(!isMedia(ext,type))return parseDocument(blob,name);
  const video=type.startsWith('video/')||['mp4','mov','m4v'].includes(ext)||(ext==='webm'&&!type.startsWith('audio/'));
  const warnings=['自动转写可能有误，请核对原音频；时间标记为分段起点。'],sections=[];let duration,count=0;
  if(video){const r=await frames(blob,progress,api);sections.push('[视频抽样画面描述]\n'+r.text);duration=r.duration;count=r.count;warnings.push(`仅均匀抽样 ${count} 幅画面，不代表完整逐帧分析，未抽到的内容可能遗漏。`);}
  try{const r=await transcribe(blob,progress);sections.push('[语音转写]\n'+r.text);duration=r.duration;}catch(e){if(!video)throw e;warnings.push('音轨未完成转写：'+e.message);}
  const text=sections.join('\n\n');if(text.length>20000)throw Error('音视频提取内容超过 20000 字，请拆分。');
  return {name,text,method:video?'video':'audio',duration,frames:count,warnings};
 }
 return {parse,isMedia};
})();
