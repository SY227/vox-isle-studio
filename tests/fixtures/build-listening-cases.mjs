// Reproducible integration fixtures. Synthetic observations through REAL server
// orchestration; never described as recorded Gemini output.
import {writeFile} from 'node:fs/promises';
import {generate} from '../../server/gemini.mjs';
import {completedFor,providerRaw} from './listening-fixture.mjs';
const input={source:'youtube',url:'https://www.youtube.com/watch?v=YaJ_lYFgr6c',language:'mandarin'};
const config={apiKey:'FAKE-QA-ONLY',model:'gemini-3.8-flash',timeout:6000,retryDelays:[0,0,0]};
const phases=[];
const normal=await generate(input,'analyze',config,undefined,async(u,o)=>new Response(JSON.stringify(completedFor(o,u.includes(':generateContent')))),e=>phases.push(e));
const line=await generate(input,'analyze',config,undefined,async(u,o)=>{
 const raw=providerRaw(o);
 for(const l of raw.lines||[])if(l.text==='把微光放在手心')for(const t of l.words){t.start=null;t.end=null;}
 return new Response(JSON.stringify({status:'completed',output_text:JSON.stringify(raw)}));
});
await writeFile(new URL('./listening-cases.json',import.meta.url),JSON.stringify({normal,line,phases},null,2)+'\n');
console.log('Created explicitly synthetic full-pipeline browser fixtures.');
