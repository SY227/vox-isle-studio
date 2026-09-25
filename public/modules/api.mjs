export async function status(){const r=await fetch('/api/status',{cache:'no-store'});if(!r.ok)throw new Error('無法連接本機伺服器。');return r.json();}
export async function post(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const b=await r.json();if(!r.ok)throw new Error(b.error||'請求失敗。');return b;}
/** Progressive NDJSON: ready opens the studio; updates never reload its player.
 * Await handlers to maintain ordering even when several packets share a chunk.
 */
export async function analyze(url,data,onPhase,signal,onResult=()=>{}){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal});
  if(!response.ok){const b=await response.json().catch(()=>({}));const e=new Error(b.error||'分析請求失敗。');e.code=b.code;throw e;}
  if(!response.body)throw new Error('分析連線未傳回內容。');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result,latest;
  const process=async line=>{
    if(!line.trim())return;
    const packet=JSON.parse(line);
    if(packet.type==='phase')onPhase(packet);
    if(['ready','update'].includes(packet.type)&&packet.result){latest=packet.result;await onResult(packet);}
    if(packet.type==='error'){const e=new Error(packet.error);e.code=packet.code;throw e;}
    if(packet.type==='done')result=packet.result;
  };
  try{
    while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});if(buffer.length>8000000)throw new Error('分析資料超過連線上限。');let i;while((i=buffer.indexOf('\n'))>=0){await process(buffer.slice(0,i));buffer=buffer.slice(i+1);}if(done)break;}
    if(buffer.trim())await process(buffer);
  }catch(e){
    if(signal?.aborted||!latest)throw e;
    // A lost connection after ready preserves usable results, without claiming completion.
    return {...latest,adaptive:{...latest.adaptive,state:'partial',revision:(latest.adaptive?.revision||0)+1}};
  }finally{reader.releaseLock();}
  if(result)return result;
  if(latest)return {...latest,adaptive:{...latest.adaptive,state:'partial',revision:(latest.adaptive?.revision||0)+1}};
  throw new Error('連線結束，但沒有收到可用歌詞。請重試。');
}
