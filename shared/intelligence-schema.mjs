const s={type:'string'},n={type:'number'},b={type:'boolean'},c={type:'string',enum:['low','medium','high']};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const array=items=>({type:'array',items});
const voice={type:'string',enum:['chest','mix','head','falsetto','unknown']};
export const keyWindowSchema=object({status:{type:'string',enum:['ok','unavailable']},windowId:s,
 tonic:s,mode:{type:'string',enum:['major','minor','unknown']},alternateTonic:s,alternateMode:{type:'string',enum:['major','minor','unknown']},
 confidence:c,accompaniment:b,evidence:s});
export const vocalWindowSchema=object({status:{type:'string',enum:['ok','unavailable']},windowId:s,timeBase:{type:'string',enum:['source_seconds','clip_seconds']},
 phrases:array(object({id:s,text:s,segments:array(object({start:n,end:n,voice,confidence:c,evidence:s,
 qualities:array({type:'string',enum:['airy','light','firm','rounded','bright','grainy','connected','audible-break']}),transition:b,transitionEvidence:s,alternatives:array(voice)}))}))});
