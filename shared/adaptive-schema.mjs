/** Compact recording-first outputs. Confidence is an AI estimate, never a calibrated probability. */
import {teachingTokenSchema} from './schema.mjs';
const s={type:'string'}, n={type:'number'}, nullable={type:['number','null']};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const array=items=>({type:'array',items});
export const fastScanSchema=object({status:{type:'string',enum:['ok','unavailable']},reason:s,title:s,artist:s,
  language:{type:'string',enum:['cantonese','mandarin','mixed','unknown']},duration:n,complete:{type:'boolean'},
  pitchLow:nullable,pitchHigh:nullable,
  phrases:array(object({text:s,section:s,start:nullable,end:nullable,confidence:n,
    words:array(object({text:s,romanization:s,start:nullable,end:nullable}))}))});
export const lightTeachingSchema=object({status:{type:'string',enum:['ok','unavailable']},reason:s,
  phrases:array(object({id:s,tokens:array(teachingTokenSchema)}))});
export const lessonSchema=object({focus:s,instruction:s,pronunciation:s,exercise:s,caution:s});
export const ADAPTIVE_VERSION='adaptive-recording-v1';
