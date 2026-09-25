/** Word timing is a separate map from singing labels. It can only fill missing
 * boundaries on the exact frozen occurrence; it cannot rewrite an existing time.
 */
import {seconds} from '../shared/recovery.mjs';
export function normalizeWordDetails(raw,batch,window){
  const details=new Map(),seen=new Set();
  const phrases=new Map(batch.phrases.map(p=>[p.id,p]));
  const base=raw.timeBase==='clip_seconds'?Number(window?.clipStart)||0:0;
  // Unknown coordinate systems are never guessed.
  if(raw.timeBase&&!['source_seconds','clip_seconds'].includes(raw.timeBase))return details;
  for(const p of raw.phrases||[]){const target=phrases.get(p?.id);if(!target)continue;
    const tokens=new Map(target.tokens.map(t=>[t.id,t]));
    for(const t of p.tokens||[]){const key=t?.id,original=tokens.get(key);if(!original||original.text!==t.text)continue;
      if(seen.has(key)){details.delete(key);continue;}seen.add(key);
      const a=seconds(t.start),b=seconds(t.end),start=a===null?null:a+base,end=b===null?null:b+base;
      const valid=Number.isFinite(start)&&Number.isFinite(end)&&start>=target.start&&end>start&&end<=target.end;
      details.set(key,{romanization:typeof t.romanization==='string'?t.romanization.slice(0,90):'',
        start:valid?start:null,end:valid?end:null,confidence:['high','medium','low'].includes(t.confidence)?t.confidence:'low'});
    }
  }
  return details;
}
export function applyWordDetails(transcript,details){
  if(!(details instanceof Map))return transcript;
  transcript.phrases.forEach((p,pi)=>{
    const proposals=p.tokens.map((t,ti)=>details.get(`p${pi}t${ti}`));
    p.tokens.forEach((t,ti)=>{
      const d=proposals[ti];if(!d)return;if(d.romanization&&!t.romanization)t.romanization=d.romanization;
      if(Number.isFinite(t.start)||!Number.isFinite(d.start))return;
      // Teaching batches are frozen before selective timing review. A late
      // teaching response may therefore carry a now-stale word boundary. Keep
      // its technique annotation, but never let that stale timing escape the
      // phrase's current reviewed envelope.
      if(d.start<p.start-0.05||d.end>p.end+0.05)return;
      const previous=p.tokens[ti-1],next=p.tokens[ti+1],pd=proposals[ti-1],nd=proposals[ti+1];
      const prevEnd=Number.isFinite(previous?.end)?previous.end:pd?.end;
      const nextStart=Number.isFinite(next?.start)?next.start:nd?.start;
      if(Number.isFinite(prevEnd)&&d.start<prevEnd-0.05||Number.isFinite(nextStart)&&d.end>nextStart+0.05)return;
      Object.assign(t,{start:d.start,end:d.end,timingMode:'word',timingReview:'first-pass',timingConfidence:d.confidence});
    });
  });return transcript;
}
