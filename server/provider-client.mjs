/** Bounded provider transport. Retries cover headers AND the complete JSON body.
 * A compatibility fallback consumes the same four-attempt budget as a retry.
 * Diagnostics deliberately exclude URLs, keys, prompts, lyrics and provider text.
 */
import {AppError} from './validation.mjs';
const transient=new Set([408,425,429,500,502,503,504]);
const compatible=new Set([400,404,405,422,501]);
const now=()=>Date.now();
export const newProviderRuntime=()=>({cooldownUntil:0,routes:new Map(),scans:new Map()});
export function aborted(signal){
  if(signal?.reason instanceof AppError)return signal.reason;
  return signal?.reason?.name==='TimeoutError'
    ?new AppError('分析等候已達上限；已取得的歌詞會保留。',504,'TIMEOUT')
    :new AppError('分析已取消。',499,'CANCELLED');
}
export function retryAfterMs(value,body={},at=now()){
  let delay=0;
  if(value!=null){const n=Number(value);delay=Number.isFinite(n)?n*1000:Math.max(0,Date.parse(value)-at)||0;}
  for(const d of body?.error?.details||[]){if(typeof d?.retryDelay==='string'&&/^\d+(\.\d+)?s$/.test(d.retryDelay))delay=Math.max(delay,parseFloat(d.retryDelay)*1000);}
  return Math.min(24*3600000,Math.max(0,delay));
}
export function classifyHttp(status,body={},retryAfter){
  const text=String(body?.error?.message||body?.message||'');
  let code='GEMINI_'+status,message='分析服務暫時未能完成要求；請稍後再試。';
  if(status===401||/api.?key.*(invalid|not valid|leaked|expired)|invalid.*api.?key/i.test(text)){status=401;code='GEMINI_401';message='分析服務的連線憑證需要更新。請聯絡工作室管理員。';}
  else if(status===402){message='分析服務的帳務額度不足，請聯絡工作室管理員。';}
  else if(status===403){message='分析服務拒絕存取；需要管理員檢查服務或來源權限。';}
  else if(status===404){message='目前的分析服務未能使用。請聯絡工作室管理員。';}
  else if(status===429){message='分析服務目前達到用量限制；已有結果會保留，請稍後再試。';}
  else if([408,504].includes(status)){message='分析服務回應逾時；已有結果會保留，請稍後再試。';}
  else if([500,502,503].includes(status)){message='分析服務暫時忙碌或連線中斷；請稍後再試。';}
  else if(status===400){message='分析服務未能讀取這個來源或要求。請稍後重試或使用同版本音訊。';}
  const e=new AppError(message,status===429?429:status===401?401:502,code);
  e.providerStatus=status;e.retryable=transient.has(status);e.shape=compatible.has(status);
  // Permanent account/source conditions must not be disguised as schema failures.
  if(/not found.*model|model.*not found|not supported.*model|private|unlisted|age.restrict|permission|policy|safety|not available.*country/i.test(text))e.shape=false;
  if(status===429&&/per.?day|daily|billing|credit|quota[^\n]*limit\s*[:=]?\s*0\b/i.test(text)){e.retryable=false;e.quotaPermanent=true;}
  e.retryAfter=retryAfterMs(retryAfter,body);return e;
}
function diagnostic(config,event){
  // Whitelist instead of redacting arbitrary provider text after the fact.
  const safe=Object.fromEntries(Object.entries(event).filter(([k])=>['event','kind','route','attempt','elapsedMs','status','code','phase','delayMs','bytes'].includes(k)));
  try{config.onDiagnostic?.(safe);}catch{}
}
export async function sleep(ms,signal){
  if(signal?.aborted)throw aborted(signal);
  if(ms<=0)return;
  await new Promise((resolve,reject)=>{const finish=e=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);e?reject(e):resolve();};const cancel=()=>finish(aborted(signal));const timer=setTimeout(finish,ms);signal?.addEventListener('abort',cancel,{once:true});});
}
export async function boundedRead(response,signal,maxBytes=6_000_000){
  if(!response.body){const e=new AppError('分析服務回傳空白內容。',502,'UPSTREAM_BODY');e.retryable=true;throw e;}
  const reader=response.body.getReader();let bytes=0,text='';const decoder=new TextDecoder();
  const cancel=()=>{reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  try{
    while(true){if(signal?.aborted)throw aborted(signal);const chunk=await reader.read();if(signal?.aborted)throw aborted(signal);if(chunk.done)break;bytes+=chunk.value.byteLength;
      if(bytes>maxBytes)throw new AppError('分析資料超過安全大小。',502,'RESPONSE_SIZE');text+=decoder.decode(chunk.value,{stream:true});}
    text+=decoder.decode();return {text,bytes};
  }finally{signal?.removeEventListener('abort',cancel);try{await reader.cancel();}catch{}reader.releaseLock();}
}
async function attempt(variant,config,parent,fetcher,ms){
  const controller=new AbortController();let phase='headers',timer,response;
  const cancel=()=>controller.abort(aborted(parent));parent?.addEventListener('abort',cancel,{once:true});if(parent?.aborted)cancel();
  const timeout=new AppError('分析服務回應逾時；請稍後再試。',504,'TIMEOUT');timeout.retryable=true;
  timer=setTimeout(()=>controller.abort(timeout),Math.max(1,ms));
  let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',rejectAbort,{once:true});if(controller.signal.aborted)rejectAbort();});
  try{
    return await Promise.race([interrupted,(async()=>{
      response=await fetcher(variant.url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':config.apiKey},body:JSON.stringify(variant.body),signal:controller.signal});
      if(controller.signal.aborted){try{await response.body?.cancel();}catch{}throw controller.signal.reason;}
      phase='body';const {text,bytes}=await boundedRead(response,controller.signal);let data;
      try{data=JSON.parse(text);}catch{if(!response.ok)throw classifyHttp(response.status,{},response.headers.get('retry-after'));const e=new AppError('分析服務的回應中途損毀，請稍後重試。',502,'UPSTREAM_BODY');e.retryable=true;throw e;}
      if(!response.ok)throw classifyHttp(response.status,data,response.headers.get('retry-after'));
      phase='decode';const value=variant.decode(data);return {value,bytes};
    })()]);
  }catch(error){
    if(parent?.aborted)throw aborted(parent);
    const e=controller.signal.aborted?controller.signal.reason:error;
    if(e instanceof AppError){e.phase=phase;throw e;}
    const cause=String(e?.cause?.code||e?.code||'');
    const timed=e?.name==='TimeoutError'||e?.name==='AbortError'||/TIMEOUT/.test(cause);
    const safe=new AppError(timed?'分析服務回應逾時；請稍後再試。':'工作室與分析服務的連線中斷；已有結果會保留。',timed?504:502,timed?'TIMEOUT':'NETWORK');safe.retryable=true;safe.phase=phase;throw safe;
  }finally{clearTimeout(timer);parent?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',rejectAbort);}
}
export async function providerRequest(variants,config,signal,fetcher,{kind='analyze',routeKey=kind}={}){
  const start=now(),budget=Number(config.passBudgetMs)||(kind==='fast-scan'?150000:90000);
  const deadline=Math.min(start+budget,Number(config.deadline)||Infinity);
  const runtime=config.providerRuntime||newProviderRuntime();
  const hint=runtime.routes.get(routeKey);const ordered=[...variants];
  if(hint&&hint.until>start){const i=ordered.findIndex(v=>v.name===hint.name);if(i>0)ordered.unshift(...ordered.splice(i,1));}
  let route=0,last;
  for(let n=0;n<4;n++){
    if(signal?.aborted)throw aborted(signal);
    const cooldown=Math.max(0,runtime.cooldownUntil-now());
    if(cooldown){if(now()+cooldown+10>=deadline){const e=last||new AppError('分析服務目前達到用量限制，請稍後再試。',429,'GEMINI_429');e.retryable=false;throw e;}await sleep(cooldown,signal);}
    const remaining=deadline-now();if(remaining<=0){throw last||new AppError('分析等候已達上限，請稍後再試。',504,'TIMEOUT');}
    const v=ordered[route],limit=Number(config.attemptTimeoutMs)||(kind==='fast-scan'?70000:45000);
    diagnostic(config,{event:'attempt',kind,route:v.name,attempt:n+1,elapsedMs:now()-start});
    try{
      const {value,bytes}=await attempt(v,config,signal,fetcher,Math.min(limit,remaining));
      runtime.routes.set(routeKey,{name:v.name,until:now()+10*60000});
      diagnostic(config,{event:'success',kind,route:v.name,attempt:n+1,elapsedMs:now()-start,bytes});return value;
    }catch(e){
      if(signal?.aborted)throw aborted(signal);last=e;
      diagnostic(config,{event:'failure',kind,route:v.name,attempt:n+1,elapsedMs:now()-start,status:e.providerStatus||e.status,code:e.code,phase:e.phase});
      if(e.shape&&route+1<ordered.length){route++;continue;}
      if(!e.retryable||n===3)throw e;
      const override=config.retryDelays?.[n];
      const delay=Number.isFinite(override)?Math.max(0,override):Math.round(1000*2**n*(.75+Math.random()*.5));
      const wait=Math.max(delay,e.retryAfter||0);
      if(e.providerStatus===429)runtime.cooldownUntil=Math.max(runtime.cooldownUntil,now()+wait);
      if(now()+wait+10>=deadline)throw e;
      diagnostic(config,{event:'backoff',kind,route:v.name,attempt:n+1,elapsedMs:now()-start,delayMs:wait});
      await sleep(wait,signal);
    }
  }
  throw last||new AppError('分析服務未能完成要求。',502,'PROVIDER');
}
