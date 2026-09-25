import {parseYouTube} from '../shared/music.mjs';
import {normalizePhrase} from '../shared/schema.mjs';
export class AppError extends Error {constructor(message,status=400,code='BAD_REQUEST'){super(message);this.status=status;this.code=code;}}
export function validateWave(base64,maxSeconds=360){
  if(typeof base64!=='string'||base64.length>16_000_000||(base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)))throw new AppError('音訊內容無效或超過大小上限。');
  const b=Buffer.from(base64,'base64');
  if(b.length<44||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.toString('ascii',12,16)!=='fmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt16LE(34)!==16||b.toString('ascii',36,40)!=='data')throw new AppError('此介面需要標準單聲道 PCM WAV，請重新選擇音訊。');
  const rate=b.readUInt32LE(24),dataLength=b.readUInt32LE(40);
  if(rate!==16000||dataLength!==b.length-44||dataLength%2!==0||b.readUInt32LE(4)!==b.length-8)throw new AppError('音訊標頭不正確。');
  const duration=dataLength/(rate*2);
  if(duration<.3||duration>maxSeconds+.1)throw new AppError(`音訊需介於 0.3 秒與 ${maxSeconds} 秒之間。`);
  return {duration,bytes:b.length};
}
function text(x,max=10000){if(x===undefined)return '';if(typeof x!=='string'||x.length>max)throw new AppError('文字太長或格式錯誤。');return x;}
function measured(x){
  if(!x)return null;
  const out={method:'client-side YIN-style estimate; untrusted client evidence'};
  for(const k of ['low','high','voicedFrames','totalFrames']){if(x[k]!==null&&(!Number.isFinite(x[k])||x[k]<0||x[k]>100000))throw new AppError('量測資料格式不正確。');out[k]=x[k]??null;}return out;
}
export function validateInput(raw,kind='analyze'){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AppError('請提供正確的請求內容。');
  // No rights checkbox/gate. This is a private prototype, not a rights-verification service.
  if(kind==='coach'&&raw.recordingConsent!==true)throw new AppError('請確認同意傳送這次私人錄音，才會開始 AI 回饋。');
  const language=raw.language||'auto';
  if(!['auto','cantonese','mandarin'].includes(language))throw new AppError('語言選項不正確。');
  if(kind==='coach'){
    validateWave(raw.audioData,35);
    const transpose=Number(raw.transpose||0);if(!Number.isInteger(transpose)||Math.abs(transpose)>12)throw new AppError('移調設定不正確。');
    let phrase;try{phrase=normalizePhrase(raw.phrase);}catch{throw new AppError('練習樂句格式不正確。');}
    return {audioData:raw.audioData,language,phrase,measured:measured(raw.measured),transpose};
  }
  if(!['youtube','upload'].includes(raw.source))throw new AppError('請選擇 YouTube 或音訊檔。');
  const input={source:raw.source,language,lyrics:text(raw.lyrics),fileName:text(raw.fileName,180),measured:measured(raw.measured)};
  if(raw.source==='youtube'){
    const video=parseYouTube(text(raw.url,1000));if(!video)throw new AppError('這不是有效的 YouTube 歌曲連結。');
    return {...input,...video};
  }
  const wave=validateWave(raw.audioData);return {...input,audioData:raw.audioData,duration:wave.duration};
}

export function validateLesson(raw){
  const source=validateInput(raw,'analyze');
  const duration=source.duration??Number(raw.duration);
  if(!Number.isFinite(duration)||duration<.3||duration>900)throw new AppError('歌曲長度不正確。');
  let phrase;try{phrase=normalizePhrase(raw.phrase,duration);}catch{throw new AppError('教學樂句格式不正確。');}
  if(phrase.end-phrase.start>90)throw new AppError('請選取較短的樂句。');
  return {...source,duration,phrase,listeningWindow:{id:'lesson',clipStart:Math.max(0,phrase.start-2),clipEnd:Math.min(duration,phrase.end+2),coreStart:phrase.start,coreEnd:phrase.end}};
}
