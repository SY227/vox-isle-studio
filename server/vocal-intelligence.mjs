import {INTELLIGENCE_VERSION,normalizeKeySample,resolveTonality,normalizeObservation,validVoice} from '../shared/vocal-intelligence.mjs';
import {AppError} from './validation.mjs';
const f=Number.isFinite;
export function planKeyWindows(duration){
 if(!f(duration)||duration<=0||duration>900)throw new Error('Invalid duration');
 const count=Math.min(5,Math.max(1,Math.floor(duration/12))),bin=duration/count,width=Math.min(28,bin);
 return Array.from({length:count},(_,i)=>{const start=+(i*bin+(bin-width)/2).toFixed(3),end=+Math.min(duration,start+width).toFixed(3);return {id:`key-${i}`,clipStart:start,clipEnd:end,coreStart:start,coreEnd:end};});
}
/** Batches bounded by audio duration, not only token count. Long phrases split
 * into occurrence-preserving fragments; silence cannot create a 200-second job. */
export function planVocalBatches(a,{maxSpan=32,maxPhrases=5}={}){
 const batches=[];let entries=[],start=0,end=0;
 const flush=()=>{if(!entries.length)return;const i=batches.length;const w={id:`voice-${i}`,coreStart:start,coreEnd:end,clipStart:Math.max(0,start-2),clipEnd:Math.min(a.duration,end+2)};
   batches.push({id:w.id,index:i,phrases:entries,window:w});entries=[];};
 a.phrases.forEach((p,pi)=>{
  for(let at=p.start;at<p.end-.001;at+=maxSpan){const finish=Math.min(p.end,at+maxSpan);
   if(entries.length&&(finish-start>maxSpan||entries.length>=maxPhrases))flush();
   if(!entries.length)start=at;end=Math.max(start,finish);
   entries.push({id:`p${pi}`,index:pi,text:p.tokens.map(t=>t.text).join(''),start:p.start,end:p.end,coreStart:at,coreEnd:finish});
  }
 });flush();return batches;
}
export function normalizeVocalWindow(raw,batch){
 if(!raw||raw.windowId!==batch.id||!['ok','unavailable'].includes(raw.status))throw new AppError('原唱聽辨資料未能對應來源。',502,'VOICE_FORMAT');
 const fragments=new Map(),seen=new Set(),base=raw.timeBase==='clip_seconds'?batch.window.clipStart:0;
 if(raw.status==='ok'&&!['source_seconds','clip_seconds'].includes(raw.timeBase))throw new AppError('原唱聽辨時間座標待確認。',502,'VOICE_TIMEBASE');
 for(const p of batch.phrases){fragments.set(p.id,{index:p.index,coreStart:p.coreStart,coreEnd:p.coreEnd,status:raw.status==='unavailable'?'unavailable':'missing',segments:[]});}
 if(raw.status==='unavailable')return {status:'unavailable',fragments};
 const expected=new Map(batch.phrases.map(p=>[p.id,p]));
 for(const p of (Array.isArray(raw.phrases)?raw.phrases:[]).slice(0,40)){
  const target=expected.get(p?.id);if(!target)continue;
  if(seen.has(p.id)){fragments.set(p.id,{...fragments.get(p.id),status:'missing',segments:[]});continue;}seen.add(p.id);
  if(p.text!==target.text||!Array.isArray(p.segments))continue;
  const segments=p.segments.slice(0,80).flatMap(s=>{
   if(!f(s?.start)||!f(s?.end)||!validVoice(s.voice))return [];
   const start=s.start+base,end=s.end+base;
   if(start<target.coreStart-.05||end>target.coreEnd+.05||end<=start)return [];
   return [{...s,start,end,status:'reviewed'}];
  });
  const o=normalizeObservation({status:'reviewed',segments},target.coreStart,target.coreEnd);
  fragments.set(p.id,{index:target.index,coreStart:target.coreStart,coreEnd:target.coreEnd,...o});
 }
 return {status:'ok',fragments};
}
function missingResult(batch,st='unavailable'){
 return {status:st,fragments:new Map(batch.phrases.map(p=>[p.id,{index:p.index,coreStart:p.coreStart,coreEnd:p.coreEnd,status:st,segments:[]}]))};
}
export class VocalIntelligenceSession{
 constructor(transcript){
  this.transcript=transcript;this.keyWindows=planKeyWindows(transcript.duration);this.voiceBatches=planVocalBatches(transcript);
  this.keys=new Map();this.voices=new Map();this.failures=[];this.verificationCalls=0;this.finished=false;this.reviewed=new Set();
  this.keyWindows.forEach(w=>this.keys.set(w.id,{id:w.id,start:w.clipStart,end:w.clipEnd,status:'pending',key:null,alternative:null,confidence:'low',evidence:'',accompaniment:false}));
 }
 async keyTask(w,call){
  try{const r=await call('key-window',{listeningWindow:w});const sample=normalizeKeySample(r.raw,w);if(sample.status==='missing')throw new AppError('調性窗口回覆未對應來源。',502,'KEY_FORMAT');this.keys.set(w.id,sample);}
  catch(e){this.keys.set(w.id,normalizeKeySample({status:'unavailable',windowId:w.id},w));this.failures.push({stage:'key',id:w.id,code:e.code||'FAILED'});throw e;}
 }
 async voiceTask(batch,call){
  try{const r=await call('vocal-observation',{listeningWindow:batch.window,voiceBatch:batch});this.voices.set(batch.id,normalizeVocalWindow(r.raw,batch));}
  catch(e){this.voices.set(batch.id,missingResult(batch));this.failures.push({stage:'voice',id:batch.id,code:e.code||'FAILED'});throw e;}
 }
 apply(analysis){
  for(let pi=0;pi<analysis.phrases.length;pi++){
   const p=analysis.phrases[pi],targeted=this.voiceBatches.filter(b=>b.phrases.some(q=>q.index===pi));
   const fragments=targeted.map(b=>this.voices.get(b.id)?.fragments.get(`p${pi}`)).filter(Boolean);
   let segments=fragments.flatMap(x=>x.segments).sort((a,b)=>a.start-b.start);
   // Source observations remain fixed. Only their intersection with the current
   // reviewed phrase is displayed, without shifting source seconds.
   segments=segments.filter(s=>s.end>p.start&&s.start<p.end).map(s=>({...s,start:Math.max(p.start,s.start),end:Math.min(p.end,s.end)}));
   const st=fragments.length<targeted.length?(this.finished?'missing':'pending'):fragments.some(x=>['missing','unavailable'].includes(x.status))?'missing':'reviewed';
   p.observedVoice=normalizeObservation({status:st,segments},p.start,p.end);
  }
  analysis.tonality=resolveTonality([...this.keys.values()],{finished:this.finished||[...this.keys.values()].every(s=>s.status!=='pending'),expected:this.keyWindows.length});
  analysis.key=analysis.tonality.status==='stable'?`${analysis.tonality.primary.tonic} ${analysis.tonality.primary.mode}`:
   analysis.tonality.status==='modulating'?analysis.tonality.regions.map(r=>`${r.key.tonic} ${r.key.mode}`).join(' → ').slice(0,50):'待確認';
  analysis.vocalIntelligence={version:INTELLIGENCE_VERSION,state:this.finished?(this.failures.length||[...this.keys.values()].some(k=>['missing','unavailable'].includes(k.status))||[...this.voices.values()].some(v=>[...v.fragments.values()].some(p=>['missing','unavailable'].includes(p.status)))?'partial':'complete'):'refining',accuracyVerified:false,
   observedBatches:this.voices.size,totalObservedBatches:this.voiceBatches.length,verificationCalls:this.verificationCalls,
   keySamples:[...this.keys.values()].filter(k=>k.status!=='pending').length,totalKeySamples:this.keyWindows.length,failures:this.failures.slice(0,24)};
  return analysis;
 }
 reviewTasks(call,{limit=3}={}){
  const candidates=[];
  for(const [id,r] of this.voices)for(const [pid,p] of r.fragments){
   for(const s of p.segments)if(s.status==='conflict'||s.voice==='unknown'||s.confidence==='low'||s.transition){
    candidates.push({id,pid,p,s,priority:s.status==='conflict'?3:s.voice==='unknown'?2:1});break;
   }
  }
  candidates.sort((a,b)=>b.priority-a.priority||a.s.start-b.s.start);
  const used=new Set();return candidates.filter(c=>!used.has(c.pid)&&used.add(c.pid)).slice(0,limit).map(c=>async()=>{
   const original=this.voiceBatches.find(b=>b.id===c.id).phrases.find(p=>p.id===c.pid);
   const coreStart=c.s.start,coreEnd=Math.min(c.s.end,coreStart+8),w={id:`verify-${c.id}-${c.pid}`,coreStart,coreEnd,clipStart:Math.max(0,coreStart-1),clipEnd:Math.min(this.transcript.duration,coreEnd+1)};
   const batch={id:w.id,phrases:[{...original,coreStart,coreEnd}],window:w};this.verificationCalls++;
   try{
    const r=await call('vocal-review',{listeningWindow:w,voiceBatch:batch,intelligenceReview:true});
    const next=normalizeVocalWindow(r.raw,batch).fragments.get(c.pid);
    if(!next?.segments.length){this.failures.push({stage:'voice-review',id:w.id,code:'VOICE_REVIEW_MISSING'});return;}
    const replacement=next.segments.map(s=>{
      const prior=c.p.segments.filter(x=>x.end>s.start&&x.start<s.end&&x.voice!=='unknown');
      if(s.voice!=='unknown'&&prior.some(x=>x.voice!==s.voice))return {...s,voice:'unknown',status:'conflict',alternatives:[...new Set([...prior.map(x=>x.voice),s.voice])],evidence:'兩次獨立聽辨不一致；保留不確定。'};
      return {...s,confidence:s.voice==='unknown'?'low':'medium'};
    });
    // Replace only the actually re-listened interval; preserve the remainder.
    c.p.segments=c.p.segments.flatMap(s=>{
      if(s.end<=coreStart||s.start>=coreEnd)return [s];const pieces=[];
      if(s.start<coreStart)pieces.push({...s,end:coreStart});if(s.end>coreEnd)pieces.push({...s,start:coreEnd});return pieces;
    }).concat(replacement).sort((a,b)=>a.start-b.start);this.reviewed.add(c.pid);
   }catch(e){this.failures.push({stage:'voice-review',id:w.id,code:e.code||'FAILED'});throw e;}
  });
 }
 finish(){this.finished=true;for(const w of this.keyWindows)if(this.keys.get(w.id).status==='pending')this.keys.set(w.id,{...this.keys.get(w.id),status:'missing'});}
}
