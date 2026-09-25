/** Non-destructive QA. Synthetic provider responses only; no Google/YouTube traffic. */
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {providerRequest,newProviderRuntime,classifyHttp} from '../../server/provider-client.mjs';
import {ProviderQueue} from '../../server/provider-queue.mjs';
import {analyze as clientAnalyze} from '../../public/modules/api.mjs';
import {generate} from '../../server/gemini.mjs';
import {createApp} from '../../server/index.mjs';
import {analyzeAdaptive,normalizeFastScan} from '../../server/adaptive.mjs';
import {normalizeAnalysis} from '../../shared/schema.mjs';
import {normalizeTeachingBatch,teachingCoverage,buildTeachingBatches} from '../../shared/annotations.mjs';
import {normalizeWordDetails,applyWordDetails} from '../../server/word-details.mjs';
import {parseYouTube} from '../../shared/music.mjs';
import {AppError,validateInput} from '../../server/validation.mjs';
import {syntheticTeaching,wave} from '../../tests/fixtures/listening-fixture.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.env.SF_QA_OUT||path.join(ROOT,'test-results/stress-20260925');mkdirSync(OUT,{recursive:true});
const results=[];let callsTotal=0;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(x,m='Acceptance condition failed')=>{if(!x)throw Error(m);};
async function check(id,name,fn,severity='none'){
 const t=performance.now();let row={id,name,severity};
 try{const detail=await fn();row={...row,result:'passed',detail};}
 catch(e){row={...row,result:'failed',detail:e.qaDetail||undefined,error:e.message};}
 row.ms=Math.round((performance.now()-t)*100)/100;results.push(row);console.log(row.result.toUpperCase(),id,name,row.error||'');
 writeFileSync(path.join(OUT,'stress-results.json'),JSON.stringify({scope:'Unmodified Singing Fox v1.2.2 with explicit synthetic external-provider responses and real localhost HTTP',version:'1.2.2',results},null,2));
}
function fail(message,detail){const e=Error(message);e.qaDetail=detail;throw e;}
const baseConfig=()=>({apiKey:'QA_ONLY_NOT_A_REAL_KEY',model:'gemini-3.8-flash',timeout:4000,attemptTimeoutMs:400,passBudgetMs:2000,retryDelays:[0,0,0],providerRuntime:newProviderRuntime(),host:'127.0.0.1',origin:'',accessCode:'',production:false});
const v=(name='primary')=>({name,url:'https://qa.invalid',body:{synthetic:true},decode:d=>d});
const response=(data={},status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
const envelope=raw=>response({status:'completed',output_text:JSON.stringify(raw)});
const rawScan=(n=20,complete=true)=>({status:'ok',reason:'',title:'STRESS FIXTURE — NOT a YouTube transcription',artist:'Original QA',language:'mandarin',duration:n*8+2,complete,phrases:Array.from({length:n},(_,i)=>({text:'微光同行',start:i*8+1,end:i*8+6,section:i%2?'副歌':'主歌',confidence:.96}))});
const input={source:'youtube',url:'https://www.youtube.com/watch?v=J2uD1UXLTVs',id:'J2uD1UXLTVs',language:'auto'};
const go=(fetcher,patch={},variants=[v()])=>providerRequest(variants,{...baseConfig(),...patch},new AbortController().signal,async(...a)=>{callsTotal++;return fetcher(...a);},{kind:'fast-scan'});
for(const status of [408,425,429,500,502,503,504])await check('P'+status,`HTTP ${status} retries three times then succeeds`,async()=>{let n=0;const r=await go(async()=>response(++n<4?{error:{message:'synthetic transient'}}:{ok:true},n<4?status:200));assert(n===4&&r.ok);return {attempts:n};});
for(const status of [401,402,403])await check('T'+status,`HTTP ${status} stops without repeated charge attempts`,async()=>{let n=0,e;try{await go(async()=>{n++;return response({},status);});}catch(x){e=x;}assert(n===1&&e?.code==='GEMINI_'+status);return {attempts:n,code:e.code};});
await check('P503X','Persistent 503 exits after four attempts',async()=>{let n=0,e;try{await go(async()=>{n++;return response({},503);});}catch(x){e=x;}assert(n===4&&e.code==='GEMINI_503');return {attempts:n};});
await check('QDAY','Permanent daily quota stops immediately',async()=>{let n=0,e;try{await go(async()=>{n++;return response({error:{message:'Daily quota per day exceeded'}},429);});}catch(x){e=x;}assert(n===1&&e.quotaPermanent);return {attempts:n};});
await check('QWAIT','Retry-After is respected',async()=>{const times=[];await go(async()=>{times.push(Date.now());return times.length===1?response({},429,{'Retry-After':'0.05'}):response({ok:1});});assert(times[1]-times[0]>=45);return {delayMs:times[1]-times[0]};});
await check('QBUDGET','Retry-After beyond budget stops instead of sleeping',async()=>{let n=0,e;const t=Date.now();try{await go(async()=>{n++;return response({},429,{'Retry-After':'600'});},{passBudgetMs:100});}catch(x){e=x;}assert(n===1&&Date.now()-t<500&&e.code==='GEMINI_429');return {attempts:n,ms:Date.now()-t};});
await check('BODYJSON','Malformed outer HTTP JSON is retried',async()=>{let n=0;const r=await go(async()=>++n<4?new Response('{broken'):response({ok:true}));assert(r.ok&&n===4);return {attempts:n};});
await check('BODYRESET','Reset after HTTP headers is retried',async()=>{let n=0;const r=await go(async()=>{if(++n===4)return response({ok:true});return new Response(new ReadableStream({start(c){c.error(new Error('synthetic socket reset'));}}));});assert(r.ok&&n===4);return {attempts:n};});
await check('HEADERSTALL','Hanging header request has a hard deadline',async()=>{let e;const t=Date.now();try{await go(()=>new Promise(()=>{}),{attemptTimeoutMs:20,passBudgetMs:75});}catch(x){e=x;}assert(e.code==='TIMEOUT'&&Date.now()-t<300);return {ms:Date.now()-t};});
await check('BODYSTALL','Hanging HTTP body has a hard deadline',async()=>{let e;const t=Date.now();try{await go(async()=>new Response(new ReadableStream({start(){}})),{attemptTimeoutMs:20,passBudgetMs:75});}catch(x){e=x;}assert(e.code==='TIMEOUT'&&Date.now()-t<300);return {ms:Date.now()-t};});
await check('CANCEL','Cancellation stops provider retry chain',async()=>{const c=new AbortController();let n=0;setTimeout(()=>c.abort(),15);let e;try{await providerRequest([v()],{...baseConfig(),retryDelays:[100,100,100]},c.signal,async()=>{n++;return response({},503);});}catch(x){e=x;}assert(n===1&&e.code==='CANCELLED');return {attempts:n};});
await check('SECRET','Provider diagnostics do not expose request keys',async()=>{const events=[];await go(async()=>response({ok:true}),{onDiagnostic:e=>events.push(e)});assert(!JSON.stringify(events).includes('QA_ONLY_NOT_A_REAL_KEY'));return {events:events.length};});
await check('MIXED','Compatibility failures and transient retries share four attempts',async()=>{let n=0,e;try{await go(async()=>response({},++n===1?400:503),{},['a','b','c','d'].map(v));}catch(x){e=x;}assert(n===4&&e.code==='GEMINI_503');return {attempts:n};});
await check('SWARM','200 bounded provider jobs with deterministic injected failures recover',async()=>{
 const q=new ProviderQueue(3);let active=0,peak=0,calls=0;const expected=Array.from({length:200},(_,i)=>(i*7+3)%4+1);
 await Promise.all(expected.map(async(successAt,i)=>{let n=0;await q.run(()=>go(async()=>{calls++;active++;peak=Math.max(peak,active);await pause(1);active--;return ++n<successAt?response({},[503,429,502][i%3]):response({ok:true});}));assert(n===successAt);}));
 assert(peak<=3&&q.active===0&&q.waiters.length===0);return {jobs:200,calls,peakProviderCalls:peak,remainingWaiters:q.waiters.length};
});
const urls=[['eV9a5oUCbZQ','https://www.youtube.com/watch?v=eV9a5oUCbZQ&list=RDMMYaJ_lYFgr6c&index=2'],['J2uD1UXLTVs','https://www.youtube.com/watch?v=J2uD1UXLTVs&list=RDMMYaJ_lYFgr6c&index=3'],['miBGaUagOz8','https://www.youtube.com/watch?v=miBGaUagOz8&list=RDMMYaJ_lYFgr6c&index=7']];
for(const [id,url] of urls)await check('URL-'+id,'Exact requested video is selected, not playlist',async()=>{const p=parseYouTube(url);assert(p.id===id&&p.url===`https://www.youtube.com/watch?v=${id}`);return {id,url:p.url,scope:'URL parser only, no audio test'};});
for(const url of ['https://youtube.com.evil.invalid/watch?v=J2uD1UXLTVs','file:///etc/passwd','https://u:p@youtube.com/watch?v=J2uD1UXLTVs','https://www.youtube.com/watch?v=bad'])await check('URL-REJECT-'+results.length,'Untrusted or malformed source is rejected',async()=>{assert(parseYouTube(url)===null);return {rejected:true};});
function adaptiveResponder(raw,{failBatch,allUnavailable=false,missing=false,delay=0}={}){return async(rec,kind,signal)=>{if(kind==='fast-scan')return {raw};if(delay)await pause(delay);if(signal?.aborted)throw signal.reason;if(rec.teachingBatch?.index===failBatch)throw new AppError('Synthetic eighth batch failure',502,'GEMINI_500');return normalizeTeachingBatch(allUnavailable?{status:'unavailable',phrases:[]}:missing?{status:'ok',phrases:[]}:syntheticTeaching(rec.teachingBatch.phrases),rec.teachingBatch);};}
await check('PART8','Eighth teaching batch failure preserves earlier and later lyrics',async()=>{const a=await analyzeAdaptive(input,adaptiveResponder(rawScan(80),{failBatch:7}));assert(a.phrases.length===80&&a.adaptive.state==='partial'&&a.phrases[79].tokens[0].technique==='chest');return {phrases:a.phrases.length,state:a.adaptive.state,failedTasks:a.adaptive.failedTasks};});
await check('READY','Usable result arrives before enrichment completes',async()=>{let ready=false,atReady=0;let optional=0;const fn=adaptiveResponder(rawScan(16),{delay:8});await analyzeAdaptive(input,async(...args)=>{if(args[1]!=='fast-scan')optional++;return fn(...args);},{onProgress:e=>{if(e.type==='ready'){ready=true;atReady=optional;}}});assert(ready&&atReady===0);return {optionalCallsBeforeReady:atReady};});
await check('INC-SCAN','Incomplete transcript cannot be reported as fully complete',async()=>{const a=await analyzeAdaptive(input,adaptiveResponder(rawScan(3,false)));const detail={state:a.adaptive.state,completeScan:a.adaptive.completeScan,phrases:a.phrases.length};if(a.adaptive.state==='complete')fail('Final state says complete although completeScan is false',detail);return detail;},'P1');
await check('INC-LABELS','Omitted annotations after repair cannot be reported as complete',async()=>{const a=await analyzeAdaptive(input,adaptiveResponder(rawScan(3),{missing:true}));const detail={state:a.adaptive.state,coverage:teachingCoverage(a),calls:a.adaptive.calls};if(a.adaptive.state==='complete'&&teachingCoverage(a).missing)fail('All omitted labels still produce complete state',detail);return detail;},'P1');
await check('WHY-PARTIAL','Partial result includes safe failure codes for diagnosis',async()=>{const a=await analyzeAdaptive(input,adaptiveResponder(rawScan(24),{allUnavailable:true}));const detail={state:a.adaptive.state,failedTasks:a.adaptive.failedTasks,hasFailureCodes:JSON.stringify(a).includes('TEACHING_UNAVAILABLE')};if(!detail.hasFailureCodes)fail('The application discards per-task failure codes before returning/reporting partial',detail);return detail;},'P1');
await check('INNER-JSON','Transient malformed generated JSON is recovered within bounded retries',async()=>{let n=0,e;try{await generate(input,'fast-scan',baseConfig(),new AbortController().signal,async()=>{n++;return n===1?response({status:'completed',output_text:'{"unfinished":'}):envelope(rawScan(3));});}catch(x){e=x;}if(e)fail('Model-text JSON failure exits without trying the following valid response',{attempts:n,code:e.code});assert(n===2);return {attempts:n};},'P2');
await check('SCAN-NO-TEXT','Empty successful response never invents song lyrics',async()=>{let e;try{await analyzeAdaptive(input,adaptiveResponder({...rawScan(1),phrases:[]}));}catch(x){e=x;}assert(e);return {rejected:true};});
await check('WORD-CURRENT-BOUNDS','Late word details respect newly refined phrase boundaries',async()=>{
 const a=normalizeFastScan(rawScan(1));const batch=buildTeachingBatches(a)[0];
 const raw={timeBase:'source_seconds',phrases:[{id:'p0',tokens:batch.phrases[0].tokens.map((t,i)=>({...t,start:1+i*.8,end:1.5+i*.8,romanization:'',confidence:'high'}))}]};
 const details=normalizeWordDetails(raw,batch,{clipStart:0});a.phrases[0].start=2;applyWordDetails(a,details);
 let error;try{normalizeAnalysis(a);}catch(e){error=e.message;}
 if(error)fail('A late teaching response inserts word times outside revised phrase; normalization then throws',{phraseStart:2,wordStart:a.phrases[0].tokens[0].start,error});return {normalized:true};
},'P1');
await check('CLOCK-UNKNOWN','Unknown word time stays line-only, never invented',async()=>{const a=normalizeFastScan(rawScan(12));assert(a.phrases.every(p=>p.tokens.every(t=>t.start===null&&t.end===null&&t.timingMode==='line')));return {phrases:12};});
await check('STATUS-KEY','Status reports readiness without exposing key',async()=>{await withApp(async(base)=>{const r=await fetch(base+'/api/status');const text=await r.text();assert(r.status===200&&!text.includes('QA_ONLY_NOT_A_REAL_KEY')&&JSON.parse(text).configured);});return {secretExposed:false};});
async function withApp(fn,{patch={},runner=async()=>normalizeFastScan(rawScan(3)),preparsed}={}){
 const app=createApp({...baseConfig(),...patch},{generate:runner});let s=app;
 if(preparsed!==undefined)s=createServer((req,res)=>{req.body=preparsed;app.handle(req,res);});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${s.address().port}`;
 try{return await fn(base,s);}finally{s.closeAllConnections();await new Promise(r=>s.close(r));if(s!==app)app.close();}
}
const post=(base,data=input,headers={})=>fetch(base+'/api/analyze',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
await check('HOST','Forged Host is rejected before provider usage',async()=>{let n=0;await withApp(async(base)=>{const status=await new Promise((resolve,reject)=>{const q=httpRequest(base+'/api/status',{headers:{host:'evil.invalid'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});q.on('error',reject);q.end();});assert(status===403);},{runner:async()=>{n++;return {};}});assert(n===0);return {providerCalls:n};});
await check('CSRF','Cross-site POST rejected before provider usage',async()=>{let n=0;await withApp(async(base)=>{const r=await post(base,input,{origin:'https://evil.invalid','sec-fetch-site':'cross-site'});assert(r.status===403);await r.text();},{runner:async()=>{n++;return {};}});assert(n===0);return {providerCalls:n};});
await check('PRIVACY','Environment and server files not served',async()=>{const codes=[];await withApp(async(base)=>{for(const suffix of ['/.env','/server/config.mjs','/.git/config']){const r=await fetch(base+suffix);codes.push(r.status);await r.text();assert([403,404].includes(r.status));}});return {codes};});
await check('HTTP-BAD','Malformed JSON body rejected before analysis',async()=>{let n=0;await withApp(async(base)=>{const r=await fetch(base+'/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:'{'});assert(r.status===400);await r.text();},{runner:async()=>{n++;return {};}});assert(n===0);return {providerCalls:n};});
await check('UPLOAD-CAP','Hosted payload limit rejects oversize audio safely',async()=>{let n=0;const audioData=wave(120).toString('base64');const payload={source:'upload',audioData,language:'auto',fileName:'QA-120s.wav'};const byteLength=Buffer.byteLength(JSON.stringify(payload));await withApp(async(base)=>{const r=await post(base,payload);assert(r.status===413);await r.text();},{patch:{maxBodyBytes:4000000},runner:async()=>{n++;return {};}});assert(n===0);return {seconds:120,jsonBytes:byteLength,limit:4000000,providerCalls:n};});
await check('UPLOAD-PROMISE','UI advertised six-minute upload fits hosted body limit',async()=>{const cap=4000000,maxSeconds=Math.floor((cap-10000)*3/4/32000);const claims=readFileSync(path.join(ROOT,'public/app.mjs'),'utf8').includes('最多 6 分鐘、50 MB');if(claims&&maxSeconds<360)fail('Advertised six-minute audio exceeds hosted JSON upload capacity',{advertisedSeconds:360,approxHostedSeconds:maxSeconds,hostedBodyBytes:cap});return {claims,maxSeconds};},'P2');
await check('ADMISSION-RACE','Eight slow simultaneous POSTs respect three-job limit',async()=>{
 let active=0,peak=0,invoked=0,codes=[];
 await withApp(async(base)=>{
  const reqs=[];const promises=Array.from({length:8},()=>new Promise((resolve,reject)=>{const req=httpRequest(base+'/api/analyze',{method:'POST',headers:{'content-type':'application/json'}},res=>{codes.push(res.statusCode);res.resume();res.on('end',resolve);});req.on('error',reject);req.write('{"source":"youtube",');reqs.push(req);}));
  await pause(35);for(const req of reqs)req.end('"url":"https://www.youtube.com/watch?v=J2uD1UXLTVs","language":"auto"}');await Promise.all(promises);
 },{runner:async()=>{active++;invoked++;peak=Math.max(peak,active);await pause(45);active--;return normalizeFastScan(rawScan(1));}});
 if(peak>3)fail('inflight check is before await body(); overlapping bodies bypass the limit',{requests:8,peakActiveJobs:peak,invoked,statuses:codes});return {peak,invoked};
},'P1');
await check('HTTP-SOAK','120 sequential local HTTP jobs release resources and preserve state',async()=>{let total=0;const start=performance.now();for(let batch=0;batch<8;batch++)await withApp(async(base)=>{for(let i=0;i<15;i++){const r=await post(base);assert(r.status===200);const packets=(await r.text()).trim().split('\n').map(x=>JSON.parse(x));assert(packets.at(-1).type==='done'&&packets.at(-1).result.phrases.length===3);total++;}});return {jobs:total,ms:Math.round(performance.now()-start)};});
await check('LIMIT-RECOVERY','Rate-limit responses include Retry-After guidance',async()=>{let last;await withApp(async(base)=>{for(let i=0;i<21;i++){const r=await post(base);last={status:r.status,retryAfter:r.headers.get('retry-after')};await r.text();}});assert(last.status===429);if(!last.retryAfter)fail('Application 429 has no Retry-After header',last);return last;},'P2');
await check('CACHE-INFLIGHT','Three simultaneous identical songs share one initial scan',async()=>{
 const config={...baseConfig(),providerQueue:new ProviderQueue(3)};let n=0;const f=async()=>{n++;await pause(20);return envelope(rawScan(3));};
 await Promise.all(Array.from({length:3},()=>generate(input,'fast-scan',config,new AbortController().signal,f)));
 const concurrent=n;await generate(input,'fast-scan',config,new AbortController().signal,f);
 if(concurrent>1)fail('Cold concurrent requests duplicate the expensive first scan; only finished results are cached',{coldRequests:3,firstScanProviderCalls:concurrent,callsAfterWarmHit:n});return {n};
},'P2');
await check('SOURCE-POLICY','Blocked model output stops rather than trying to bypass policy',async()=>{let n=0,e;try{await generate({...input,source:'upload',audioData:wave(1).toString('base64')},'fast-scan',baseConfig(),new AbortController().signal,async()=>{n++;return response({candidates:[{finishReason:'SAFETY'}]});});}catch(x){e=x;}assert(n===1&&e.code==='SOURCE_POLICY');return {attempts:n,code:e.code};});
await check('BROWSER-ENDLESS','Continuing heartbeats have no overall client deadline',async()=>{
 const realFetch=globalThis.fetch,c=new AbortController();let timer,settled=false,error;
 globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){timer=setInterval(()=>controller.enqueue(new TextEncoder().encode('{"type":"heartbeat"}\n')),5);},cancel(){clearInterval(timer);}}));
 const t=Date.now();const job=clientAnalyze('http://qa.invalid',{},()=>{},c.signal,()=>{},{headersMs:30,idleMs:30}).catch(e=>{error=e;}).finally(()=>settled=true);
 try{await pause(160);const before=settled;c.abort();await job;if(!before)fail('Loader survives more than five idle-watchdog periods with heartbeat-only data; no total bound exists',{observedMs:Date.now()-t,idleLimitMs:30,completedWithoutManualCancel:before});}
 finally{clearInterval(timer);globalThis.fetch=realFetch;}
},'P2');
await check('LIVE-VERIFIER-VERSION','Packaged live verifier accepts the deployed adaptive version',async()=>{
 const s=readFileSync(path.join(ROOT,'scripts/verify-live.mjs'),'utf8');const schema=readFileSync(path.join(ROOT,'shared/adaptive-schema.mjs'),'utf8');
 if(s.includes("result.adaptive?.version==='adaptive-recording-v1'")&&schema.includes("ADAPTIVE_VERSION='adaptive-recording-v2'"))fail('Live verification is hard-coded to v1, while every new score declares v2',{verifierExpected:'adaptive-recording-v1',pipelineEmits:'adaptive-recording-v2'});return {};
},'P1');
await check('LIVE-URL-STRICT','Diagnostic never silently substitutes a different song',async()=>{
 const s=readFileSync(path.join(ROOT,'scripts/diagnose.mjs'),'utf8');
 const supplied='[https://www.youtube.com/watch?v=eV9a5oUCbZQ](https://www.youtube.com/watch?v=eV9a5oUCbZQ)';
 const selected=['node','scripts/diagnose.mjs',supplied].find(a=>/^https?:\/\//.test(a))||'https://www.youtube.com/watch?v=J2uD1UXLTVs';
 if(s.includes('const source=process.argv.find') && s.includes("||'https://www.youtube.com/watch?v=J2uD1UXLTVs'")&&parseYouTube(selected).id!=='eV9a5oUCbZQ')fail('Markdown-wrapped URL falls through to hard-coded J2uD1UXLTVs instead of rejecting input',{intended:'eV9a5oUCbZQ',selected:parseYouTube(selected).id,scope:'Direct evaluation of diagnostic argument selection; no network call'});return {};
},'P1');
await check('RACE-FULL-PIPELINE','Concurrent timing review and old teaching result do not crash assembly',async()=>{
 const raw=rawScan(3);raw.phrases[0].confidence=.75;let reviews=0,ready=false,code;
 try{await analyzeAdaptive(input,async(rec,kind)=>{
  if(kind==='fast-scan')return {raw};
  if(kind==='listen-review'){reviews++;const w=rec.listeningWindow;return {raw:{status:'ok',window_id:w.id,time_base:'source_seconds',content:'vocals',lines:[{text:'微光同行',start:1.4,end:6,section:'主歌',confidence:'high',words:Array.from('微光同行',text=>({text,start:null,end:null,confidence:'high',romanization:''}))}]}};}
  await pause(15);const batch=rec.teachingBatch;const r=normalizeTeachingBatch(syntheticTeaching(batch.phrases),batch);
  r.wordDetails=new Map(batch.phrases.flatMap(p=>p.tokens.map((t,i)=>[t.id,{start:p.start+i*.8,end:p.start+i*.8+.5,confidence:'high',romanization:''}])));return r;
 },{onProgress:e=>{if(e.type==='ready')ready=true;}});}
 catch(e){code=e.message;}
 if(code)fail('Full adaptive orchestrator throws on stale teaching after a legitimate line-only timing correction',{readyWasDelivered:ready,reviewCalls:reviews,error:code});return {ready,reviews};
},'P1');
const summary={checkedAt:new Date().toISOString(),version:'1.2.2',sourceChanged:false,externalCalls:0,tests:results.length,passed:results.filter(r=>r.result==='passed').length,failed:results.filter(r=>r.result==='failed').length,syntheticProviderAttempts:callsTotal,results};
writeFileSync(path.join(OUT,'stress-results.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({tests:summary.tests,passed:summary.passed,failed:summary.failed,syntheticProviderAttempts:callsTotal}));
process.exitCode=summary.failed?1:0;
