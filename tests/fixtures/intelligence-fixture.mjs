import {normalizeTeachingBatch} from '../../shared/annotations.mjs';
export function intelligenceScan(count=12){return {status:'ok',reason:'',title:'原創 QA 聲音路線',artist:'Singing Fox QA',language:'cantonese',duration:count*6+4,complete:true,
 phrases:Array.from({length:count},(_,i)=>({text:'微光同行',section:i<count/2?'主歌':'副歌',start:i*6+1,end:i*6+5,confidence:.96}))};}
export function keyResponse(window,key='C',mode='major'){return {status:'ok',windowId:window.id,tonic:key,mode,alternateTonic:'unknown',alternateMode:'unknown',confidence:'high',accompaniment:true,evidence:'低音與和聲在同一中心穩定收束。'};}
export function voiceResponse(batch,{voice='chest',confidence='high',transition=false}={}){return {status:'ok',windowId:batch.id,timeBase:'source_seconds',phrases:batch.phrases.map(p=>({id:p.id,text:p.text,segments:[{start:p.coreStart,end:p.coreEnd,voice,confidence,evidence:'音色較實、音節銜接連續。',qualities:['firm','connected'],transition,transitionEvidence:transition?'聽到由實轉輕的銜接。':'',alternatives:[]}]}))};}
export function practiceResponse(batch){return {status:'ok',timeBase:'source_seconds',phrases:batch.phrases.map(p=>({id:p.id,tokens:p.tokens.map((t,i)=>({id:t.id,text:t.text,practiceTechnique:'mix',notes:[60+i],ornaments:[],confidence:'medium',romanization:'',start:null,end:null}))}))};}
export function intelligenceResponder(scan=intelligenceScan(),seen=[]){return async(input,kind)=>{
 seen.push({kind,input});
 if(kind==='fast-scan')return {raw:structuredClone(scan)};
 if(kind==='key-window')return {raw:keyResponse(input.listeningWindow)};
 if(['vocal-observation','vocal-review'].includes(kind))return {raw:voiceResponse(input.voiceBatch)};
 if(kind==='light-teaching')return normalizeTeachingBatch(practiceResponse(input.teachingBatch),input.teachingBatch);
 if(kind==='listen-review')return {raw:{status:'unavailable',windowId:input.listeningWindow.id}};
 throw Error('Unexpected kind '+kind);
};}
