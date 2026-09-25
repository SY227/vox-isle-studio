const delay=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(signal.reason);
  const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);resolve();};
  const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(signal.reason);};
  const timer=setTimeout(done,ms);signal?.addEventListener('abort',cancel,{once:true});
});
export async function status(signal){
  let last;for(let attempt=0;attempt<4;attempt++){
    if(signal?.aborted)throw signal.reason;
    try{const r=await fetch('/api/status',{cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(6000)]):AbortSignal.timeout(6000)});if(!r.ok){const e=new Error('工作室連線暫時未就緒。');e.terminal=r.status>=400&&r.status<500;throw e;}return await r.json();}
    catch(e){last=e;if(signal?.aborted||e.terminal||attempt===3)throw e;await delay(250*2**attempt,signal);}
  }throw last;
}
export async function post(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const b=await r.json();if(!r.ok)throw new Error(b.error||'請求失敗。');return b;}
/** One job, progressive NDJSON. Never retry a POST that may already be working.
 * Heartbeats keep the read watchdog alive. A dead stream preserves ready lyrics.
 */
export async function analyze(url,data,onPhase,signal,onResult=()=>{},limits={}){
  const controller=new AbortController();let timer,reader,latest,result,requestId;
  const cancel=()=>controller.abort(signal.reason);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  const watch=ms=>{clearTimeout(timer);timer=setTimeout(()=>{const e=new Error('工作室連線等候逾時；已有歌詞會保留，請稍後再試。');e.code='STREAM_TIMEOUT';controller.abort(e);},ms);};
  const wait=async promise=>{
    if(controller.signal.aborted)throw controller.signal.reason;
    let abort;const stop=new Promise((_,reject)=>{abort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});});
    try{return await Promise.race([promise,stop]);}finally{controller.signal.removeEventListener('abort',abort);}
  };
  try{
    watch(limits.headersMs||20000);
    const response=await wait(fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal}));
    requestId=response.headers.get('x-request-id');
    if(!response.ok){const b=await wait(response.json().catch(()=>({})));const e=new Error(b.error||'分析請求失敗。');e.code=b.code;e.requestId=b.requestId||requestId;throw e;}
    if(!response.body)throw new Error('分析連線未傳回內容。');
    reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
    const process=async line=>{
      if(!line.trim())return;
      const packet=JSON.parse(line);
      if(packet.type==='phase')onPhase(packet);
      if(['ready','update'].includes(packet.type)&&packet.result){latest=packet.result;await onResult(packet);}
      if(packet.type==='error'){const e=new Error(packet.error);e.code=packet.code;e.requestId=packet.requestId||requestId;throw e;}
      if(packet.type==='done')result=packet.result;
    };
    while(true){
      watch(limits.idleMs||45000);
      const {value,done}=await wait(reader.read());clearTimeout(timer);
      buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
      if(buffer.length>8000000)throw new Error('分析資料超過連線上限。');
      let i;while((i=buffer.indexOf('\n'))>=0){await process(buffer.slice(0,i));buffer=buffer.slice(i+1);}
      if(result)break;
      if(done){if(buffer.trim())await process(buffer);break;}
    }
    if(result)return result;
    if(latest)return {...latest,adaptive:{...latest.adaptive,state:'partial',revision:(latest.adaptive?.revision||0)+1}};
    throw new Error('連線結束，但沒有收到可用歌詞。請重試。');
  }catch(e){
    if(signal?.aborted)throw signal.reason||e;
    if(latest)return {...latest,adaptive:{...latest.adaptive,state:'partial',revision:(latest.adaptive?.revision||0)+1}};
    if(requestId&&!e.requestId)e.requestId=requestId;throw e;
  }finally{
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort();
    // Do not await cancel on a broken transport; it may itself never settle.
    if(reader){reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
  }
}
