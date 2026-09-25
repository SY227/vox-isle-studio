/** v1.3: observations are never inferred from practice recommendations.
 * Confidence and multi-window agreement are heuristics, not measured accuracy.
 * No DSP / source separation / physiological inference is claimed here.
 */
export const INTELLIGENCE_VERSION = 'vocal-intelligence-v1';
export const OBSERVED_VOICES = Object.freeze({
  chest: {label:'偏真聲感', color:'#e36f55'},
  mix: {label:'偏混聲感', color:'#178f78'},
  head: {label:'偏頭聲感', color:'#7f6bc9'},
  falsetto: {label:'偏假聲感', color:'#3d95c8'},
  unknown: {label:'聽辨待確認', color:'#788b90'}
});
const f=Number.isFinite, text=(v,max=260)=>typeof v==='string'?v.slice(0,max):'';
const inRange=(v,lo,hi)=>f(v)&&v>=lo&&v<=hi;
const confidence=v=>['high','medium','low'].includes(v)?v:'low';
const status=v=>['pending','reviewed','uncertain','conflict','missing','unavailable'].includes(v)?v:'missing';
export const validVoice=v=>Object.hasOwn(OBSERVED_VOICES,v);
export const KEY_NOTES=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const pitchClass={C:0,'B#':0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,F:5,'E#':5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11,Cb:11};
export function normalizeKey(tonic,mode){
  const t=text(tonic,4).replaceAll('♯','#').replaceAll('♭','b');
  if(!Object.hasOwn(pitchClass,t)||!['major','minor'].includes(mode))return null;
  return {tonic:KEY_NOTES[pitchClass[t]],mode};
}
export const sameKey=(a,b)=>a&&b&&a.tonic===b.tonic&&a.mode===b.mode;
export const keyLabel=k=>k&&normalizeKey(k.tonic,k.mode)?`${k.tonic.replace('b','♭')} ${k.mode==='major'?'大調':'小調'}`:'調性待確認';
export function tonalityLabel(t){
  if(!t)return '調性待確認';
  if(t.status==='pending')return '調性聽辨中';
  if(t.status==='modulating')return (t.regions||[]).map(r=>keyLabel(r.key)).join(' → ');
  if(t.primary)return keyLabel(t.primary)+(t.status==='uncertain'?' · 待核對':'');
  return t.status==='unavailable'?'調性暫未取得':'調性待確認';
}
const availableStatus=['pending','reviewed','uncertain','unavailable','missing'];
export function normalizeKeySample(raw,window){
  const shell={id:window.id,start:window.clipStart,end:window.clipEnd,status:'missing',key:null,alternative:null,confidence:'low',evidence:'',accompaniment:false};
  if(!raw||raw.windowId!==window.id)return shell;
  if(raw.status==='unavailable')return {...shell,status:'unavailable'};
  if(raw.status!=='ok')return shell;
  const evidence=text(raw.evidence),key=normalizeKey(raw.tonic,raw.mode),alternative=normalizeKey(raw.alternateTonic,raw.alternateMode);
  const c=confidence(raw.confidence),heard=raw.accompaniment===true;
  return {...shell,status:key&&heard&&evidence&&c!=='low'?'reviewed':'uncertain',key,alternative:!sameKey(key,alternative)?alternative:null,
    confidence:c,evidence,accompaniment:heard};
}
/** No averaging a relative major/minor ambiguity; no short-window key overwrite. */
export function resolveTonality(samples,{finished=false,expected=samples.length}={}){
  const all=[...samples].sort((a,b)=>a.start-b.start),usable=all.filter(s=>s.status==='reviewed'&&s.key);
  const groups=[];
  for(const s of usable){let g=groups.find(g=>sameKey(g.key,s.key));if(!g){g={key:s.key,n:0};groups.push(g);}g.n++;}
  groups.sort((a,b)=>b.n-a.n);
  const base={version:INTELLIGENCE_VERSION,status:finished?'uncertain':'pending',primary:null,alternative:null,confidence:'low',samples:all,
    expected,received:all.filter(s=>s.status!=='pending').length,agreeingWindows:0,regions:[],changes:[],accuracyVerified:false};
  if(!usable.length){if(finished&&all.every(s=>['missing','unavailable'].includes(s.status)))base.status='unavailable';return base;}
  const top=groups[0];base.primary=top.key;base.agreeingWindows=top.n;
  base.alternative=groups[1]?.key||usable.find(s=>s.alternative)?.alternative||null;
  // Modulation is reported only with two separate consecutive observations on
  // EACH side. One contradictory window remains a conflict, not a key change.
  const runs=[];
  for(const s of all){
    if(s.status!=='reviewed'||!s.key){runs.push({key:null,samples:[s]});continue;}
    const last=runs.at(-1);if(last&&sameKey(last.key,s.key))last.samples.push(s);else runs.push({key:s.key,samples:[s]});
  }
  if(finished&&runs.length>=2&&runs.every(r=>r.key&&r.samples.length>=2)){
    base.status='modulating';base.confidence='medium';base.primary=runs[0].key;
    base.regions=runs.map(r=>({key:r.key,start:r.samples[0].start,end:r.samples.at(-1).end,windows:r.samples.length}));
    base.changes=runs.slice(1).map((r,i)=>({from:runs[i].key,to:r.key,
      earliest:runs[i].samples.at(-1).start,latest:r.samples[0].end,precision:'window-bracket'}));
    return base;
  }
  // Must have >=3 agreeing NON-overlapping samples to call it stable.
  let lastEnd=-Infinity,independent=0;
  for(const s of usable.filter(s=>sameKey(s.key,top.key))){if(s.start>=lastEnd){independent++;lastEnd=s.end;}}
  if(finished&&independent>=3&&groups.length===1){base.status='stable';base.confidence=base.alternative||usable.length<expected?'medium':'high';}
  else if(finished)base.status='uncertain';
  return base;
}
export function normalizeTonality(raw,duration){
  if(!raw||raw.version!==INTELLIGENCE_VERSION)return null;
  const counts=new Map();for(const s of (Array.isArray(raw.samples)?raw.samples:[]).slice(0,8))counts.set(s?.id,(counts.get(s?.id)||0)+1);
  const samples=(Array.isArray(raw.samples)?raw.samples:[]).slice(0,8).filter(s=>counts.get(s?.id)===1).flatMap(s=>{
    if(!inRange(s?.start,0,duration)||!inRange(s?.end,s.start+.001,duration+.25)||typeof s.id!=='string')return [];
    const key=normalizeKey(s.key?.tonic,s.key?.mode),evidence=text(s.evidence),heard=s.accompaniment===true;
    const st=availableStatus.includes(s.status)?s.status:'missing';
    return [{id:text(s.id,60),start:s.start,end:s.end,key,alternative:normalizeKey(s.alternative?.tonic,s.alternative?.mode),
      confidence:confidence(s.confidence),evidence,accompaniment:heard,
      status:st==='reviewed'&&(!key||!evidence||!heard||s.confidence==='low')?'uncertain':st}];
  });
  // Recompute any claimed consensus; imported accuracy=true is never trusted.
  return resolveTonality(samples,{finished:raw.status!=='pending',expected:Number.isInteger(raw.expected)?Math.min(8,Math.max(samples.length,raw.expected)):samples.length});
}
const qualities=new Set(['airy','light','firm','rounded','bright','grainy','connected','audible-break']);
export function normalizeObservation(raw,start,end){
  if(!raw||typeof raw!=='object')return {status:'pending',segments:[],reason:'not-analyzed'};
  const out={status:status(raw.status),segments:[],reason:text(raw.reason,100)};
  let last=start;
  for(const s of (Array.isArray(raw.segments)?raw.segments:[]).slice(0,80)){
    if(!inRange(s?.start,start-.05,end)||!inRange(s?.end,s.start+.001,end+.05)||s.start<last-.03||!validVoice(s.voice))continue;
    let voice=s.voice,st=status(s.status||'reviewed'),c=confidence(s.confidence);
    const evidence=text(s.evidence),transitionEvidence=text(s.transitionEvidence,180);
    if(voice==='unknown'||!evidence||c==='low'){voice='unknown';if(st==='reviewed')st='uncertain';}
    out.segments.push({start:s.start,end:s.end,voice,status:st,confidence:c,evidence,
      qualities:[...new Set((Array.isArray(s.qualities)?s.qualities:[]).filter(q=>qualities.has(q)))].slice(0,5),
      transition:s.transition===true&&!!transitionEvidence,transitionEvidence,
      alternatives:[...new Set((Array.isArray(s.alternatives)?s.alternatives:[]).filter(v=>validVoice(v)&&v!=='unknown'&&v!==voice))].slice(0,3)});
    last=s.end;
  }
  for(let i=1;i<out.segments.length;i++){
    const prev=out.segments[i-1],cur=out.segments[i];
    if(prev.voice!=='unknown'&&cur.voice!=='unknown'&&cur.voice!==prev.voice&&cur.start-prev.end<.2&&
      Math.min(cur.end-cur.start,prev.end-prev.start)<.35&&!cur.transition){
      cur.alternatives=[cur.voice,prev.voice];cur.voice='unknown';cur.status='conflict';out.reason='unsupported-rapid-change';
    }
  }
  if(!out.segments.length&&out.status==='reviewed')out.status='missing';
  if(out.segments.some(s=>s.status==='conflict'))out.status='conflict';
  else if(out.segments.length&&out.segments.every(s=>s.voice==='unknown'))out.status='uncertain';
  return out;
}
/** Map time intervals to words, never map a practice label to an observation. */
export function voiceForToken(p,t){
  const obs=p.observedVoice;
  const fallback={voice:'unknown',status:obs?.status||'pending',confidence:'low',evidence:'',scope:'phrase',transition:false};
  if(!obs?.segments?.length)return fallback;
  const timed=f(t.start)&&f(t.end),start=timed?t.start:p.start,end=timed?t.end:p.end;
  const active=obs.segments.filter(s=>s.end>start&&s.start<end),known=active.filter(s=>s.voice!=='unknown');
  const covered=active.reduce((n,s)=>n+Math.max(0,Math.min(end,s.end)-Math.max(start,s.start)),0);
  if(covered/(end-start)<.65)return {...fallback,status:'missing'};
  const classes=[...new Set(known.map(s=>s.voice))];
  if(classes.length!==1||known.length!==active.length)return {...fallback,status:active.some(s=>s.status==='conflict')?'conflict':'uncertain',
    transition:timed&&classes.length>1&&active.some(s=>s.transition),evidence:active.map(s=>s.evidence).filter(Boolean).join('；').slice(0,260)};
  return {voice:classes[0],status:'reviewed',confidence:known.every(s=>s.confidence==='high')?'high':'medium',
    evidence:known.map(s=>s.evidence).filter(Boolean).join('；').slice(0,260),scope:timed?'word':'phrase',transition:known.some(s=>s.transition)};
}
export function vocalCoverage(a){
  const items=(a?.phrases||[]).flatMap(p=>p.tokens.map(t=>voiceForToken(p,t)));
  const untimed=(a?.unalignedLyrics||[]).reduce((n,l)=>n+Array.from(l).filter(x=>!/[\s\p{P}\p{S}]/u.test(x)).length,0);
  const identified=items.filter(t=>t.voice!=='unknown').length;
  const uncertain=items.filter(t=>['uncertain','conflict'].includes(t.status)).length;
  const pending=items.filter(t=>t.status==='pending').length;
  const missing=items.filter(t=>['missing','unavailable'].includes(t.status)).length+untimed;
  return {total:items.length+untimed,identified,uncertain,pending,missing,untimed};
}
export function phraseVoiceLabel(p){
  if(!p.observedVoice)return '原唱尚待重新聽辨';
  const labels=[];for(const s of p.observedVoice.segments||[]){const l=OBSERVED_VOICES[s.voice]?.label||'聽辨待確認';if(l!==labels.at(-1))labels.push(l);}
  return labels.length?labels.join(' → '):({pending:'正在聆聽原唱',missing:'這句尚未取得聽辨',unavailable:'這句暫未能聽辨',uncertain:'聽辨待確認'}[p.observedVoice.status]||'聽辨待確認');
}
export function normalizeIntelligence(raw){
  if(!raw||raw.version!==INTELLIGENCE_VERSION)return null;
  const n=v=>f(v)?Math.min(100000,Math.max(0,v)):0;
  return {version:INTELLIGENCE_VERSION,state:['refining','complete','partial','cancelled'].includes(raw.state)?raw.state:'partial',accuracyVerified:false,
    observedBatches:n(raw.observedBatches),totalObservedBatches:n(raw.totalObservedBatches),verificationCalls:n(raw.verificationCalls),
    keySamples:n(raw.keySamples),totalKeySamples:n(raw.totalKeySamples),
    failures:(Array.isArray(raw.failures)?raw.failures:[]).slice(0,24).map(x=>({stage:text(x.stage,40),id:text(x.id,60),code:/^[A-Za-z0-9_-]{1,50}$/.test(String(x.code))?String(x.code):'FAILED'}))};
}
