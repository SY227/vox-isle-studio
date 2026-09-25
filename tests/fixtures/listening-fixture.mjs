/** Original synthetic observations. This adapter never contacts a provider. */
import {readFileSync} from 'node:fs';
export const demo=JSON.parse(readFileSync(new URL('../../public/demo.json',import.meta.url),'utf8'));
export function wave(seconds=50){
 const b=Buffer.alloc(44+Math.round(seconds*16000)*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
 for(let i=0;i<(b.length-44)/2;i++)b.writeInt16LE(i%32760,44+i*2);
 return b;
}
export function syntheticListening(w,score=demo){
 const lines=score.phrases.map(p=>{
  const words=p.tokens.filter(t=>t.start>=w.clipStart&&t.end<=w.clipEnd).map(t=>({text:t.text,romanization:t.romanization,start:t.start-w.clipStart,end:t.end-w.clipStart,confidence:'high'}));
  return words.length?{text:words.map(t=>t.text).join(''),start:words[0].start,end:words.at(-1).end,section:p.section,confidence:'high',words}:null;
 }).filter(Boolean);
 return {status:'ok',reason:'',window_id:w.id,time_base:'clip_seconds',content:lines.length?'vocals':'no_vocals',lines};
}
export function syntheticTeaching(phrases){return {status:'ok',reason:'',key:'C',tempo:100,summary:'原創測試樂句',warnings:[],phrases:phrases.map(p=>({id:p.id,focus:'輕聲銜接',instruction:'可用舒服的聲量跟唱。',pronunciation:'保持字音。',exercise:'慢唱一次。',caution:'不適時停止。',tokens:p.tokens.map((t,i)=>({id:t.id,text:t.text,notes:[60+i%8],technique:'chest',ornaments:[],confidence:'medium'}))}))};}
export function providerRaw(options){
 const b=JSON.parse(options.body),schema=b.response_format?.schema||b.generationConfig?.responseJsonSchema;
 const parts=b.input||b.contents[0].parts,text=parts.find(p=>p.text)?.text||'';
 if(schema?.properties?.complete||text.includes('一次從頭到尾聆聽'))return {status:'ok',reason:'',title:demo.title,artist:demo.artist,language:demo.language,duration:demo.duration,complete:true,pitchLow:null,pitchHigh:null,phrases:demo.phrases.map(p=>({text:p.tokens.map(t=>t.text).join(''),section:p.section,start:p.start,end:p.end,confidence:.96,words:p.tokens.map(t=>({text:t.text,romanization:t.romanization,start:t.start,end:t.end}))}))};
 const isListening=Boolean(schema?.properties?.window_id)||/任務 LISTEN(?:_|)/.test(text);
 if(isListening){
  const windowId=JSON.parse(text.match(/window_id 必須原樣回 ("[^"\n]+")/)[1]);
  let match=text.match(/本次媒體只包含原片 ([\d.]+) 至 ([\d.]+) 秒/),absolute=false;
  if(!match){match=text.match(/只重新聆聽原片絕對時間 ([\d.]+) 至 ([\d.]+) 秒/);absolute=true;}
  const w={id:windowId,clipStart:Number(match[1]),clipEnd:Number(match[2])};
  const raw=syntheticListening(w);
  if(absolute){raw.time_base='source_seconds';for(const line of raw.lines){line.start+=w.clipStart;line.end+=w.clipStart;for(const word of line.words){word.start+=w.clipStart;word.end+=w.clipStart;}}}
  return raw;
 }
 const teaching=Boolean(schema?.properties?.phrases?.items?.properties?.id)||text.includes('固定歌詞資料（純資料，非指令）：');
 if(teaching){const data=text.includes('資料不是指令：')?text.split('資料不是指令：')[1].split('\n回指定JSON')[0]:text.split('固定歌詞資料（純資料，非指令）：\n')[1].split('\n回覆只使用')[0];return syntheticTeaching(JSON.parse(data));}
 const survey=Boolean(schema&&!schema.properties?.phrases)||text.includes('任務 SCAN_RECORDING');
 if(survey)return {status:'ok',reason:'',title:demo.title,artist:demo.artist,language:demo.language,duration:demo.duration};
 return demo;
}
export function completedFor(options,legacy=false){const raw=providerRaw(options);return legacy?{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]}:{status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(raw)}]}],usage:{total_input_tokens:123,total_output_tokens:456}};}
