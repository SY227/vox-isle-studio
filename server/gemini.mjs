import {analyzeAdaptive} from './adaptive.mjs';
import {fastScanSchema,lightTeachingSchema,lessonSchema} from '../shared/adaptive-schema.mjs';
import {fastScanPrompt,lightTeachingPrompt,lessonPrompt} from './adaptive-prompts.mjs';
import {analyzeByListening,sliceWave} from './listening.mjs';
import {surveySchema,listeningSchema} from '../shared/listening-schema.mjs';
import {surveyPrompt,listeningPrompt,LISTENING_SYSTEM} from './listening-prompts.mjs';
import {normalizeTeachingBatch} from '../shared/annotations.mjs';
import {annotateTranscript} from './teaching.mjs';
import {recoverAnalysis} from '../shared/recovery.mjs';
import {rangeFromPhrases} from '../shared/music.mjs';
import {AppError} from './validation.mjs';
import {analysisPrompt,transcriptPrompt,teachingPrompt,coachPrompt,TEACHER_SYSTEM} from './prompts.mjs';
import {analysisSchema,transcriptSchema,teachingSchema,coachSchema,normalizeAnalysis,normalizeCoach} from '../shared/schema.mjs';

const LEGACY_API='https://generativelanguage.googleapis.com/v1beta';
const INTERACTIONS_API='https://generativelanguage.googleapis.com/v1beta/interactions';

const listeningKinds=new Set(['survey','listen','listen-review','listen-resolve']);
const schemaFor=kind=>kind==='fast-scan'?fastScanSchema:kind==='light-teaching'?lightTeachingSchema:kind==='lesson'?lessonSchema:kind==='survey'?surveySchema:kind.startsWith('listen')?listeningSchema:kind==='coach'?coachSchema:kind==='transcript'?transcriptSchema:kind==='teaching'?teachingSchema:analysisSchema;
const promptFor=(input,kind)=>kind==='fast-scan'?fastScanPrompt(input):kind==='light-teaching'?lightTeachingPrompt(input):kind==='lesson'?lessonPrompt(input):kind==='survey'?surveyPrompt(input):kind.startsWith('listen')?listeningPrompt(input,kind):kind==='coach'?coachPrompt(input):kind==='transcript'?transcriptPrompt(input):kind==='teaching'?teachingPrompt(input):analysisPrompt(input);

export function modelName(config){
  if(!/^gemini-[a-z0-9.\-]+$/.test(config.model))throw new AppError('AI 服務設定格式不正確。',500,'MODEL_CONFIG');
  return config.model;
}

/** Legacy compatibility transport. A requested listening clip is NEVER removed. */
function promptInputForTransport(input,windowMode='clip'){
  // Local WAV windows are physically sliced. YouTube normally uses provider-side
  // static clipping. If that preview path rejects a particular video, fall back to
  // agentic navigation over the canonical full source and require absolute times.
  return input.source==='youtube'&&input.listeningWindow&&windowMode==='source-target'
    ? {...input,youtubeWindowMode:'source-target'}
    : input;
}

export function requestBody(input,kind='analyze',{structured=true}={}){
  // GenerateContent is only a compatibility path for YouTube, so do not attach
  // preview-only clipping metadata. Target the absolute source window in the prompt.
  const promptInput=promptInputForTransport(input,input.source==='youtube'?'source-target':'clip');
  const media=input.source==='youtube'
    ? {fileData:{fileUri:input.url,mimeType:'video/*'}}
    : {inlineData:{mimeType:'audio/wav',data:input.listeningWindow?sliceWave(input.audioData,input.listeningWindow):input.audioData}};
  const generationConfig={
    maxOutputTokens:kind==='fast-scan'?49152:kind==='light-teaching'?12288:kind==='lesson'?2048:kind==='survey'?2048:kind.startsWith('listen')?16384:kind==='coach'?4096:kind==='transcript'?32768:kind==='teaching'?16384:49152,
    thinkingConfig:{thinkingLevel:'LOW'},
    responseMimeType:'application/json'
  };
  // GenerateContent uses responseMimeType / responseJsonSchema. v1.1.0
  // accidentally sent the Interactions responseFormat shape on this fallback.
  if(structured)generationConfig.responseJsonSchema=schemaFor(kind);
  return {
    systemInstruction:{parts:[{text:listeningKinds.has(kind)?LISTENING_SYSTEM:TEACHER_SYSTEM}]},
    contents:[{role:'user',parts:[media,{text:promptFor(promptInput,kind)}]}],
    generationConfig
  };
}

/** Current Interactions API body. Preferred YouTube transport. */
export function interactionsBody(input,kind='analyze',model='gemini-3.8-flash',{structured=true,windowMode='clip'}={}){
  if(input.source!=='youtube')throw new AppError('Interactions YouTube 路徑只接受 YouTube 來源。',500,'INTERACTIONS_SOURCE');
  const promptInput=promptInputForTransport(input,windowMode);
  const video={type:'video',uri:input.url};
  if(input.listeningWindow){
    if(windowMode==='clip'){
      // The current API reference specifies offsets as duration strings ("10.5s").
      // Keeping a short static audio window gives the timing pass the strongest signal.
      video.processing={type:'static',start_offset:`${input.listeningWindow.clipStart}s`,end_offset:`${input.listeningWindow.clipEnd}s`};
    }else{
      // Official fallback when URL clipping is rejected for an otherwise-readable video.
      video.processing='agentic';
    }
  }
  const body={
    model,
    input:[video,{type:'text',text:promptFor(promptInput,kind)}],
    system_instruction:listeningKinds.has(kind)?LISTENING_SYSTEM:TEACHER_SYSTEM,
    generation_config:{
      max_output_tokens:kind==='fast-scan'?49152:kind==='light-teaching'?12288:kind==='lesson'?2048:kind==='survey'?2048:kind.startsWith('listen')?16384:kind==='coach'?4096:kind==='transcript'?32768:kind==='teaching'?16384:49152,
      thinking_level:'low'
    },
    store:false
  };
  if(structured)body.response_format={type:'text',mime_type:'application/json',schema:schemaFor(kind)};
  return body;
}

function providerMessage(status,isYouTube=false){
  const messages={
    400:isYouTube
      ? 'Google 的 YouTube 來源介面目前拒絕讀取這支影片。聲嶼已完成自動相容嘗試；即使影片公開，YouTube URL 功能仍屬 preview，個別影片仍可能不可用。可稍後重試或改用同一版本音訊檔。'
      : 'AI 服務無法處理這個來源或要求。請確認音訊格式及內容。',
    401:'分析服務目前無法驗證連線，請稍後再試。',
    403:isYouTube
      ? 'Google 拒絕讀取這個 YouTube 來源。這可能是來源政策、年齡／地區／帳號限制，或 preview 功能對個別影片的限制；公開狀態本身不保證一定可讀。'
      : '分析服務目前無法存取此來源，請稍後再試。',
    404:'MODEL_NOT_FOUND',
    429:'分析服務目前用量較高，請稍後再試。',
    500:'AI 服務暫時無法完成分析。',
    503:'AI 服務忙碌，請稍後重試。'
  };
  return messages[status]||`Google 回傳錯誤 (${status})。`;
}

const RETRYABLE_PROVIDER_STATUS=new Set([408,425,429,500,502,503,504]);
const retryDelay=(config,index)=>Array.isArray(config.retryDelays)&&Number.isFinite(config.retryDelays[index])?Math.max(0,config.retryDelays[index]):[350,900,1800][index];
function providerAbort(signal){return signal?.reason?.name==='TimeoutError'?new AppError('AI 服務回應逾時，請稍後重試或改用較短音訊。',504,'TIMEOUT'):new AppError('分析已取消。',499,'CANCELLED');}
async function pauseRetry(ms,signal){
  if(!ms){if(signal?.aborted)throw providerAbort(signal);return;}
  await new Promise((resolve,reject)=>{let done=false;const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};const abort=()=>finish(providerAbort(signal));const timer=setTimeout(()=>finish(),ms);if(signal){if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});}});
}
async function postJson(url,body,config,signal,fetcher){
  let lastResponse,lastError;
  for(let attempt=0;attempt<4;attempt++){
    if(signal?.aborted)throw providerAbort(signal);
    try{
      const attemptTimeout=Math.min(Number(config.timeout)||180000,75000);
      const signals=[signal,AbortSignal.timeout(attemptTimeout)].filter(Boolean);
      const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':config.apiKey},body:JSON.stringify(body),signal:AbortSignal.any(signals)});
      lastResponse=response;
      if(response.ok||!RETRYABLE_PROVIDER_STATUS.has(response.status)||attempt===3)return response;
      try{await response.body?.cancel?.();}catch{}
    }catch(e){
      if(signal?.aborted)throw providerAbort(signal);
      const timeout=e?.name==='TimeoutError'||e?.name==='AbortError';
      lastError=new AppError(timeout?'AI 服務回應逾時，請稍後重試或改用較短音訊。':'無法連接 Google。請檢查網路連線。',timeout?504:502,timeout?'TIMEOUT':'NETWORK');
      if(attempt===3)throw lastError;
    }
    // Silent resilience: three internal retries after the first failed attempt.
    // No retry packet is emitted to the browser, so users only see the normal analysis state.
    await pauseRetry(retryDelay(config,attempt),signal);
  }
  if(lastResponse)return lastResponse;
  throw lastError||new AppError('無法連接 Google。請檢查網路連線。',502,'NETWORK');
}

function parseLegacy(data){
  const candidate=data.candidates?.[0];
  if(candidate?.finishReason==='MAX_TOKENS')throw new AppError('分析輸出被長度上限截斷。請使用較短版本；本次不會顯示不完整結果。',502,'TRUNCATED');
  const text=(candidate?.content?.parts||[]).filter(p=>p.text&&!p.thought).map(p=>p.text).join('');
  return {
    text,
    usage:data.usageMetadata?{inputTokens:data.usageMetadata.promptTokenCount,outputTokens:data.usageMetadata.candidatesTokenCount}:undefined
  };
}

function parseInteraction(data){
  if(data.status==='incomplete')throw new AppError('分析輸出被長度上限截斷。請使用較短版本；本次不會顯示不完整結果。',502,'TRUNCATED');
  if(data.status && !['completed','complete'].includes(data.status))throw new AppError('AI 分析未完成，已停止顯示不完整結果。',502,'INTERACTION_INCOMPLETE');
  const text=typeof data.output_text==='string' ? data.output_text : (data.steps||[])
    .filter(step=>step?.type==='model_output')
    .flatMap(step=>Array.isArray(step.content)?step.content:[])
    .filter(part=>part?.type==='text'&&typeof part.text==='string')
    .map(part=>part.text)
    .join('');
  return {
    text,
    usage:data.usage?{inputTokens:data.usage.total_input_tokens,outputTokens:data.usage.total_output_tokens}:undefined
  };
}

function normalizeProviderText(text,kind,config,usage,transport,input={},onProgress=()=>{}){
  if(!text)throw new AppError('AI 服務沒有傳回可用內容，來源可能無法讀取或受到限制。',502,'EMPTY_RESPONSE');
  try{
    if(!['teaching','light-teaching','lesson','fast-scan'].includes(kind)&&!listeningKinds.has(kind))onProgress({phase:'normalizing',message:'已收到分析，正在整理歌詞時間與檢查音符…'});
    const clean=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    const raw=JSON.parse(clean);
    if(listeningKinds.has(kind)||kind==='fast-scan')return {raw,usage,transport};
    if(kind==='lesson'){const lesson={};for(const key of Object.keys(lessonSchema.properties))lesson[key]=typeof raw[key]==='string'?raw[key].slice(0,key==='focus'?160:700):'';return {...lesson,usage};}
    if(kind==='teaching'||kind==='light-teaching')return {...normalizeTeachingBatch(raw,input.teachingBatch),usage};
    if(raw.status==='unavailable')throw new AppError('來源尚未能可靠分析：'+String(raw.reason||'未取得可用歌聲。').slice(0,300).replace(/gemini(?:-[a-z0-9.-]+)?/ig,'AI 服務'),502,'SOURCE_UNAVAILABLE');
    const normalized=kind==='coach'?normalizeCoach(raw):kind==='transcript'?recoverAnalysis({
      status:'ok',reason:'',title:raw.title||'未命名歌曲',artist:raw.artist||'',
      language:['cantonese','mandarin','mixed','unknown'].includes(raw.language)?raw.language:'unknown',
      duration:raw.duration||360,key:'待確認',tempo:null,summary:'完整歌詞時間軸',
      warnings:['完整歌詞時間軸優先保留文字與時間；未加入音高或唱法時會顯示待確認。'],
      phrases:(Array.isArray(raw.phrases)?raw.phrases:[]).map(p=>({
        ...p,focus:'先跟著原片熟悉這一句。',instruction:'唱法建議待補充。',pronunciation:'',exercise:'先用舒服的聲量跟唱。',caution:'不適時停止。',
        tokens:(Array.isArray(p.tokens)?p.tokens:[]).map(t=>({...t,notes:[],technique:'unknown',ornaments:[],confidence:'low'}))
      }))
    },{sourceDuration:input.duration}):recoverAnalysis(raw,{sourceDuration:input.duration});
    return {
      ...normalized,
      provenance:{
        kind:'ai-estimate',
        model:config.model,
        createdAt:new Date().toISOString(),
        timing:'AI-estimated; not forced alignment',
        register:'Pedagogical suggestion; not identified physiology',
        transport
      },
      usage
    };
  }catch(e){
    if(e instanceof AppError)throw e;
    throw new AppError(`這次回傳的分析格式無法讀取：${String(e.message).slice(0,200)} 請重試；這不代表你的音訊不清晰。`,502,'INVALID_ANALYSIS');
  }
}


const SHAPE_FALLBACK_STATUS=new Set([400,404,405,422,501]);
async function providerDebug(response,label){
  if(process.env.VOX_DEBUG_PROVIDER!=='1')return;
  try{const body=await response.clone().json();console.warn(`[VOX provider] ${label} ${response.status}`,String(body?.error?.message||body?.message||'').slice(0,500));}catch{console.warn(`[VOX provider] ${label} ${response.status}`);}
}
function finishProviderError(response){
  const message=providerMessage(response.status,true);
  if(message==='MODEL_NOT_FOUND')throw new AppError('目前服務暫時無法使用。',404,'GEMINI_404');
  throw new AppError(message,response.status===429?429:502,'GEMINI_'+response.status);
}
async function interactionAttempt(input,kind,model,config,signal,fetcher,onProgress,options,label){
  const response=await postJson(INTERACTIONS_API,interactionsBody(input,kind,model,options),config,signal,fetcher);
  if(response.ok){const parsed=parseInteraction(await response.json());return {ok:true,value:normalizeProviderText(parsed.text,kind,config,parsed.usage,label,input,onProgress)};}
  await providerDebug(response,label);return {ok:false,response};
}

async function generateYouTubePass(input,kind,config,signal,fetcher,onProgress){
  const model=modelName(config);
  // 1) Official direct YouTube input with structured output. For listening windows,
  // use static provider-side clipping with duration-string offsets.
  let step=await interactionAttempt(input,kind,model,config,signal,fetcher,onProgress,{structured:true,windowMode:'clip'},`interactions-youtube-${kind}`);
  if(step.ok)return step.value;
  let response=step.response;
  if(!SHAPE_FALLBACK_STATUS.has(response.status))finishProviderError(response);

  // 2) Some public videos reject preview clipping even though the URL itself is
  // readable. Keep the full canonical source and let agentic video navigation inspect
  // only the requested absolute source-time window.
  if(input.listeningWindow){
    step=await interactionAttempt(input,kind,model,config,signal,fetcher,onProgress,{structured:true,windowMode:'source-target'},`interactions-youtube-agentic-${kind}`);
    if(step.ok)return step.value;
    response=step.response;
    if(!SHAPE_FALLBACK_STATUS.has(response.status))finishProviderError(response);
  }

  // 3) Retry Interactions without schema enforcement. The prompt still requests JSON,
  // and the normal parser/validator remains authoritative.
  step=await interactionAttempt(input,kind,model,config,signal,fetcher,onProgress,{structured:false,windowMode:input.listeningWindow?'source-target':'clip'},`interactions-youtube-json-${kind}`);
  if(step.ok)return step.value;
  response=step.response;
  if(!SHAPE_FALLBACK_STATUS.has(response.status))finishProviderError(response);

  // 4) GenerateContent compatibility route using its actual structured-output field
  // names. This is the bug that made v1.1.0's advertised fallback return HTTP 400.
  response=await postJson(`${LEGACY_API}/models/${model}:generateContent`,requestBody(input,kind),config,signal,fetcher);
  if(response.ok){const parsed=parseLegacy(await response.json());return normalizeProviderText(parsed.text,kind,config,parsed.usage,`generateContent-youtube-${kind}`,input,onProgress);}
  await providerDebug(response,'generateContent-structured');
  if(!SHAPE_FALLBACK_STATUS.has(response.status))finishProviderError(response);

  // 5) Last official compatibility attempt: JSON MIME without schema.
  response=await postJson(`${LEGACY_API}/models/${model}:generateContent`,requestBody(input,kind,{structured:false}),config,signal,fetcher);
  if(response.ok){const parsed=parseLegacy(await response.json());return normalizeProviderText(parsed.text,kind,config,parsed.usage,`generateContent-youtube-json-${kind}`,input,onProgress);}
  await providerDebug(response,'generateContent-json');
  finishProviderError(response);
}

/** A single call; the coordinator attaches audio again for EVERY review. */
async function generatePassUnqueued(input,kind,config,signal,fetcher,onProgress=()=>{}){
  if(input.source==='youtube')return generateYouTubePass(input,kind,config,signal,fetcher,onProgress);
  const response=await postJson(`${LEGACY_API}/models/${modelName(config)}:generateContent`,requestBody(input,kind),config,signal,fetcher);
  if(!response.ok){
    const message=providerMessage(response.status,false);
    if(message==='MODEL_NOT_FOUND')throw new AppError('分析服務暫時無法使用，請稍後再試。',404,'GEMINI_404');
    throw new AppError(message,response.status===429?429:502,'GEMINI_'+response.status);
  }
  const parsed=parseLegacy(await response.json());
  return normalizeProviderText(parsed.text,kind,config,parsed.usage,'generateContent',input,onProgress);
}
async function generatePass(input,kind,config,signal,fetcher,onProgress=()=>{}){
  const task=()=>generatePassUnqueued(input,kind,config,signal,fetcher,onProgress);
  return config.providerQueue?config.providerQueue.run(task,signal):task();
}
export async function generate(input,kind,config,signal,fetcher=fetch,onProgress=()=>{}){
  signal=AbortSignal.any([signal,AbortSignal.timeout(config.timeout||900000)].filter(Boolean));
  if(!config.apiKey)throw new AppError('分析服務目前未就緒，請稍後再試。',503,'NO_API_KEY');
  if(kind!=='analyze')return generatePass(input,kind,config,signal,fetcher,onProgress);
  const result=await analyzeAdaptive(input,
    (recording,passKind,passSignal)=>generatePass(recording,passKind,config,passSignal,fetcher),
    {signal,onProgress,concurrency:config.adaptiveConcurrency||3,maxReviews:12});
  result.provenance.model=config.model;
  return result;
}

export async function checkModel(config,fetcher=fetch){
  if(!config.apiKey)throw new AppError('分析服務目前未就緒。',503,'NO_API_KEY');
  const r=await fetcher(`${LEGACY_API}/models/${modelName(config)}`,{headers:{'x-goog-api-key':config.apiKey},signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new AppError(`AI 連線檢查失敗 (${r.status})。請檢查金鑰、帳務及服務權限。`,502,'MODEL_CHECK');
  const info=await r.json();return {ok:true,model:config.model,displayName:info.displayName||config.model,generateContent:info.supportedGenerationMethods?.includes('generateContent')??null};
}
