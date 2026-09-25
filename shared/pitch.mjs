import {hzToMidi, median} from './music.mjs';
/** YIN-style cumulative normalized difference. For MONOPHONIC signals only.
 * Rejects silence, weak periodicity and pitches outside 65–1200 Hz.
 * Does not identify voice registers, health, anatomy, or separate instruments.
 */
export function detectPitch(signal, sampleRate, minHz=65, maxHz=1200) {
  if (!signal?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  let rms=0, mean=0;
  for (const x of signal) {rms+=x*x; mean+=x;}
  rms=Math.sqrt(rms/signal.length); mean/=signal.length;
  if (rms < .009) return null;
  const half=Math.floor(signal.length/2), maxTau=Math.min(half-1,Math.ceil(sampleRate/minHz));
  const minTau=Math.max(2,Math.floor(sampleRate/maxHz));
  if (maxTau<=minTau) return null;
  const d=new Float32Array(maxTau+2); d[0]=1;
  let cumulative=0;
  for(let tau=1;tau<=maxTau;tau++) {
    let sum=0;
    for(let j=0;j<half;j++){const diff=(signal[j]-mean)-(signal[j+tau]-mean); sum+=diff*diff;}
    cumulative+=sum; d[tau]=cumulative>0?sum*tau/cumulative:1;
  }
  let tau=-1;
  for(let t=minTau;t<maxTau;t++) if(d[t]<.14){while(t+1<maxTau && d[t+1]<d[t])t++;tau=t;break;}
  if(tau<0 || 1-d[tau]<.86) return null;
  const left=d[tau-1],right=d[tau+1],center=d[tau];
  const denom=2*(2*center-left-right), offset=denom ? (right-left)/denom : 0;
  const hz=sampleRate/(tau+Math.max(-1,Math.min(1,offset)));
  if(hz<minHz || hz>maxHz)return null;
  const midi=hzToMidi(hz);
  return {hz,midi,cents:Math.round((midi-Math.round(midi))*100),confidence:1-d[tau],rms};
}
/** Filter isolated frames and short octave glitches; report sustained note events.
 * True min/max of retained events; NOT an arbitrary percentile masquerading as extrema.
 */
export function summarizePitch(frames, minDuration=.12) {
  const events=[];
  let current=null;
  for (const f of frames) {
    if(!f || !Number.isFinite(f.midi) || f.confidence<.86){ current=null;continue; }
    const note=Math.round(f.midi);
    if(current && current.note===note && f.time-current.end<=.13){current.end=f.time;current.values.push(f.midi);}
    else {current={note,start:f.time,end:f.time,values:[f.midi]};events.push(current);}
  }
  const retained=events.filter(e=>e.end-e.start>=minDuration).map(e=>({note:e.note,start:e.start,end:e.end,midi:median(e.values)}));
  const pitches=retained.map(e=>e.midi), count=frames.filter(f=>f && f.confidence>=.86).length;
  return {low:pitches.length?Math.min(...pitches):null,high:pitches.length?Math.max(...pitches):null,
    events:retained,voicedFrames:count,totalFrames:frames.length,method:'YIN-style monophonic estimate',minDuration};
}
