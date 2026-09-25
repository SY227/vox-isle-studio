import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFastScan,planTimingReview,analyzeAdaptive,phraseWindow} from '../server/adaptive.mjs';
import {normalizeAnalysis} from '../shared/schema.mjs';
import {normalizeTeachingBatch,teachingCoverage} from '../shared/annotations.mjs';
import {generate,requestBody,interactionsBody} from '../server/gemini.mjs';
import {ProviderQueue} from '../server/provider-queue.mjs';
import {validateLesson,AppError} from '../server/validation.mjs';
import {createApp} from '../server/index.mjs';
import {parseYouTube} from '../shared/music.mjs';
import {analyze as clientAnalyze} from '../public/modules/api.mjs';
import {demo,syntheticTeaching,syntheticListening,wave} from './fixtures/listening-fixture.mjs';
const config={apiKey:'TEST_NOT_A_SECRET',model:'gemini-3.8-flash',timeout:10000,retryDelays:[0,0,0],host:'127.0.0.1',origin:'',accessCode:'',port:0};
const input={source:'youtube',url:'https://www.youtube.com/watch?v=YaJ_lYFgr6c',language:'auto'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const scan=(n=20)=>({status:'ok',reason:'',title:'原創驗收用歌詞',artist:'VOX QA',language:'mandarin',duration:n*8+1,complete:true,pitchLow:null,pitchHigh:null,phrases:Array.from({length:n},(_,i)=>({text:'微光同行',start:i*8+1,end:i*8+6,section:i===n-1?'最後副歌':'主歌',confidence:.96,words:Array.from('微光同行',(c,j)=>({text:c,romanization:'',start:i*8+1+j,end:i*8+1.8+j}))}))});
function responder(raw,seen=[],options={}){
 return async(recording,kind,signal)=>{
  seen.push({kind,recording});
  if(kind==='fast-scan')return {raw};
  if(options.delay)await delay(options.delay);
  if(signal?.aborted)throw signal.reason;
  if(kind==='light-teaching'){
   if(recording.teachingBatch.index===options.failBatch)throw new AppError('synthetic stage-eight failure',502,'GEMINI_500');
   return normalizeTeachingBatch(syntheticTeaching(recording.teachingBatch.phrases),recording.teachingBatch);
  }
  if(kind==='listen-review'){
   const w=recording.listeningWindow,p=raw.phrases[Number(w.id.split('-p')[1])];
   const bad=options.disagree&&seen.filter(x=>x.kind==='listen-review').length%2===0;
   return {raw:{status:'ok',window_id:w.id,time_base:'source_seconds',content:'vocals',lines:[{text:bad?'別的句子':p.text,start:p.start,end:p.end,section:p.section,confidence:'high',words:p.words.map(t=>({...t,confidence:'high'}))}]}};
  }
  throw new Error('unexpected '+kind);
 };
}

test('ready emitted after one whole-recording request and before all optional requests',async()=>{
 const raw=scan(),seen=[],events=[];
 const result=await analyzeAdaptive(input,responder(raw,seen),{onProgress:e=>{events.push(e);if(e.type==='ready'){assert.deepEqual(seen.map(x=>x.kind),['fast-scan']);assert.equal(e.result.phrases.length,20);assert.ok(e.result.phrases.every(p=>p.tokens.every(t=>t.annotationStatus==='pending')));}}});
 assert.equal(result.adaptive.state,'complete');assert.equal(result.adaptive.selectedLines,0);assert.equal(seen.length,1+Math.ceil(20/8));
 assert.equal(events.filter(e=>e.type==='ready').length,1);assert.equal(events.filter(e=>e.type==='update').length,3);
 assert.ok(!seen.some(x=>['lesson','survey','listen'].includes(x.kind)));
});
test('high/medium/low scheduling is evidence-driven, not forced success percentages',()=>{
 const raw=scan();raw.phrases[16].confidence=.75;raw.phrases[17].confidence=.74;raw.phrases[18].confidence=.5;raw.phrases[19].confidence=.4;
 const a=normalizeFastScan(raw),plan=planTimingReview(a);
 assert.equal(plan.accepted,16);assert.equal(plan.selected.filter(x=>x.level==='medium').length,2);assert.equal(plan.selected.filter(x=>x.level==='low').length,2);
 assert.equal(plan.selected[0].index,19);
});
test('structural missing timing overrides an AI high confidence claim',()=>{
 const raw=scan();raw.phrases[8].words[0].start=null;raw.phrases[8].words[0].end=null;
 const a=normalizeFastScan(raw),plan=planTimingReview(a);assert.equal(plan.selected[0].index,8);assert.equal(plan.selected[0].level,'low');assert.equal(a.phrases[8].tokens[0].start,null);
});
test('unknown confidence defaults to review candidate rather than trusted high',()=>{const r=scan(1);delete r.phrases[0].confidence;assert.equal(planTimingReview(normalizeFastScan(r)).selected.length,1);});
test('high confidence cannot conceal placeholder text or overlapping lines',()=>{const r=scan(4);r.phrases[2].text='微□同行';r.phrases[2].words[1].text='□';r.phrases[3].start=20;r.phrases[3].words=[];const p=planTimingReview(normalizeFastScan(r));assert.ok(p.selected.length);assert.ok(p.selected.concat(p.deferred).some(x=>x.reasons.includes('unclear-text')));});
test('timing budget never forces all uncertain lines into another listening pass',()=>{const r=scan(60);r.phrases.forEach(p=>p.confidence=.3);const p=planTimingReview(normalizeFastScan(r));assert.equal(p.selected.length,12);assert.equal(p.deferred.length,48);});
test('suspicious line receives only its actual +/-2 second window',()=>{const a=normalizeFastScan(scan());const w=phraseWindow(a,5);assert.equal(w.clipStart,a.phrases[5].start-2);assert.equal(w.clipEnd,a.phrases[5].end+2);assert.ok(w.clipEnd-w.clipStart<24);});
test('medium-confidence agreeing line gets one review; low-confidence gets detailed second look',async()=>{
 const r=scan(10);r.phrases[4].confidence=.75;r.phrases[8].confidence=.4;const seen=[];
 const a=await analyzeAdaptive(input,responder(r,seen));assert.equal(a.adaptive.reviewedLines,2);
 assert.equal(seen.filter(x=>x.kind==='listen-review').length,3);assert.equal(a.adaptive.deepReviews,1);
});
test('conflicting re-listens do not average timestamps or overwrite transcript words',async()=>{
 const r=scan(5);r.phrases[1].confidence=.4;const a=await analyzeAdaptive(input,responder(r,[],{disagree:true}));
 assert.equal(a.phrases[1].tokens.map(t=>t.text).join(''),r.phrases[1].text);assert.equal(a.phrases[1].timingStatus,'unverified');assert.equal(a.phrases[1].start,r.phrases[1].start);
});
test('deep review is budgeted; all-low-confidence recording cannot trigger unbounded calls',async()=>{
 const r=scan(50);r.phrases.forEach(p=>p.confidence=.4);const seen=[];const a=await analyzeAdaptive(input,responder(r,seen));
 assert.equal(a.adaptive.deepReviews,3);assert.equal(seen.filter(x=>x.kind==='listen-review').length,15);assert.equal(a.adaptive.deferredLines,38);
});
test('actual eighth teaching-batch failure preserves full lyrics and all later successful labels',async()=>{
 const r=scan(80),events=[];const a=await analyzeAdaptive(input,responder(r,[],{failBatch:7}),{onProgress:e=>events.push(e)});
 assert.equal(a.phrases.length,80);assert.equal(a.adaptive.state,'partial');assert.equal(a.adaptive.failedTasks,1);
 assert.equal(a.phrases[79].tokens[0].technique,'chest');assert.equal(a.phrases[56].tokens[0].technique,'unknown');
 assert.equal(a.adaptive.completedTeachingBatches,10);assert.equal(a.adaptive.completedTasks,a.adaptive.totalTasks);assert.ok(events.some(e=>e.type==='ready'));
});
test('one optional malformed response cannot send a delivered transcript back to error',async()=>{
 const r=scan(20);const fn=responder(r);let calls=0;
 const a=await analyzeAdaptive(input,async(x,k,s)=>{if(k!=='fast-scan'&&++calls===1)throw Error('bad JSON');return fn(x,k,s);});
 assert.equal(a.adaptive.state,'partial');assert.equal(a.phrases.length,20);assert.ok(teachingCoverage(a).identified>0);
});
test('first pass failure emits no usable result and cannot invent demo lyrics',async()=>{const events=[];await assert.rejects(analyzeAdaptive(input,async()=>{throw new AppError('network',502,'NETWORK');},{onProgress:e=>events.push(e)}));assert.ok(!events.some(e=>e.type==='ready'));});
test('optional worker concurrency is capped at three',async()=>{
 const r=scan(80),fn=responder(r);let active=0,peak=0;
 await analyzeAdaptive(input,async(x,k,s)=>{if(k==='fast-scan')return fn(x,k,s);active++;peak=Math.max(peak,active);await delay(8);try{return await fn(x,k,s);}finally{active--; }},{concurrency:50});assert.equal(peak,3);
});
test('cancelling after ready stops scheduling additional work',async()=>{
 const r=scan(80),seen=[],ctrl=new AbortController();
 await assert.rejects(analyzeAdaptive(input,responder(r,seen,{delay:15}),{signal:ctrl.signal,onProgress:e=>{if(e.type==='ready')ctrl.abort();}}));assert.deepEqual(seen.map(x=>x.kind),['fast-scan']);
});
test('fatal authentication during refinement stops future scheduling but returns partial lyrics',async()=>{const r=scan(80);let n=0;const fn=responder(r);const a=await analyzeAdaptive(input,async(x,k,s)=>{if(k!=='fast-scan'){n++;throw new AppError('auth',502,'GEMINI_401');}return fn(x,k,s);},{concurrency:2});assert.ok(n<=2);assert.equal(a.adaptive.state,'partial');assert.equal(a.phrases.length,80);});
test('unknown word times stay null, with complete line text kept',()=>{const r=scan(1);r.phrases[0].words.forEach(t=>{t.start=null;t.end=null;});const a=normalizeFastScan(r);assert.equal(a.phrases[0].tokens.length,4);assert.ok(a.phrases[0].tokens.every(t=>t.start===null&&t.timingMode==='line'));});
test('unknown line time retains full text without invented sync',()=>{const r=scan(2);r.phrases[0].start=null;const a=normalizeFastScan(r);assert.equal(a.unalignedLyrics[0],r.phrases[0].text);assert.equal(a.phrases.length,1);});
test('multi-character timestamp cannot become duplicate per-character timing',()=>{const r=scan(1);r.phrases[0].words=[{text:'微光同行',start:1,end:6,romanization:''}];const a=normalizeFastScan(r);assert.equal(a.phrases[0].tokens.length,4);assert.ok(a.phrases[0].tokens.every(t=>t.start===null));});
test('repeated choruses at different positions retain all distinct occurrences',()=>{const r=scan(20);const a=normalizeFastScan(r);assert.equal(a.phrases.length,20);assert.equal(new Set(a.phrases.map(p=>p.start)).size,20);});
test('incomplete scan remains explicitly incomplete, not a false full-song claim',()=>{const r=scan();r.complete=false;const a=normalizeFastScan(r);assert.equal(a.adaptive.completeScan,false);assert.ok(a.warnings.some(x=>x.includes('未確認涵蓋完整')));});
test('source longer than support bound is rejected, not cut to first verses',()=>{const r=scan();r.duration=901;assert.throws(()=>normalizeFastScan(r));});
test('overlong line is kept as unaligned text rather than chopped',()=>{const r=scan();r.phrases[0].text='光'.repeat(65);r.phrases[0].words=[];const a=normalizeFastScan(r);assert.equal(a.unalignedLyrics[0].length,65);});
test('adaptive provenance survives export/import while accuracyVerified cannot be forged',()=>{const a=normalizeFastScan(scan());a.adaptive.accuracyVerified=true;const b=normalizeAnalysis(JSON.parse(JSON.stringify(a)));assert.equal(b.adaptive.accuracyVerified,false);assert.equal(b.phrases[0].scanConfidence,.96);assert.equal(b.phrases[0].tokens[0].annotationStatus,'pending');});
test('initial pitch range remains null when not heard; no mandatory pitch work on critical path',()=>{const a=normalizeFastScan(scan());assert.equal(a.range.low,null);assert.equal(a.firstScanRange,undefined);});
test('available provisional pitch is retained separately from annotated range',()=>{const r=scan();r.pitchLow=48;r.pitchHigh=75;const a=normalizeFastScan(r);assert.equal(a.firstScanRange.high,75);assert.equal(a.range.high,null);});
test('light teaching schema contains no full per-line lesson prose',()=>{const b=interactionsBody({...input,teachingBatch:{index:0,totalBatches:1,start:1,end:6,phrases:[]}},'light-teaching',config.model);assert.equal(b.response_format.schema.properties.phrases.items.properties.instruction,undefined);assert.ok(b.response_format.schema.properties.phrases.items.properties.tokens);});
test('first scan uses exact audio source, no lyrics sheet, no survey or clip gate',()=>{const b=interactionsBody(input,'fast-scan',config.model);assert.equal(b.input[0].uri,input.url);assert.equal(b.input[0].processing,undefined);assert.ok(b.response_format.schema.properties.complete);assert.match(b.input[1].text,/一次從頭到尾聆聽/);});
test('lesson is a separate short source-window request, not a scan-stage requirement',()=>{const a=normalizeFastScan(scan());const v=validateLesson({...input,phrase:a.phrases[2],duration:a.duration});const b=interactionsBody(v,'lesson',config.model);assert.ok(b.response_format.schema.properties.instruction);assert.equal(b.input[0].processing.start_offset,'15s');assert.equal(b.generation_config.max_output_tokens,2048);});
test('malformed lesson cannot request arbitrary remote files or oversized source windows',()=>{const a=normalizeFastScan(scan());assert.throws(()=>validateLesson({...input,url:'https://example.com/private',phrase:a.phrases[0],duration:a.duration}));assert.throws(()=>validateLesson({...input,phrase:a.phrases[0],duration:9001}));});
test('app-wide provider cap includes simultaneous user lessons and queued enrichment',async()=>{const queue=new ProviderQueue(3);let active=0,peak=0;await Promise.all(Array.from({length:12},()=>queue.run(async()=>{active++;peak=Math.max(peak,active);await delay(8);active--;})));assert.equal(peak,3);assert.equal(queue.active,0);assert.equal(queue.waiters.length,0);});
test('queued provider task is removed immediately on cancellation',async()=>{const queue=new ProviderQueue(1),ctrl=new AbortController();let release;const first=queue.run(()=>new Promise(r=>release=r));await delay(0);const queued=queue.run(()=>{throw Error('must never start');},ctrl.signal);ctrl.abort();await assert.rejects(queued);release();await first;assert.equal(queue.waiters.length,0);});
for(const raw of ['https://www.youtube.com/watch?v=YaJ_lYFgr6c&list=RDeV9a5oUCbZQ&index=2','https://www.youtube.com/watch?v=4ULVNHHqbew&list=RD4ULVNHHqbew&start_radio=1']){
 test('provided QA link canonicalization: '+raw,()=>{const video=parseYouTube(raw);assert.equal(video.url,new URL(raw).origin+'/watch?v='+new URL(raw).searchParams.get('v'));});
}
async function server(t,runner){const s=createApp(config,{generate:runner});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(async()=>{s.closeAllConnections();await new Promise(r=>s.close(r));});return 'http://127.0.0.1:'+s.address().port;}
const post=(u,x)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(x)});
test('real HTTP response flushes ready before optional job is released',async t=>{
 let release;const blocked=new Promise(r=>release=r),a=normalizeFastScan(scan());
 const base=await server(t,async(x,k,c,s,f,emit)=>{emit({type:'ready',result:a});await blocked;return {...a,adaptive:{...a.adaptive,state:'complete',revision:2}};});
 const response=await post(base+'/api/analyze',input),reader=response.body.getReader();const {value}=await reader.read();const packets=new TextDecoder().decode(value).split('\n').filter(Boolean).map(JSON.parse);
 assert.ok(packets.some(p=>p.type==='ready'));assert.ok(!packets.some(p=>p.type==='done'));release();while(!(await reader.read()).done){};
});
test('real HTTP later-stage failure emits retained done partial, not fatal error',async t=>{
 const a=normalizeFastScan(scan());const base=await server(t,async(x,k,c,s,f,emit)=>{emit({type:'ready',result:a});throw new AppError('stage8',502,'GEMINI_500');});
 const packets=(await (await post(base+'/api/analyze',input)).text()).trim().split('\n').map(JSON.parse);assert.ok(!packets.some(p=>p.type==='error'));const last=packets.at(-1);assert.equal(last.type,'done');assert.equal(last.result.adaptive.state,'partial');assert.equal(last.result.phrases.length,20);
});
test('real HTTP /api/lesson is validated and does not start an analysis job',async t=>{let seen;const a=normalizeFastScan(scan());const base=await server(t,async(x,k)=>{seen={x,k};return {focus:'原創測試',instruction:'輕聲',pronunciation:'',exercise:'',caution:''};});const res=await post(base+'/api/lesson',{...input,duration:a.duration,phrase:a.phrases[1]});assert.equal(res.status,200);await res.text();assert.equal(seen.k,'lesson');assert.equal(seen.x.listeningWindow.clipStart,7);});
test('server disconnect aborts outstanding enrichment work',async t=>{let aborted=false;const a=normalizeFastScan(scan());const base=await server(t,async(x,k,c,signal,f,emit)=>{emit({type:'ready',result:a});await new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));return a;});const ctrl=new AbortController();const response=await fetch(base+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:ctrl.signal});await response.body.getReader().read();ctrl.abort();for(let i=0;i<30&&!aborted;i++)await delay(10);assert.ok(aborted);});
test('NDJSON client delivers ready/update in sequence even when chunks split Chinese bytes',async()=>{
 const old=globalThis.fetch,a=normalizeFastScan(scan(1)),seen=[];const text=[{type:'ready',result:a},{type:'update',result:{...a,adaptive:{...a.adaptive,revision:2}}},{type:'done',result:a}].map(x=>JSON.stringify(x)+'\n').join('');const bytes=new TextEncoder().encode(text);
 globalThis.fetch=async()=>new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}));
 try{const r=await clientAnalyze('/api/analyze',{},()=>{},undefined,async p=>{await delay(1);seen.push(p.type);assert.equal(p.result.phrases[0].tokens[0].text,'微');});assert.deepEqual(seen,['ready','update']);assert.equal(r.phrases.length,1);}finally{globalThis.fetch=old;}
});
test('NDJSON disconnect after ready retains result with partial state',async()=>{const old=globalThis.fetch,a=normalizeFastScan(scan(1));globalThis.fetch=async()=>new Response(JSON.stringify({type:'ready',result:a})+'\n');try{const r=await clientAnalyze('/api/analyze',{},()=>{});assert.equal(r.adaptive.state,'partial');assert.equal(r.phrases.length,1);}finally{globalThis.fetch=old;}});
test('NDJSON explicit error before ready is not silently swallowed',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({type:'error',error:'Unavailable',code:'SOURCE_UNAVAILABLE'})+'\n');try{await assert.rejects(clientAnalyze('/api/analyze',{},()=>{}),e=>e.code==='SOURCE_UNAVAILABLE');}finally{globalThis.fetch=old;}});
