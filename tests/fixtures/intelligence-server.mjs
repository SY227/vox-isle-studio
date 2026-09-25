/** Test-only loopback server. Actual app HTTP/NDJSON; synthetic AI responses.
 * Never included in dist or exposed as a production route. */
import {readFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {createApp} from '../../server/index.mjs';
import {analyzeAdaptive} from '../../server/adaptive.mjs';
import {normalizeTeachingBatch} from '../../shared/annotations.mjs';
import {normalizeWordDetails} from '../../server/word-details.mjs';
import {keyResponse,voiceResponse,practiceResponse} from './intelligence-fixture.mjs';
const demo=JSON.parse(readFileSync(new URL('../../public/demo.json',import.meta.url),'utf8'));
const scan={status:'ok',complete:true,reason:'',title:'微光練習曲 · QA 原創合成旋律',artist:'Singing Fox QA',language:demo.language,duration:demo.duration,
 phrases:demo.phrases.map(p=>({text:p.tokens.map(t=>t.text).join(''),section:p.section,start:p.start,end:p.end,confidence:.96}))};
const server=createApp({apiKey:'local-qa-no-provider-call',model:'gemini-3.8-flash',origin:'',allowedOrigins:[],host:'127.0.0.1',accessCode:'',production:false,timeout:25000},{
 generate:async(input,kind,config,signal,unused,emit)=>analyzeAdaptive(input,async(x,k)=>{
  await sleep(k==='fast-scan'?120:450,undefined,{signal});
  if(k==='fast-scan')return {raw:structuredClone(scan)};
  if(k==='key-window')return {raw:keyResponse(x.listeningWindow,Number(x.listeningWindow.id.split('-')[1])<2?'C':'D')};
  if(['vocal-observation','vocal-review'].includes(k)){
   const r=voiceResponse(x.voiceBatch);for(const p of r.phrases){const i=Number(p.id.slice(1));for(const s of p.segments){s.voice=['chest','chest','head','falsetto','mix','chest','head','falsetto'][i];s.evidence='原創測試資料：音色與練習建議分開呈現。';}}
   if(input.id==='qaMissing00')r.phrases=[];
   return {raw:r};
  }
  if(k==='light-teaching'){
   const raw=practiceResponse(x.teachingBatch);
   for(const p of raw.phrases){const orig=demo.phrases[Number(p.id.slice(1))];p.tokens.forEach((t,i)=>{Object.assign(t,{start:orig.tokens.find(z=>z.text===t.text)?.start??null,end:orig.tokens.find(z=>z.text===t.text)?.end??null});const o=orig.tokens[i];if(o?.text===t.text)Object.assign(t,{start:o.start,end:o.end,notes:o.notes,romanization:o.romanization,ornaments:o.ornaments});});}
   return {...normalizeTeachingBatch(raw,x.teachingBatch),wordDetails:normalizeWordDetails(raw,x.teachingBatch,x.listeningWindow)};
  }
  if(k==='listen-review')return {raw:{status:'unavailable'}};
  throw Error('unexpected '+k);
 },{signal,onProgress:emit,intelligenceEnabled:true})
});
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}`));
process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit());});
