import {detectPitch,summarizePitch} from '/shared/pitch.mjs?v=1.2.3';
self.onmessage=({data})=>{
  try {
    const {samples,sampleRate}=data,frames=[]; const window=2048, hop=Math.round(sampleRate*.05);
    for(let i=0;i+window<samples.length;i+=hop){
      const result=detectPitch(samples.subarray(i,i+window),sampleRate);
      frames.push(result?{time:i/sampleRate,...result}:null);
      if(i%(hop*80)===0)self.postMessage({type:'progress',progress:i/samples.length});
    }
    self.postMessage({type:'done',summary:summarizePitch(frames),frames:frames.filter(Boolean).filter((_,i)=>i%2===0)});
  }catch(error){self.postMessage({type:'error',error:String(error.message)});}
};
