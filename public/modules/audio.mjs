import {midiToHz,clamp} from '/shared/music.mjs?v=1.2.2';
import {detectPitch,summarizePitch} from '/shared/pitch.mjs?v=1.2.2';
export function encodeWav(samples,rate=16000){
  const b=new ArrayBuffer(44+samples.length*2),v=new DataView(b),put=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
  put(0,'RIFF');v.setUint32(4,b.byteLength-8,true);put(8,'WAVE');put(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const s=clamp(samples[i],-1,1);v.setInt16(44+i*2,s<0?s*32768:s*32767,true);}return new Blob([b],{type:'audio/wav'});
}
export function toBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(new Error('無法讀取音訊。'));r.readAsDataURL(blob);});}
export async function resample(chunks,sourceRate,targetRate=16000){
  const length=chunks.reduce((n,a)=>n+a.length,0);if(!length)throw new Error('沒有錄到音訊。');
  const offline=new OfflineAudioContext(1,Math.ceil(length*targetRate/sourceRate),targetRate);const buffer=offline.createBuffer(1,length,sourceRate);let offset=0;
  for(const chunk of chunks){buffer.copyToChannel(chunk,0,offset);offset+=chunk.length;}const source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);source.start();return (await offline.startRendering()).getChannelData(0);
}
export async function decodeFile(file){
  if(file.size>50*1024*1024)throw new Error('音訊檔上限為 50 MB，請先縮短或壓縮音訊。');
  const context=new AudioContext();let decoded;
  try{decoded=await context.decodeAudioData(await file.arrayBuffer());}catch{throw new Error('瀏覽器無法解碼這個音訊。請使用 MP3、WAV、M4A 或相容格式。');}finally{await context.close();}
  if(decoded.duration>360)throw new Error('第一版單次支援最多 6 分鐘，請先裁剪音訊。');
  if(decoded.duration<.3)throw new Error('音訊太短。');
  const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000);const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
  const rendered=await offline.startRendering(),samples=rendered.getChannelData(0);
  return {samples,duration:decoded.duration,blob:encodeWav(samples),waveform:waveform(samples)};
}
export function waveform(samples,bins=110){const output=[];const hop=Math.max(1,Math.floor(samples.length/bins));for(let i=0;i<bins;i++){let peak=0;for(let j=i*hop;j<Math.min(samples.length,(i+1)*hop);j+=8)peak=Math.max(peak,Math.abs(samples[j]));output.push(peak);}return output;}
export function scanPitch(samples,onProgress=()=>{},signal){return new Promise((resolve,reject)=>{
  const worker=new Worker('/workers/pitch-worker.mjs?v=1.2.2',{type:'module'});let done=false;
  const finish=(fn,arg)=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);worker.terminate();fn(arg);};
  const abort=()=>finish(reject,new DOMException('Cancelled','AbortError'));if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
  worker.onmessage=({data})=>{if(data.type==='progress')onProgress(data.progress);if(data.type==='done')finish(resolve,data);if(data.type==='error')finish(reject,new Error(data.error));};
  worker.onerror=()=>finish(reject,new Error('本機音高分析失敗。'));
  const copy=samples.slice();worker.postMessage({samples:copy,sampleRate:16000},[copy.buffer]);
});}
let synthContext,synthNodes=[];
export async function playNotes(notes,transpose=0,seconds=.48){
  stopNotes();if(!notes?.length)throw new Error('這個字的音高尚未確認，無法產生提示音。');
  synthContext??=new AudioContext();await synthContext.resume();const start=synthContext.currentTime+.04;
  notes.forEach((n,i)=>{
    const osc=synthContext.createOscillator(),overtone=synthContext.createOscillator(),gain=synthContext.createGain(),upper=synthContext.createGain();
    osc.type='sine';overtone.type='sine';osc.frequency.value=midiToHz(n+transpose);overtone.frequency.value=midiToHz(n+transpose)*2;upper.gain.value=.09;
    const t=start+i*seconds;gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.2,t+.025);gain.gain.exponentialRampToValueAtTime(.045,t+seconds*.65);gain.gain.linearRampToValueAtTime(0,t+seconds-.02);
    osc.connect(gain);overtone.connect(upper).connect(gain);gain.connect(synthContext.destination);osc.start(t);overtone.start(t);osc.stop(t+seconds);overtone.stop(t+seconds);synthNodes.push(osc,overtone);
    osc.onended=()=>{osc.disconnect();overtone.disconnect();gain.disconnect();upper.disconnect();synthNodes=synthNodes.filter(x=>x!==osc&&x!==overtone);};
  });return notes.length*seconds;
}
export function stopNotes(){for(const node of synthNodes){try{node.stop();}catch{}}synthNodes=[];}
export class Recorder {
  constructor(onUpdate,onEnd){this.onUpdate=onUpdate;this.onEnd=onEnd;this.active=false;this.starting=false;}
  async start(){
    if(this.active||this.starting)return;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('錄音需要 localhost 或 HTTPS，以及瀏覽器麥克風支援。');
    this.starting=true;this.cancelStart=false;
    try{
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
      if(this.cancelStart){this.stream.getTracks().forEach(t=>t.stop());return;}
      this.context=new AudioContext();await this.context.resume();await this.context.audioWorklet.addModule('/pcm-capture.js?v=1.2.2');
      this.source=this.context.createMediaStreamSource(this.stream);this.capture=new AudioWorkletNode(this.context,'pcm-capture');this.silent=this.context.createGain();this.silent.gain.value=0;
      this.source.connect(this.capture).connect(this.silent).connect(this.context.destination);
      this.chunks=[];this.frames=[];this.total=0;this.startTime=this.context.currentTime;this.active=true;
      this.capture.port.onmessage=({data})=>{
        if(!this.active)return;this.chunks.push(data);this.total+=data.length;
        const elapsed=this.total/this.context.sampleRate;
        // Decimate for low-cost fundamental detection; this is live feedback, not mastering analysis.
        const step=Math.max(1,Math.floor(this.context.sampleRate/12000));const down=new Float32Array(Math.floor(data.length/step));for(let i=0;i<down.length;i++)down[i]=data[i*step];
        this.ring??=new Float32Array(2048);this.ring.copyWithin(0,down.length);this.ring.set(down,2048-down.length);
        const result=detectPitch(this.ring,this.context.sampleRate/step);
        this.frames.push(result?{time:elapsed,...result}:null);this.onUpdate({elapsed,result});
        if(elapsed>=30)this.stop();
      };
    }catch(e){await this.cleanup();throw new Error(e.name==='NotAllowedError'?'麥克風權限被拒絕。請在瀏覽器網址列允許麥克風後重試。':e.message||'無法開啟麥克風。');}
    finally{this.starting=false;}
  }
  async stop(){
    if(this.starting){this.cancelStart=true;return;}
    if(!this.active)return;this.active=false;
    const rate=this.context.sampleRate,chunks=this.chunks,frames=this.frames;await this.cleanup();
    if(!chunks.length){this.onEnd(null,'錄音太短，請至少唱半秒再停止。');return;}
    try {const samples=await resample(chunks,rate);if(samples.length<4800){this.onEnd(null,'錄音太短，請至少唱半秒再停止。');return;}const blob=encodeWav(samples);this.onEnd({blob,samples,duration:samples.length/16000,summary:summarizePitch(frames,.12),frames:frames.filter(Boolean)});}
    catch{this.onEnd(null,'無法完成這次錄音，請重試。');}
  }
  async cleanup(){this.stream?.getTracks().forEach(t=>t.stop());try{this.capture?.port.postMessage('stop');this.capture?.disconnect();this.source?.disconnect();this.silent?.disconnect();await this.context?.close();}catch{}this.ring=null;}
  async dispose(){this.cancelStart=true;this.active=false;await this.cleanup();}
}
export function speak(text,language='mandarin'){
  if(!('speechSynthesis'in window))throw new Error('這個瀏覽器未提供語音朗讀。');
  speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);const voices=speechSynthesis.getVoices();
  const matches=language==='cantonese'?v=>/zh-HK|yue/i.test(v.lang):v=>/zh-TW|zh-CN|cmn/i.test(v.lang);
  const voice=voices.find(matches);if(!voice)throw new Error(language==='cantonese'?'裝置沒有粵語朗讀聲音；請閱讀教學文字。':'裝置沒有中文朗讀聲音；請閱讀教學文字。');
  utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=.9;speechSynthesis.speak(utterance);return utterance;
}
