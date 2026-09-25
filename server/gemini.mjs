import {providerRequest,newProviderRuntime} from './provider-client.mjs';
import {normalizeWordDetails} from './word-details.mjs';
import {analyzeAdaptive,normalizeFastScan} from './adaptive.mjs';
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
  // static inspection of the canonical full source and require absolute times.
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
    maxOutputTokens:kind==='fast-scan'?12288:kind==='light-teaching'?12288:kind==='lesson'?2048:kind==='survey'?2048:kind.startsWith('listen')?16384:kind==='coach'?4096:kind==='transcript'?32768:kind==='teaching'?16384:49152,
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
      video.processing='static';
    }
  }
  const body={
    model,
    input:[video,{type:'text',text:promptFor(promptInput,kind)}],
    system_instruction:listeningKinds.has(kind)?LISTENING_SYSTEM:TEACHER_SYSTEM,
    generation_config:{
      max_output_tokens:kind==='fast-scan'?12288:kind==='light-teaching'?12288:kind==='lesson'?2048:kind==='survey'?2048:kind.startsWith('listen')?16384:kind==='coach'?4096:kind==='transcript'?32768:kind==='teaching'?16384:49152,
      thinking_level:'low'
    },
    store:false
  };
  if(structured)body.response_format={type:'text',mime_type:'application/json',schema:schemaFor(kind)};
  return body;
}

function parseLegacy(data){
  const candidate=data.candidates?.[0];
  if(candidate?.finishReason==='MAX_TOKENS')throw new AppError('分析輸出被長度上限截斷。請使用較短版本；本次不會顯示不完整結果。',502,'TRUNCATED');
  if(candidate?.finishReason&&['SAFETY','RECITATION','PROHIBITED_CONTENT','BLOCKLIST'].includes(candidate.finishReason)||data.promptFeedback?.blockReason)throw new AppError('分析服務未能提供這個來源的分析。',422,'SOURCE_POLICY');
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
    if(kind==='teaching'||kind==='light-teaching')return {...normalizeTeachingBatch(raw,input.teachingBatch),...(kind==='light-teaching'?{wordDetails:normalizeWordDetails(raw,input.teachingBatch,input.listeningWindow)}:{}),usage};
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


/** One operation, at most four attempts total (including compatibility variants). */
async function generatePassUnqueued(input,kind,config,signal,fetcher,onProgress=()=>{}){
  const model=modelName(config);
  const decode=(transport,interaction)=>data=>{
    const parsed=interaction?parseInteraction(data):parseLegacy(data);
    return normalizeProviderText(parsed.text,kind,config,parsed.usage,transport,input,onProgress);
  };
  const legacy=(structured=true)=>({name:`generateContent-${structured?'structured':'json'}`,
    url:`${LEGACY_API}/models/${model}:generateContent`,body:requestBody(input,kind,{structured}),
    decode:decode(input.source==='youtube'?`generateContent-youtube-${kind}`:'generateContent',false)});
  let variants;
  if(input.source==='youtube'){
    const inter=(structured,windowMode,name)=>({name,url:INTERACTIONS_API,
      body:interactionsBody(input,kind,model,{structured,windowMode}),decode:decode(`interactions-youtube-${kind}`,true)});
    variants=[inter(true,'clip','interactions-structured'),
      inter(false,input.listeningWindow?'source-target':'clip','interactions-json'),legacy(true),legacy(false)];
  }else variants=[legacy(true),legacy(false)];
  return providerRequest(variants,config,signal,fetcher,{kind,routeKey:`${input.source}:${input.listeningWindow?'window':'whole'}`});
}
async function generatePass(input,kind,config,signal,fetcher,onProgress=()=>{}){
  const cache=config.providerRuntime?.scans;
  const key=kind==='fast-scan'&&input.source==='youtube'?`${config.model}:${input.id||input.url}:${input.language}:compact-v2`:null;
  const saved=key&&cache?.get(key);
  if(saved&&saved.until>Date.now()){
    if(signal?.aborted)throw signal.reason;
    config.onDiagnostic?.({event:'cache-hit',kind,elapsedMs:0});
    return {...structuredClone(saved.value),usage:undefined};
  }
  const task=async()=>{
    const result=await generatePassUnqueued(input,kind,config,signal,fetcher,onProgress);
    if(key&&cache&&result.raw?.complete===true){
      try{normalizeFastScan(result.raw,input);cache.set(key,{until:Date.now()+10*60000,value:structuredClone(result)});
        while(cache.size>8)cache.delete(cache.keys().next().value);
      }catch{}
    }
    return result;
  };
  return config.providerQueue?config.providerQueue.run(task,signal):task();
}
export async function generate(input,kind,config,signal,fetcher=fetch,onProgress=()=>{}){
  config={...config,providerRuntime:config.providerRuntime||newProviderRuntime()};
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
