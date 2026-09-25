/** Audio-first output contracts. Null means unknown, never zero or interpolated. */
const str={type:'string'},num={type:'number'},nullable={type:['number','null']};
const obj=p=>({type:'object',properties:p,required:Object.keys(p),additionalProperties:false});
const arr=items=>({type:'array',items});
const confidence={type:'string',enum:['low','medium','high']};
export const surveySchema=obj({status:{type:'string',enum:['ok','unavailable']},reason:str,
  title:str,artist:str,language:{type:'string',enum:['cantonese','mandarin','mixed','unknown']},duration:num});
export const listeningSchema=obj({status:{type:'string',enum:['ok','unavailable']},reason:str,
  window_id:str,time_base:{type:'string',enum:['clip_seconds','source_seconds']},
  content:{type:'string',enum:['vocals','no_vocals','uncertain']},
  lines:arr(obj({text:str,start:nullable,end:nullable,section:str,confidence,
    words:arr(obj({text:str,romanization:str,start:nullable,end:nullable,confidence}))}))});
export const LISTENING_VERSION='audio-first-v1';
export const MAX_SONG_SECONDS=900;
export const WINDOW_SECONDS=24;
export const CONTEXT_SECONDS=4;
export const TIMING_AGREEMENT_SECONDS=0.45;
