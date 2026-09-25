import {MAX_SONG_SECONDS,LISTENING_VERSION} from './listening-schema.mjs';
import {TECHNIQUES,ORNAMENTS,rangeFromPhrases} from './music.mjs';
const str={type:'string'},num={type:'number'},confidence={type:'string',enum:['low','medium','high']};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const array=items=>({type:'array',items});
export const tokenSchema=object({text:str,romanization:str,start:num,end:num,notes:array(num),technique:{type:'string',enum:Object.keys(TECHNIQUES)},ornaments:array({type:'string',enum:Object.keys(ORNAMENTS)}),confidence});
export const phraseSchema=object({start:num,end:num,section:str,tokens:array(tokenSchema),focus:str,instruction:str,pronunciation:str,exercise:str,caution:str});
export const analysisSchema=object({status:{type:'string',enum:['ok','unavailable']},reason:str,title:str,artist:str,language:{type:'string',enum:['cantonese','mandarin','mixed','unknown']},duration:num,key:str,tempo:{type:['number','null']},summary:str,warnings:array(str),phrases:array(phraseSchema)});
export const transcriptTokenSchema=object({text:str,romanization:str,start:num,end:num});
export const transcriptPhraseSchema=object({start:num,end:num,section:str,tokens:array(transcriptTokenSchema)});
export const transcriptSchema=object({status:{type:'string',enum:['ok','unavailable']},reason:str,title:str,artist:str,language:{type:'string',enum:['cantonese','mandarin','mixed','unknown']},duration:num,phrases:array(transcriptPhraseSchema)});

// Annotation output deliberately has NO timing fields. IDs refer to the frozen transcript.
export const teachingTokenSchema=object({id:str,text:str,notes:array(num),technique:{type:'string',enum:Object.keys(TECHNIQUES)},ornaments:array({type:'string',enum:Object.keys(ORNAMENTS)}),confidence});
export const teachingPhraseSchema=object({id:str,focus:str,instruction:str,pronunciation:str,exercise:str,caution:str,tokens:array(teachingTokenSchema)});
export const teachingSchema=object({status:{type:'string',enum:['ok','unavailable']},reason:str,key:str,tempo:{type:['number','null']},summary:str,warnings:array(str),phrases:array(teachingPhraseSchema)});

export const coachSchema=object({heard:str,focus:str,tryThis:str,pronunciation:str,caution:str,limitations:str});
function string(x,n=700){if(typeof x!=='string'||x.length>n)throw new Error('文字欄位格式不正確。');return x;}
function number(x,min,max){if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)throw new Error('時間或音高超出合理範圍。');return x;}
function list(x,max){if(!Array.isArray(x)||x.length>max)throw new Error('分析欄位長度不正確。');return x;}
export function normalizePhrase(p,duration=MAX_SONG_SECONDS){
  if(!p||typeof p!=='object')throw new Error('缺少樂句。');
  const start=number(p.start,0,duration),end=number(p.end,start+.001,duration+.25);
  let last=start-.25;
  const tokens=list(p.tokens,64).map(t=>{
    if(!t||typeof t!=='object')throw new Error('缺少歌詞字元。');
    const lineOnly=t.timingMode==='line'&&t.start===null&&t.end===null;
    const s=lineOnly?null:number(t.start,start-.2,end),e=lineOnly?null:number(t.end,s+.001,end+.2);
    if(!lineOnly){if(s<last-.15)throw new Error('歌詞時間順序不正確。');last=s;}
    if(!Object.hasOwn(TECHNIQUES,t.technique))throw new Error('唱法標記不正確。');
    const ornaments=list(t.ornaments,5).map(o=>{if(!Object.hasOwn(ORNAMENTS,o))throw new Error('裝飾音格式不正確。');return o;});
    const timing={};
    if(['word','line'].includes(t.timingMode))timing.timingMode=t.timingMode;
    if(['ai-agreement','ai-relistened','boundary-disputed','user-edited','first-pass','adaptive-reviewed'].includes(t.timingReview))timing.timingReview=t.timingReview;
    if(['low','medium','high'].includes(t.timingConfidence))timing.timingConfidence=t.timingConfidence;
    return {...timing,text:string(t.text,20),romanization:string(t.romanization,90),start:s,end:e,notes:list(t.notes,16).map(n=>number(n,24,108)),technique:t.technique,ornaments,annotationStatus:['reviewed','missing','unavailable','pending'].includes(t.annotationStatus)?t.annotationStatus:'legacy',confidence:['low','medium','high'].includes(t.confidence)?t.confidence:'low'};
  });
  if(!tokens.length)throw new Error('樂句沒有可用歌詞。');
  return {...(Number.isFinite(p.scanConfidence)?{scanConfidence:number(p.scanConfidence,0,1)}:{}),...(['first-pass','line-estimate','needs-review','reviewed','unverified','user-edited'].includes(p.timingStatus)?{timingStatus:p.timingStatus}:{}),start,end,section:string(p.section,40),tokens,focus:string(p.focus,160),instruction:string(p.instruction),pronunciation:string(p.pronunciation),exercise:string(p.exercise),caution:string(p.caution)};
}
export function normalizeAnalysis(raw){
  if(!raw||typeof raw!=='object')throw new Error('沒有收到可用分析。');
  if(raw.status==='unavailable')throw new Error(string(raw.reason,400)||'模型無法讀取這段音訊，請改用你有權使用的音訊檔。');
  if(raw.status!=='ok')throw new Error('分析狀態不正確。');
  const duration=number(raw.duration,.1,MAX_SONG_SECONDS);
  const phrases=list(raw.phrases,600).map(p=>normalizePhrase(p,duration)).sort((a,b)=>a.start-b.start);
  const unalignedLyrics=raw.unalignedLyrics===undefined?[]:list(raw.unalignedLyrics,600).map(s=>string(s,1280));
  if(!phrases.length&&!unalignedLyrics.length)throw new Error('沒有辨識出可教學的人聲歌詞。');
  if(phrases.reduce((n,p)=>n+p.tokens.length,0)>8000)throw new Error('歌詞超過此版本的處理上限。');
  if(!['cantonese','mandarin','mixed','unknown'].includes(raw.language))throw new Error('語言格式不正確。');
  return {...(raw.adaptive?{adaptive:adaptiveSummary(raw.adaptive)}:{}),...(raw.firstScanRange?{firstScanRange:scanRange(raw.firstScanRange)}:{}),...(raw.listening?{listening:listeningSummary(raw.listening)}:{}),status:'ok',reason:'',title:string(raw.title,160)||'未命名歌曲',artist:string(raw.artist,160),language:raw.language,duration,key:string(raw.key,50),tempo:raw.tempo===null?null:number(raw.tempo,20,300),summary:string(raw.summary),warnings:list(raw.warnings,12).map(w=>string(w,400)),phrases,unalignedLyrics,dataQuality:qualitySummary(raw.dataQuality),range:rangeFromPhrases(phrases),teachingCoverage:{total:phrases.reduce((n,p)=>n+p.tokens.length,0),identified:phrases.reduce((n,p)=>n+p.tokens.filter(t=>t.technique!=='unknown').length,0),unknown:phrases.reduce((n,p)=>n+p.tokens.filter(t=>t.technique==='unknown').length,0),reviewed:phrases.reduce((n,p)=>n+p.tokens.filter(t=>t.annotationStatus==='reviewed').length,0),missing:phrases.reduce((n,p)=>n+p.tokens.filter(t=>['missing','unavailable'].includes(t.annotationStatus)).length,0)}};
}
export function normalizeCoach(raw){return Object.fromEntries(Object.keys(coachSchema.properties).map(k=>[k,string(raw?.[k],1000)]));}

function qualitySummary(raw){
  if(!raw||typeof raw!=='object')return null;
  const out={version:1,mode:raw.mode==='partial'?'partial':'complete'};
  for(const k of ['normalizedFields','omittedNotes','unknownPitchTokens','untimedTokens','timedTokens','croppedTokens','reorderedGroups'])out[k]=Number.isInteger(raw[k])&&raw[k]>=0&&raw[k]<=100000?raw[k]:0;
  return out;
}

function listeningSummary(raw){
  if(!raw||raw.version!==LISTENING_VERSION)throw new Error('聆聽版本格式不正確。');
  const result={version:LISTENING_VERSION,accuracyVerified:false};
  for(const key of ['windowSeconds','contextSeconds','windows','reviewedWindows','relistenedWindows','wordTimed','lineOnly','mergedOverlapWords','boundaryDisagreements'])result[key]=number(raw[key],0,100000);
  return result;
}

function scanRange(r){return {low:number(r.low,24,108),high:number(r.high,r.low,108),typicalLow:null,typicalHigh:null};}
function adaptiveSummary(raw){
 if(!['adaptive-recording-v1','adaptive-recording-v2'].includes(raw.version))throw new Error('精修資料版本不正確。');
 const out={version:raw.version,state:['refining','complete','partial','cancelled'].includes(raw.state)?raw.state:'partial',completeScan:raw.completeScan===true,accuracyVerified:false};
 for(const k of ['revision','totalTasks','completedTasks','acceptedLines','selectedLines','deferredLines','reviewedLines','deepReviews','failedTasks','completedTeachingBatches','totalTeachingBatches','firstResultMs','finishedMs','calls'])out[k]=Number.isFinite(raw[k])?number(raw[k],0,100000000):0;
 return out;
}
