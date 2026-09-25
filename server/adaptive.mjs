import {VocalIntelligenceSession} from './vocal-intelligence.mjs';
import {vocalCoverage} from '../shared/vocal-intelligence.mjs';
import {applyWordDetails} from './word-details.mjs';
/** Fast recording-first transcript, then bounded, non-blocking enrichment.
 * No compulsory blind pass; no synthetic word timing. A later failed task cannot
 * invalidate a delivered transcript. AI confidence is only a scheduling signal.
 */
import {normalizeAnalysis,normalizePhrase} from '../shared/schema.mjs';
import {seconds,midi} from '../shared/recovery.mjs';
import {buildTeachingBatches,missingTeachingBatch,applyTeachingBatches,settleTeachingBatch} from '../shared/annotations.mjs';
import {ADAPTIVE_VERSION} from '../shared/adaptive-schema.mjs';
import {normalizeListening,orderedMatches,wordKey} from './listening.mjs';
import {AppError} from './validation.mjs';
const finite=Number.isFinite;
const clean=(s,max=700)=>typeof s==='string'?s.slice(0,max):'';
const units=s=>s.match(/□|[\p{Script=Han}]|[A-Za-z]+(?:['’\-][A-Za-z]+)*|[0-9]+|[^\s\p{P}\p{S}]/gu)||[];
const abort=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Cancelled','AbortError');};
const fatal=e=>['GEMINI_401','GEMINI_402','GEMINI_403','GEMINI_404','SOURCE_POLICY','NO_API_KEY','MODEL_CONFIG'].includes(e?.code)||e?.quotaPermanent;
const stamp=()=>new Date().toISOString();

export function normalizeFastScan(raw,input={}){
  if(raw?.status==='unavailable')throw new AppError('目前未能聆聽這個來源，請重試或使用音訊檔。',502,'SOURCE_UNAVAILABLE');
  if(raw?.status!=='ok'||!Array.isArray(raw.phrases))throw new AppError('未取得可用歌詞，請重試。',502,'SCAN_FORMAT');
  const duration=finite(input.duration)?input.duration:seconds(raw.duration);
  if(!finite(duration)||duration<0.3||duration>900)throw new AppError('請使用最長15分鐘的單首歌曲；沒有截斷後半首。',502,'SONG_DURATION');
  if(raw.phrases.length>600)throw new AppError('樂句數超過支援範圍，沒有靜默截斷。',502,'SCAN_FORMAT');
  const phrases=[],unalignedLyrics=[];let count=0;
  for(const line of raw.phrases){
    const lineOnly=!Array.isArray(line?.words)&&!Array.isArray(line?.tokens);
    const words=Array.isArray(line?.words)?line.words:Array.isArray(line?.tokens)?line.tokens:[];
    const text=clean(line?.text,1280)||words.map(w=>clean(w?.text,40)).join('');
    const expected=units(text);if(!expected.length)continue;
    if((count+=expected.length)>8000)throw new AppError('歌詞超過支援範圍，沒有截斷顯示。',502,'SCAN_FORMAT');
    let start=seconds(line.start),end=seconds(line.end);
    if(!finite(start)||!finite(end)||start<0||end<=start||end>duration+0.25){unalignedLyrics.push(text);continue;}
    let issues=0,previous=start;
    const observed=words.flatMap(w=>{const parts=units(clean(w?.text,40));return parts.map(t=>({text:t,romanization:parts.length===1?clean(w.romanization,90):'',start:parts.length===1?seconds(w.start):null,end:parts.length===1?seconds(w.end):null}));});
    if(observed.length>1200)throw new AppError('樂句文字格式異常。',502,'SCAN_FORMAT');
    const matches=new Map(orderedMatches(expected,observed,(a,b)=>wordKey(a)===wordKey(b.text)?1:0));
    const tokens=expected.map((text,i)=>{
      const w=observed[matches.get(i)]||{romanization:'',start:null,end:null};
      const valid=finite(w.start)&&finite(w.end)&&w.start>=start&&w.end>w.start&&w.end<=end&&w.start>=previous;
      if(valid)previous=w.start;else issues++;
      return {text,romanization:w.romanization,start:valid?w.start:null,end:valid?w.end:null,
        timingMode:valid?'word':'line',timingReview:'first-pass',timingConfidence:'low',notes:[],technique:'unknown',ornaments:[],confidence:'low',annotationStatus:'pending'};
    });
    const score=finite(line.confidence)?Math.max(0,Math.min(1,line.confidence)):0.5;
    // Long malformed phrases are retained as text, never truncated to 64 words.
    if(tokens.length>64){unalignedLyrics.push(text);continue;}
    const confidence=issues&&!lineOnly?Math.min(score,0.6):score;
    tokens.forEach(t=>{t.timingConfidence=confidence>=0.85?'high':confidence>=0.65?'medium':'low';});
    phrases.push({start,end,section:clean(line.section,40)||'樂句',tokens,scanConfidence:confidence,
      timingStatus:lineOnly?'line-estimate':issues?'needs-review':'first-pass',focus:'先跟著原聲熟悉這句。',instruction:'唱法標記會逐步補上。點選一句，可取得詳細教學。',
      pronunciation:'',exercise:'用舒服的聲量跟唱。',caution:'不適時停止。'});
  }
  const low=midi(raw.pitchLow),high=midi(raw.pitchHigh);
  const firstScanRange=low!==null&&high!==null&&high>=low?{low,high,typicalLow:null,typicalHigh:null}:null;
  const a=normalizeAnalysis({status:'ok',reason:'',title:clean(raw.title,160)||'未命名歌曲',artist:clean(raw.artist,160),duration,
    language:['cantonese','mandarin','mixed','unknown'].includes(raw.language)?raw.language:'unknown',key:'待確認',tempo:null,
    summary:'先跟著原聲練習，細節逐步補上。',phrases,unalignedLyrics,firstScanRange,
    warnings:['歌詞與時間為原聲首輪AI估計；可信度只供安排複核，不是準確率。',...(raw.complete!==true?['首輪未確認涵蓋完整錄音，以下顯示目前聽辨結果，不代表全部歌詞。']:[])],
    adaptive:{version:ADAPTIVE_VERSION,state:'refining',revision:0,completeScan:raw.complete===true,accuracyVerified:false}});
  return {...a,provenance:{kind:'ai-estimate',pipeline:ADAPTIVE_VERSION,transport:'recording-first-adaptive',createdAt:stamp(),timing:'provisional AI estimate; selective review is not measured accuracy'}};
}

export function planTimingReview(a,{maxReviews=12,reviewFraction=0.3}={}){
  const candidates=[];
  a.phrases.forEach((p,i)=>{
    const reasons=[];let score=p.scanConfidence??0.5;
    if(p.timingStatus!=='line-estimate'&&p.tokens.some(t=>!finite(t.start)))reasons.push('missing-word-boundary');
    if(p.tokens.some(t=>t.text==='□'))reasons.push('unclear-text');
    if(p.end-p.start>16)reasons.push('long-line');
    if(i&&p.start<a.phrases[i-1].end-0.25)reasons.push('overlapping-lines');
    if(reasons.length)score=Math.min(score,0.6);
    if(score<0.85)candidates.push({index:i,score,reasons,level:score<0.65?'low':'medium'});
  });
  const limit=Math.min(maxReviews,Math.max(1,Math.ceil(a.phrases.length*reviewFraction)));
  candidates.sort((a,b)=>a.score-b.score||a.index-b.index);
  return {selected:candidates.slice(0,limit),deferred:candidates.slice(limit),accepted:a.phrases.length-candidates.length};
}
export function phraseWindow(a,index){
  const p=a.phrases[index];return {id:`adaptive-p${index}`,coreStart:p.start,coreEnd:p.end,clipStart:Math.max(0,p.start-2),clipEnd:Math.min(a.duration,p.end+2)};
}
function reviewCandidate(raw,a,index,window){
  const heard=normalizeListening(raw,window),original=a.phrases[index];
  // Exact ordered text and occurrence window, not a fuzzy match to a later chorus.
  const expected=wordKey(original.tokens.map(t=>t.text).join(''));
  let candidate;
  for(let start=0;start<heard.lines.length;start++){
    let combined='';
    for(let end=start;end<heard.lines.length;end++){
      combined+=wordKey(heard.lines[end].text);
      if(combined===expected){const lines=heard.lines.slice(start,end+1),tokens=lines.flatMap(l=>l.tokens);
        if(!lines.every(l=>finite(l.start)&&finite(l.end)))break;
        const begin=lines[0].start,finish=lines.at(-1).end;
        if(Math.abs(begin-original.start)>2||Math.abs(finish-original.end)>2)break;
        if(index&&begin<a.phrases[index-1].end-0.15)break;
        if(index+1<a.phrases.length&&finish>a.phrases[index+1].start+0.15)break;
        const proposal={...original,start:begin,end:finish,timingStatus:'reviewed',tokens:original.tokens.map((t,i)=>({...t,
          start:tokens[i]?.start??null,end:tokens[i]?.end??null,timingMode:finite(tokens[i]?.start)?'word':'line',timingReview:'adaptive-reviewed',timingConfidence:tokens[i]?.timingConfidence||'low'}))};
        try{candidate=normalizePhrase(proposal,a.duration);}catch{}
        break;
      }
      if(combined.length>expected.length)break;
    }
    if(candidate)break;
  }
  if(!candidate)return {candidate:null,disagreement:true};
  const change=Math.max(Math.abs(candidate.start-original.start),Math.abs(candidate.end-original.end));
  const uncertain=candidate.tokens.some(t=>!finite(t.start)||t.timingConfidence==='low');
  return {candidate,disagreement:change>0.6||uncertain||heard.issues>0};
}
function matchingCandidates(a,b){
  return a&&b&&a.tokens.length===b.tokens.length&&Math.abs(a.start-b.start)<=0.45&&Math.abs(a.end-b.end)<=0.45&&
    a.tokens.every((t,i)=>t.text===b.tokens[i].text&&(!finite(t.start)&&!finite(b.tokens[i].start)||finite(t.start)&&finite(b.tokens[i].start)&&Math.abs(t.start-b.tokens[i].start)<=0.45&&Math.abs(t.end-b.tokens[i].end)<=0.45));
}

export function spreadTeachingBatchOrder(count){
  if(!Number.isInteger(count)||count<=0)return [];
  const order=[],remaining=new Set(Array.from({length:count},(_,i)=>i));
  const take=i=>{if(remaining.delete(i))order.push(i);};
  take(0);take(count-1);take(Math.floor((count-1)/2));
  while(remaining.size){
    let best=null,bestDistance=-1;
    for(const i of remaining){
      const distance=Math.min(...order.map(j=>Math.abs(i-j)));
      if(distance>bestDistance||(distance===bestDistance&&(best===null||i<best))){best=i;bestDistance=distance;}
    }
    take(best);
  }
  return order;
}

export async function analyzeAdaptive(input,request,{signal,onProgress=()=>{},concurrency=3,maxReviews=12,clock=()=>Date.now(),intelligenceEnabled=false}={}){
  const start=clock(),usage=[];let calls=0;
  const call=async(kind,extra={},s=signal)=>{abort(s);calls++;const r=await request({...input,lyrics:'',...extra},kind,s);if(r.usage)usage.push(r.usage);return r;};
  onProgress({type:'phase',phase:'analyzing',message:'正在聆聽全曲，建立第一份歌詞時間軸…',detail:{stage:'fast-scan'}});
  const first=await call('fast-scan');abort(signal);
  let transcript=normalizeFastScan(first.raw,input);
  const plan=planTimingReview(transcript,{maxReviews});
  const batches=buildTeachingBatches(transcript,{maxTokens:120,maxPhrases:8,maxSeconds:intelligenceEnabled?48:Infinity});
  const intelligence=intelligenceEnabled?new VocalIntelligenceSession(transcript):null;
  const results=new Array(batches.length),completedBatches=new Set(),failures=[];
  const meta={...transcript.adaptive,state:'refining',revision:0,totalTasks:plan.selected.length+batches.length+(intelligence?intelligence.keyWindows.length+intelligence.voiceBatches.length:0),completedTasks:0,
    acceptedLines:plan.accepted,selectedLines:plan.selected.length,deferredLines:plan.deferred.length,reviewedLines:0,deepReviews:0,
    failedTasks:0,completedTeachingBatches:0,totalTeachingBatches:batches.length,firstResultMs:Math.max(0,clock()-start),calls:1};
  for(const item of plan.deferred)transcript.phrases[item.index].timingStatus='unverified';
  const deepLimit=Math.min(3,Math.ceil(transcript.phrases.length*0.1));
  const snapshot=()=>{
    let a=results.some(Boolean)?applyTeachingBatches(transcript,results):normalizeAnalysis(transcript);
    // Batches not attempted yet are pending, not a failed request or a false classification.
    const doneIds=new Set([...completedBatches].flatMap(i=>batches[i].phrases.map(p=>p.id)));
    a.phrases.forEach((p,pi)=>{if(!doneIds.has(`p${pi}`))p.tokens.forEach(t=>{if(t.annotationStatus!=='reviewed')t.annotationStatus='pending';});});
    a.warnings=a.warnings.filter(w=>!(/尚未取得/.test(w)&&meta.state==='refining'));
    if(intelligence){
      intelligence.apply(a);
      const timed=a.phrases.flatMap(p=>p.tokens).filter(t=>Number.isFinite(t.start)&&Number.isFinite(t.end)).length;
      a.dataQuality={...(a.dataQuality||{version:1,mode:'partial'}),timedTokens:timed,untimedTokens:a.phrases.reduce((n,p)=>n+p.tokens.filter(t=>!Number.isFinite(t.start)).length,0)+a.unalignedLyrics.reduce((n,s)=>n+Array.from(s).filter(c=>!/[\s\p{P}\p{S}]/u.test(c)).length,0)};
    }
    if(failures.length)a.warnings=[...new Set([...a.warnings,'部分精修未完成；已取得的歌詞、播放和標記均已保留。'])].slice(0,12);
    return {...a,adaptive:{...meta,calls,failedTasks:failures.length},provenance:{...transcript.provenance,model:first.model},
      usage:{inputTokens:usage.reduce((n,u)=>n+(u.inputTokens||0),0),outputTokens:usage.reduce((n,u)=>n+(u.outputTokens||0),0)}};
  };
  const emit=(type)=>{meta.revision++;onProgress({type,phase:type==='ready'?'playable':'refining',message:type==='ready'?'歌詞已準備，可以開始播放':'正在聽辨原唱、調性與整理建議練法',result:snapshot()});};
  // This packet is written BEFORE any optional verification or teaching request.
  emit('ready');
  const tasks=[];
  const timingTasks=plan.selected.map(item=>async()=>{
    const index=item.index,window=phraseWindow(transcript,index);let result;
    try{
      const r=await call('listen-review',{listeningWindow:window});abort(signal);
      const review=reviewCandidate(r.raw,transcript,index,window);result=review.candidate;
      if((item.level==='low'||review.disagreement)&&meta.deepReviews<deepLimit){
        meta.deepReviews++;const deep=await call('listen-review',{listeningWindow:window});abort(signal);
        const second=reviewCandidate(deep.raw,transcript,index,window);
        // Two incompatible observations are not averaged or labelled as verified.
        if(!matchingCandidates(result,second.candidate))result=null;else result=second.candidate;
      }else if(review.disagreement)result=null;
      if(result){transcript.phrases[index]=result;meta.reviewedLines++;}
      else transcript.phrases[index].timingStatus='unverified';
    }catch(e){if(signal?.aborted||fatal(e))throw e;transcript.phrases[index].timingStatus='unverified';throw e;}
  });
  const teachingTasks=new Map(batches.map((batch,index)=>[index,async()=>{
    const window={id:`teaching-${index}`,coreStart:batch.start,coreEnd:batch.end,clipStart:Math.max(0,batch.start-2),clipEnd:Math.min(transcript.duration,batch.end+2)};
    let r;
    try{
      r=await call('light-teaching',{teachingBatch:batch,listeningWindow:window});abort(signal);
      if(r.status!=='ok')throw new AppError('這段唱法仍待確認。',502,'TEACHING_UNAVAILABLE');
      applyWordDetails(transcript,r.wordDetails);
      const missing=missingTeachingBatch(batch,r.annotations);
      // One small repair for omitted IDs only. If the provider still cannot
      // classify them, settle them as explicit uncertainty instead of blanks.
      if(missing.tokenCount){try{
        const repaired=await call('light-teaching',{teachingBatch:missing,listeningWindow:window});abort(signal);
        for(const [id,value]of repaired.annotations)r.annotations.set(id,value);
        applyWordDetails(transcript,repaired.wordDetails);
      }catch(e){if(signal?.aborted||fatal(e))throw e;failures.push({task:`teaching-repair-${index}`,code:e.code||'FAILED'});}}
      results[index]=settleTeachingBatch(batch,r,{honest:intelligenceEnabled});
    }catch(e){
      if(signal?.aborted||fatal(e))throw e;
      failures.push({task:`teaching-${index}`,code:e.code||'FAILED'});
      // Preserve whole-song UX: a failed independent batch becomes 待確認,
      // while later batches continue to run and can still be identified.
      results[index]=settleTeachingBatch(batch,{status:'unavailable',warnings:['這一段建議暫未取得。']},{honest:intelligenceEnabled});
      if(intelligenceEnabled&&['NETWORK','TIMEOUT','GEMINI_429','GEMINI_500','GEMINI_502','GEMINI_503','GEMINI_504'].includes(e.code))throw e;
    }finally{completedBatches.add(index);meta.completedTeachingBatches=completedBatches.size;}
  }]));
  // Breadth-first whole-song coverage: the first worker wave deliberately
  // spans the beginning, ending and middle before local timing repairs.
  const teachingOrder=spreadTeachingBatchOrder(batches.length);
  if(intelligence){
    const voiceOrder=spreadTeachingBatchOrder(intelligence.voiceBatches.length),keyOrder=spreadTeachingBatchOrder(intelligence.keyWindows.length);
    const lanes=[voiceOrder.map(i=>()=>intelligence.voiceTask(intelligence.voiceBatches[i],call)),
      teachingOrder.map(i=>teachingTasks.get(i)),keyOrder.map(i=>()=>intelligence.keyTask(intelligence.keyWindows[i],call))];
    while(lanes.some(l=>l.length)){for(const lane of lanes)if(lane.length)tasks.push(lane.shift());if(tasks.length%9===0&&timingTasks.length)tasks.push(timingTasks.shift());}
  }else teachingOrder.forEach((batchIndex,pos)=>{
    tasks.push(teachingTasks.get(batchIndex));
    if((pos+1)%3===0&&timingTasks.length)tasks.push(timingTasks.shift());
  });
  while(timingTasks.length)tasks.push(timingTasks.shift());
  let next=0,stop=false,outages=0;
  const worker=async()=>{while(next<tasks.length&&!stop){abort(signal);const index=next++;try{await tasks[index]();}
    catch(e){if(signal?.aborted)throw e;failures.push({task:index,code:e.code||'FAILED'});if(intelligenceEnabled&&['NETWORK','TIMEOUT','GEMINI_500','GEMINI_502','GEMINI_503','GEMINI_504'].includes(e.code))outages++;if(fatal(e)||(intelligenceEnabled&&(e.code==='GEMINI_429'||outages>=3)))stop=true;}
    if(signal?.aborted)throw signal.reason;
    meta.completedTasks++;emit('update');
  }};
  try{await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),3,tasks.length)},worker));}
  catch(e){if(signal?.aborted)throw e;failures.push({task:'refinement',code:e.code||'FAILED'});}
  if(intelligence&&!stop&&!signal?.aborted){
    const reviews=intelligence.reviewTasks(call,{limit:3});tasks.push(...reviews);meta.totalTasks+=reviews.length;
    if(reviews.length){emit('update');await Promise.all(Array.from({length:Math.min(3,concurrency,reviews.length)},worker));}
  }
  intelligence?.finish();
  // Any batch that could not run (for example after a fatal auth/policy stop)
  // becomes explicit 待確認 rather than an empty late-song hole.
  for(let i=0;i<batches.length;i++)if(!results[i])results[i]=settleTeachingBatch(batches[i],{status:'unavailable',warnings:['這一段建議尚未取得。']},{honest:intelligenceEnabled});
  const finalCoverage=applyTeachingBatches(transcript,results).teachingCoverage;
  const observationMissing=intelligence?vocalCoverage(intelligence.apply(normalizeAnalysis(transcript))).missing:0;
  meta.state=failures.length||stop||finalCoverage.missing||(intelligenceEnabled&&(!transcript.adaptive.completeScan||transcript.unalignedLyrics.length||observationMissing||[...intelligence.keys.values()].some(k=>['missing','unavailable'].includes(k.status))))?'partial':'complete';meta.finishedMs=Math.max(0,clock()-start);
  meta.revision++;return snapshot();
}
