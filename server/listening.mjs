/** Recording-first transcription. No external lyrics, alignment model, or lyric-time interpolation.
 * Every listening call includes media. The second pass is blind to the first.
 * Structural agreement is evidence about two AI outputs, NOT measured musical accuracy.
 */
import {normalizeAnalysis} from '../shared/schema.mjs';
import {MAX_SONG_SECONDS,WINDOW_SECONDS,CONTEXT_SECONDS,TIMING_AGREEMENT_SECONDS,LISTENING_VERSION} from '../shared/listening-schema.mjs';
import {AppError,validateWave} from './validation.mjs';

const clean=(v,n=700)=>typeof v==='string'?v.slice(0,n):'';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const round=v=>Math.round(v*1000)/1000;
export const wordKey=v=>clean(v,1280).normalize('NFKC').replace(/(?!□)[\s\p{P}\p{S}]/gu,'').toLowerCase();
const units=text=>text.match(/□|[\p{Script=Han}]|[A-Za-z]+(?:['’\-][A-Za-z]+)*|[0-9]+|[^\s\p{P}\p{S}]/gu)||[];
const fail=(message,code='LISTENING_FORMAT')=>new AppError(message,502,code);

export function listeningWindows(duration,{size=WINDOW_SECONDS,context=CONTEXT_SECONDS}={}){
  if(!finite(duration)||duration<=0||duration>MAX_SONG_SECONDS)throw fail('請使用不超過 15 分鐘的單首歌曲。','SONG_DURATION');
  if(!finite(size)||size<6||size>60||!finite(context)||context<0||context>12)throw new Error('Invalid listening window options');
  const out=[];
  for(let start=0;start<duration;start+=size)out.push({id:`w${String(out.length).padStart(3,'0')}`,
    coreStart:round(start),coreEnd:round(Math.min(duration,start+size)),clipStart:round(Math.max(0,start-context)),clipEnd:round(Math.min(duration,start+size+context))});
  return out;
}

export function normalizeSurvey(raw,input={}){
  if(raw?.status==='unavailable')throw fail('目前無法聆聽這個來源，請稍後重試。','SOURCE_UNAVAILABLE');
  if(!raw||raw.status!=='ok')throw fail('尚未取得可用的歌曲概覽。');
  const duration=finite(input.duration)?input.duration:raw.duration;
  if(!finite(duration)||duration<0.3)throw fail('未能確認這個版本的歌曲長度，請重試。','SONG_DURATION');
  if(duration>MAX_SONG_SECONDS)throw fail('此版本支援最長 15 分鐘的單首歌曲；沒有截斷分析。','SONG_DURATION');
  return {title:clean(raw.title,160)||'未命名歌曲',artist:clean(raw.artist,160),duration:round(duration),
    language:['cantonese','mandarin','mixed','unknown'].includes(raw.language)?raw.language:'unknown'};
}

/** The browser already provides canonical 16kHz mono PCM. Slice actual bytes,
 * not a full upload plus a prompt claiming that it was clipped. */
export function sliceWave(base64,window){
  const info=validateWave(base64),buffer=Buffer.from(base64,'base64');
  if(window.clipStart<0||window.clipEnd>info.duration+0.001||window.clipEnd<=window.clipStart)throw fail('音訊片段範圍不正確。');
  const first=Math.round(window.clipStart*16000),last=Math.min(Math.round(window.clipEnd*16000),buffer.readUInt32LE(40)/2);
  const samples=buffer.subarray(44+first*2,44+last*2),out=Buffer.alloc(44+samples.length);
  buffer.copy(out,0,0,44);out.writeUInt32LE(out.length-8,4);out.writeUInt32LE(samples.length,40);samples.copy(out,44);
  return out.toString('base64');
}

/** Weighted monotone alignment is ONLY for merging two observed transcripts.
 * It never creates acoustic times, moves a word, or forces text onto audio. */
export function orderedMatches(a,b,score){
  const rows=a.length+1,cols=b.length+1;
  if(a.length>1200||b.length>1200)throw fail('單一片段的歌詞異常過長。');
  const dp=new Float32Array(rows*cols),trace=new Uint8Array(rows*cols);
  for(let i=1;i<rows;i++)for(let j=1;j<cols;j++){
    const at=i*cols+j,weight=score(a[i-1],b[j-1]);
    let value=dp[at-cols],direction=1;
    if(dp[at-1]>value){value=dp[at-1];direction=2;}
    if(weight>0&&dp[at-cols-1]+weight>=value){value=dp[at-cols-1]+weight;direction=3;}
    dp[at]=value;trace[at]=direction;
  }
  const pairs=[];let i=a.length,j=b.length;
  while(i&&j){const t=trace[i*cols+j];if(t===3){pairs.push([--i,--j]);}else if(t===1)i--;else j--;}
  return pairs.reverse();
}

export function normalizeListening(raw,w){
  if(raw?.status==='unavailable')throw fail('目前無法聆聽這段來源，請稍後重試。','SOURCE_UNAVAILABLE');
  if(!raw||raw.status!=='ok'||raw.window_id!==w.id||!['clip_seconds','source_seconds'].includes(raw.time_base)||!Array.isArray(raw.lines))
    throw fail('聆聽回傳未清楚標示片段或時間座標，已停止套用錯誤時間。','LISTENING_COORDINATES');
  if(!['vocals','no_vocals','uncertain'].includes(raw.content)||raw.lines.length>80)throw fail('片段聆聽內容格式不正確。');
  if(raw.content==='no_vocals'&&raw.lines.length)throw fail('片段同時回報無歌聲與歌詞，需重新聆聽。');
  let issues=0,count=0;
  const bound=(start,end)=>{
    if(start===null&&end===null)return null;
    if(!finite(start)||!finite(end)||end<=start){issues++;return null;}
    const offset=raw.time_base==='clip_seconds'?w.clipStart:0;
    const s=round(start+offset),e=round(end+offset);
    // No guessing "milliseconds", clamping to song length, or a second offset.
    if(s<w.clipStart-0.002||e>w.clipEnd+0.002){issues++;return null;}
    return [Math.max(s,w.clipStart),Math.min(e,w.clipEnd)];
  };
  const lines=[];
  for(let li=0;li<raw.lines.length;li++){
    const l=raw.lines[li];if(!l||!Array.isArray(l.words)||l.words.length>100)throw fail('片段缺少完整逐字歌詞。');
    const content=clean(l.text,1280)||l.words.map(x=>clean(x?.text,20)).join('');
    if(!wordKey(content))continue;
    let lineTime=bound(l.start,l.end);
    const observed=[];
    for(const word of l.words){
      if(!word||!wordKey(word.text))continue;
      const parts=units(clean(word.text,40)),time=bound(word.start,word.end);
      // Multi-character spans do not secretly become identical per-word times.
      for(const text of parts){const t=parts.length===1?time:null;
        observed.push({text,romanization:parts.length===1?clean(word.romanization,90):'',start:t?.[0]??null,end:t?.[1]??null,
          timingConfidence:['low','medium','high'].includes(word.confidence)?word.confidence:'low'});}
    }
    const expected=units(content),pairs=orderedMatches(expected,observed,(a,b)=>wordKey(a)===wordKey(b.text)?1:0);
    const map=new Map(pairs);
    // A recognizable line is retained in order even when the AI omits word entries.
    const tokens=expected.map((text,index)=>map.has(index)?{...observed[map.get(index)],text}:{text,romanization:'',start:null,end:null,timingConfidence:'low'});
    const timed=tokens.filter(t=>finite(t.start)&&finite(t.end));
    if(!lineTime&&timed.length===tokens.length&&timed.length)lineTime=[Math.min(...timed.map(t=>t.start)),Math.max(...timed.map(t=>t.end))];
    let last=-Infinity;
    for(const t of tokens){
      if(finite(t.start)&&(t.start<last-0.02||(lineTime&&(t.start<lineTime[0]-0.15||t.end>lineTime[1]+0.15)))){issues++;t.start=null;t.end=null;}
      if(finite(t.start))last=t.start;
    }
    if((count+=tokens.length)>600)throw fail('單一片段歌詞異常過長，未截斷顯示。');
    lines.push({id:`${w.id}l${li}`,text:tokens.map(t=>t.text).join(''),start:lineTime?.[0]??null,end:lineTime?.[1]??null,
      section:clean(l.section,40),timingConfidence:['low','medium','high'].includes(l.confidence)?l.confidence:'low',tokens});
  }
  if(!lines.length&&raw.content==='vocals')throw fail('回傳聲稱有歌聲，卻沒有歌詞，需重新聆聽。','EMPTY_LISTENING');
  return {window:w,content:raw.content,lines,issues,wordCount:count};
}
const flat=pass=>pass.lines.flatMap(l=>l.tokens.map(t=>({...t,lineStart:l.start,lineEnd:l.end})));
export function compareListening(a,b,tolerance=TIMING_AGREEMENT_SECONDS){
  const x=flat(a),y=flat(b),pairs=orderedMatches(x,y,(u,v)=>wordKey(u.text)===wordKey(v.text)?1:0);
  let disagreements=0,unknown=0,maxDelta=0;
  for(const [i,j]of pairs){const u=x[i],v=y[j];
    if(finite(u.start)&&finite(v.start)){
      const delta=Math.max(Math.abs(u.start-v.start),Math.abs(u.end-v.end));maxDelta=Math.max(maxDelta,delta);if(delta>tolerance)disagreements++;
    }else{
      unknown++;
      if(finite(u.start)!==finite(v.start))disagreements++;
      if(finite(u.lineStart)&&finite(v.lineStart)&&Math.abs(u.lineStart-v.lineStart)>tolerance)disagreements++;
    }
  }
  const missing=x.length+y.length-2*pairs.length;
  return {agreement:!missing&&!disagreements&&!a.issues&&!b.issues&&a.content===b.content,
    matched:pairs.length,missing,disagreements,unknown,maxDelta:round(maxDelta)};
}
const draft=pass=>({time_base:'source_seconds',content:pass.content,lines:pass.lines.map(l=>({text:l.text,start:l.start,end:l.end,
  words:l.tokens.map(t=>({text:t.text,start:t.start,end:t.end}))}))});

/** Merge overlapping audio observations; repeated text later in the song survives.
 * Cross-window matching is monotone, time-constrained and one-to-one. There is
 * no global text deduplication and no duration / character-count timing formula. */
export function mergeListening(passes,survey){
  const groups=new Map(),events=[];let serial=0,mergedWords=0,boundaryDisagreements=0;
  const groupRoot=id=>{let g=groups.get(id);while(g?.alias){id=g.alias;g=groups.get(id);}return id;};
  for(const pass of passes){
    const w=pass.window,current=[];
    for(const line of pass.lines){
      if(!groups.has(line.id))groups.set(line.id,{...line,tokens:undefined,window:w,review:pass.review});
      const known=line.tokens.filter(t=>finite(t.start));
      for(let i=0;i<line.tokens.length;i++){
        const t=line.tokens[i];
        // sortAt is solely a document ordering key; it is NEVER a timestamp.
        const before=line.tokens.slice(0,i).reverse().find(x=>finite(x.start));
        const after=line.tokens.slice(i+1).find(x=>finite(x.start));
        const sortAt=finite(t.start)?t.start:(before&&after?Math.min(before.end,after.start):before?.end??after?.start??line.start??w.coreStart);
        current.push({token:{...t},group:line.id,sortAt,order:i,serial:serial++,window:w,review:pass.review,
          timingKnown:finite(t.start)&&finite(t.end)});
      }
    }
    const previous=events.filter(e=>e.sortAt>=w.clipStart-1.2&&e.sortAt<=w.clipEnd+1.2).sort((a,b)=>a.sortAt-b.sortAt||a.serial-b.serial);
    const pairs=orderedMatches(previous,current,(a,b)=>{
      if(wordKey(a.token.text)!==wordKey(b.token.text))return 0;
      const delta=Math.abs(a.sortAt-b.sortAt);
      // Only overlapping recording windows can describe the same occurrence.
      if(a.window.clipEnd<=w.clipStart||delta>1.2)return 0;
      return 6-delta*2;
    });
    const matched=new Set();
    for(const [i,j]of pairs){
      const old=previous[i],next=current[j];matched.add(j);mergedWords++;
      const oldGroup=groupRoot(old.group),newGroup=groupRoot(next.group);
      if(newGroup!==oldGroup&&groups.get(newGroup)?.window.id===w.id)groups.get(newGroup).alias=oldGroup;
      const disagreement=old.timingKnown&&next.timingKnown&&Math.max(Math.abs(old.token.start-next.token.start),Math.abs(old.token.end-next.token.end))>TIMING_AGREEMENT_SECONDS;
      if(disagreement){boundaryDisagreements++;old.boundaryDisputed=true;}
      const interior=e=>Math.min(e.sortAt-e.window.clipStart,e.window.clipEnd-e.sortAt);
      const rank=e=>(e.review==='ai-agreement'?10:e.review==='ai-relistened'?8:0)+(e.token.timingConfidence==='high'?2:e.token.timingConfidence==='medium'?1:0);
      if(rank(next)>rank(old)||(rank(next)===rank(old)&&interior(next)>interior(old))){
        old.token=next.token;old.sortAt=next.sortAt;old.window=next.window;old.review=next.review;old.timingKnown=next.timingKnown;
      }
    }
    // Keep all unmatched observed words; never lose a boundary word by enforcing
    // a hard core-start cutoff on slightly different model estimates.
    for(let i=0;i<current.length;i++)if(!matched.has(i))events.push(current[i]);
  }
  const buckets=new Map();
  for(const e of events){const id=groupRoot(e.group);if(!buckets.has(id))buckets.set(id,[]);buckets.get(id).push(e);}
  const phrases=[],unaligned=[];let uncertainWords=0,wordTimed=0,lineOnly=0;
  for(const [id,words]of buckets){
    const group=groups.get(id);words.sort((a,b)=>a.sortAt-b.sortAt||a.order-b.order||a.serial-b.serial);
    // Short UI lines avoid an unrelated 64-token schema/DOM cutoff.
    for(let at=0;at<words.length;at+=64){
      const slice=words.slice(at,at+64),timed=slice.filter(e=>e.timingKnown);
      let start=timed.length?Math.min(...timed.map(e=>e.token.start)):group.start;
      let end=timed.length?Math.max(...timed.map(e=>e.token.end)):group.end;
      if(slice.some(e=>!e.timingKnown)&&finite(group.start)&&finite(group.end)){
        start=Math.min(start??group.start,group.start);end=Math.max(end??group.end,group.end);
      }
      if(!finite(start)||!finite(end)||end<=start){unaligned.push(slice.map(e=>e.token.text).join(''));continue;}
      const tokens=slice.map(e=>{
        const reliable=e.timingKnown&&!e.boundaryDisputed&&e.token.timingConfidence!=='low';
        if(reliable)wordTimed++;else{lineOnly++;uncertainWords++;}
        return {...e.token,start:reliable?e.token.start:null,end:reliable?e.token.end:null,
          timingMode:reliable?'word':'line',timingReview:e.boundaryDisputed?'boundary-disputed':e.review,
          notes:[],technique:'unknown',ornaments:[],confidence:'low'};
      });
      phrases.push({start,end,section:group.section||'樂句',tokens,timingReview:group.review,
        focus:'先跟著原聲熟悉這句。',instruction:'唱法建議稍後補充。',pronunciation:'',exercise:'用舒服的聲量跟唱。',caution:'不適時停止。'});
    }
  }
  phrases.sort((a,b)=>a.start-b.start);
  if(!phrases.length&&!unaligned.length)throw fail('這段來源沒有辨識到可練唱的主唱歌詞。','NO_VOCALS');
  const duration=survey.duration;
  const warnings=['歌詞和時間由本次錄音分段聆聽產生；第二次 AI 聆聽不是人工或聲學精度認證。',
    ...(uncertainWords?[`${uncertainWords} 個字的逐字起訖仍不確定，只跟隨樂句，不假造逐字亮字。`]:[]),
    ...(boundaryDisagreements?[`${boundaryDisagreements} 個邊界字的聽辨時間有差異，已降為樂句同步。`]:[]),
    ...(unaligned.length?['未能確認時間的文字保留在待對齊區，沒有以猜測秒數填入。']:[])];
  const normalized=normalizeAnalysis({status:'ok',reason:'',...survey,duration,key:'待確認',tempo:null,
    summary:'從原聲建立歌詞、時間與唱法。',warnings,phrases,unalignedLyrics:unaligned,
    dataQuality:{version:1,mode:uncertainWords||unaligned.length?'partial':'complete',timedTokens:wordTimed,
      untimedTokens:lineOnly+unaligned.reduce((n,s)=>n+units(s).length,0),unknownPitchTokens:events.length},
    listening:{version:LISTENING_VERSION,windowSeconds:WINDOW_SECONDS,contextSeconds:CONTEXT_SECONDS,
      windows:passes.length,reviewedWindows:passes.length,relistenedWindows:passes.filter(p=>p.review==='ai-relistened').length,
      wordTimed,lineOnly,mergedOverlapWords:mergedWords,boundaryDisagreements,accuracyVerified:false}});
  return normalized;
}

export async function analyzeByListening(input,request,{signal,onProgress=()=>{},concurrency=2}={}){
  const controller=new AbortController(),active=AbortSignal.any([signal,controller.signal].filter(Boolean));
  const usage=[];let completed=0;
  const call=async(kind,extra={})=>{
    if(active.aborted)throw active.reason;
    const result=await request({...input,lyrics:'',...extra},kind,active);
    if(result.usage)usage.push(result.usage);
    return result.raw;
  };
  onProgress({phase:'analyzing',message:'正在聆聽這個版本，辨識歌曲長度…',detail:{stage:'survey'}});
  const survey=normalizeSurvey(await call('survey'),input),windows=listeningWindows(survey.duration);
  const results=new Array(windows.length);let next=0,fatal;
  const emit=(stage,index)=>onProgress({phase:'analyzing',message:stage==='listening'?`正在逐段聆聽 · ${completed} / ${windows.length} 段完成`:`正在核對人聲與歌詞時間 · ${completed} / ${windows.length} 段完成`,
    detail:{stage:'listening',activity:stage,completedWindows:completed,totalWindows:windows.length,window:index,sourceDuration:survey.duration}});
  const worker=async()=>{
    while(next<windows.length&&!fatal){
      const index=next++,w=windows[index];
      try{
        emit('listening',index);
        const first=normalizeListening(await call('listen',{listeningWindow:w}),w);
        emit('checking',index);
        // No first-pass text or timestamp is sent to this independent request.
        const second=normalizeListening(await call('listen-review',{listeningWindow:w}),w);
        const comparison=compareListening(first,second);
        let chosen=second,review='ai-agreement';
        if(!comparison.agreement){
          chosen=normalizeListening(await call('listen-resolve',{listeningWindow:w,listeningDrafts:[draft(first),draft(second)]}),w);
          review='ai-relistened';
        }
        results[index]={...chosen,review,comparison};completed++;emit('checking',index);
      }catch(e){if(!fatal){fatal=e;controller.abort(e);}throw e;}
    }
  };
  const all=await Promise.allSettled(Array.from({length:Math.min(Math.max(1,concurrency),2,windows.length)},worker));
  if(fatal)throw fatal;
  const rejected=all.find(r=>r.status==='rejected');if(rejected)throw rejected.reason;
  onProgress({phase:'analyzing',message:'正在接合片段邊界，保留每一次副歌…',detail:{stage:'merging',completedWindows:completed,totalWindows:windows.length}});
  const score=mergeListening(results,survey);
  return {...score,provenance:{kind:'ai-estimate',pipeline:LISTENING_VERSION,createdAt:new Date().toISOString(),
      timing:'Recording-first, clipped, independently re-listened AI estimates; not acoustically benchmarked',
      transcriptSource:'recording-only',inputLyricsUsed:false,register:'Pedagogical suggestion; not identified physiology',
      sourceIdentity:input.source==='youtube'?input.videoId||input.url:'uploaded-recording',durationSource:input.source==='youtube'?'ai-survey':'pcm-sample-count'},
    usage:{inputTokens:usage.reduce((n,u)=>n+(u.inputTokens||0),0),outputTokens:usage.reduce((n,u)=>n+(u.outputTokens||0),0)}};
}
