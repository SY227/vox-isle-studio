import {readFile,writeFile} from 'node:fs/promises';
import {normalizeFastScan} from '../../server/adaptive.mjs';
const demo=JSON.parse(await readFile(new URL('../../public/demo.json',import.meta.url)));
const raw={status:'ok',reason:'',title:'微光練習曲 · 漸進測試',artist:'VOX QA',language:demo.language,duration:demo.duration,complete:true,pitchLow:60,pitchHigh:72,
 phrases:demo.phrases.map(p=>({text:p.tokens.map(t=>t.text).join(''),section:p.section,start:p.start,end:p.end,confidence:.95,words:p.tokens.map(t=>({text:t.text,start:t.start,end:t.end,romanization:t.romanization}))}))};
const ready=normalizeFastScan(raw);ready.adaptive={...ready.adaptive,revision:1,totalTasks:8,completedTasks:0,totalTeachingBatches:8,completedTeachingBatches:0};
const patch=n=>{const a=structuredClone(ready);a.adaptive={...a.adaptive,revision:n+1,completedTasks:n,completedTeachingBatches:n,state:n===8?'complete':'refining'};for(let i=0;i<n;i++){a.phrases[i].tokens=demo.phrases[i].tokens.map(t=>({...t,timingMode:'word',timingReview:'first-pass',annotationStatus:'reviewed'}));}return a;};
const updated=patch(4),done=patch(8),partial=patch(7);partial.adaptive.state='partial';partial.adaptive.failedTasks=1;
await writeFile(new URL('./adaptive-cases.json',import.meta.url),JSON.stringify({ready,updated,done,partial}));
