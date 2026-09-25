import test from 'node:test';
import assert from 'node:assert/strict';
import {listeningWindows,normalizeSurvey,sliceWave,normalizeListening,compareListening,mergeListening,analyzeByListening,orderedMatches,wordKey} from '../server/listening.mjs';
import {requestBody,interactionsBody,generate} from '../server/gemini.mjs';
import {listeningPrompt} from '../server/listening-prompts.mjs';
import {normalizeAnalysis} from '../shared/schema.mjs';
import {tokenLyricState} from '../shared/lyric-clock.mjs';
import {annotateTranscript} from '../server/teaching.mjs';
import {normalizeTeachingBatch} from '../shared/annotations.mjs';
import {demo,wave,syntheticListening,syntheticTeaching,completedFor} from './fixtures/listening-fixture.mjs';
const copy=x=>structuredClone(x);
const survey={status:'ok',reason:'',title:'原創聆聽測試',artist:'',language:'mandarin',duration:49.25};
const input={source:'youtube',url:'https://www.youtube.com/watch?v=YaJ_lYFgr6c',language:'mandarin'};
const config={apiKey:'FAKE-testing-only',model:'gemini-3.8-flash',timeout:6000,retryDelays:[0,0,0]};
const win=listeningWindows(survey.duration);
const pass=(w=win[0],raw=syntheticListening(w))=>({...normalizeListening(raw,w),review:'ai-agreement'});
function observation(w,text,start=2,{wordTimes=true,confidence='high'}={}){
 const words=Array.from(text).map((c,i)=>({text:c,romanization:'',start:wordTimes?start+i*.6:null,end:wordTimes?start+i*.6+.5:null,confidence}));
 return {status:'ok',reason:'',window_id:w.id,time_base:'source_seconds',content:'vocals',lines:[{text,start,end:start+(text.length-1)*.6+.5,section:'樂句',confidence,words}]};
}
function sourceScore(duration=49.25){return {...survey,duration};}
function mockRequest(log=[],change){return async(i,kind,signal)=>{
 log.push({i:copy(i),kind});if(signal?.aborted)throw signal.reason;
 const raw=kind==='survey'?copy(survey):syntheticListening(i.listeningWindow);
 return {raw:change?change(raw,i,kind):raw,usage:{inputTokens:2,outputTokens:3}};
};}

test('listening windows cover every second, including a final short core',()=>{
 assert.equal(win.length,3);assert.deepEqual(win.map(w=>[w.coreStart,w.coreEnd]),[[0,24],[24,48],[48,49.25]]);
 assert.deepEqual([win[1].clipStart,win[1].clipEnd],[20,49.25]);
 assert.equal(win[0].clipStart,0);assert.equal(win.at(-1).clipEnd,49.25);
});
test('recording scan covers later verses beyond old six-minute limit',()=>{
 const w=listeningWindows(812.4);assert.equal(w.at(-1).coreEnd,812.4);
 for(let i=1;i<w.length;i++)assert.equal(w[i].coreStart,w[i-1].coreEnd);
 assert.ok(w.some(x=>x.coreStart>360));
});
test('out-of-bound durations fail explicitly; no silent crop',()=>{for(const x of [0,-1,901,NaN,Infinity])assert.throws(()=>listeningWindows(x));});
test('invalid window-size configuration is rejected',()=>{assert.throws(()=>listeningWindows(50,{size:0}));assert.throws(()=>listeningWindows(50,{context:-1}));});
test('upload sample-count duration overrides survey estimate',()=>{assert.equal(normalizeSurvey({...survey,duration:100},{duration:37.4}).duration,37.4);});
test('YouTube survey length is required rather than guessed as 360',()=>{for(const duration of [null,'49.25',0,901])assert.throws(()=>normalizeSurvey({...survey,duration}));});
test('source unavailable is not interpreted as an instrumental section',()=>{assert.throws(()=>normalizeSurvey({status:'unavailable'}),e=>e.code==='SOURCE_UNAVAILABLE');assert.throws(()=>normalizeListening({status:'unavailable'},win[0]),e=>e.code==='SOURCE_UNAVAILABLE');});
test('WAV listening windows contain actual sliced samples, not a full-file prompt',()=>{
 const full=wave(50),clip=Buffer.from(sliceWave(full.toString('base64'),{clipStart:20,clipEnd:24.5}),'base64');
 assert.equal(clip.length,44+4.5*32000);assert.equal(clip.readUInt32LE(40),4.5*32000);
 assert.equal(clip.readInt16LE(44),full.readInt16LE(44+20*32000));assert.deepEqual(clip.subarray(44),full.subarray(44+20*32000,44+24.5*32000));
});
test('WAV clips outside the sample-count duration are rejected',()=>{const wav=wave(1).toString('base64');assert.throws(()=>sliceWave(wav,{clipStart:0,clipEnd:2}));});
test('Interactions listening requests use documented duration-string clipping offsets',()=>{
 const b=interactionsBody({...input,listeningWindow:win[1]},'listen');assert.deepEqual(b.input[0].processing,{type:'static',start_offset:'20s',end_offset:'49.25s'});assert.equal(b.store,false);
 const fallback=interactionsBody({...input,listeningWindow:win[1]},'listen','gemini-3.8-flash',{windowMode:'source-target'});assert.equal(fallback.input[0].processing,'static');assert.match(fallback.input[1].text,/source_seconds/);
});
test('legacy fallback keeps the full source and targets the same absolute source range in prompt',()=>{
 const b=requestBody({...input,listeningWindow:win[1]},'listen');assert.equal(b.contents[0].parts[0].videoMetadata,undefined);assert.match(b.contents[0].parts[1].text,/20\.000 至 49\.250/);assert.match(b.contents[0].parts[1].text,/source_seconds/);
});
test('clip offset is applied once and only once',()=>{
 const r=syntheticListening(win[1]),n=normalizeListening(r,win[1]);assert.equal(n.lines[0].tokens[0].start,r.lines[0].words[0].start+20);
 const absolute=copy(r);absolute.time_base='source_seconds';for(const l of absolute.lines){l.start+=20;l.end+=20;for(const t of l.words){t.start+=20;t.end+=20;}}
 assert.deepEqual(normalizeListening(absolute,win[1]).lines,n.lines);
});
test('missing coordinate declaration or stale window ID cannot shift a score',()=>{for(const patch of [{window_id:'w999'},{time_base:'unknown'}])assert.throws(()=>normalizeListening({...syntheticListening(win[1]),...patch},win[1]),e=>e.code==='LISTENING_COORDINATES');});
test('out-of-window and string word times become unknown, not guessed seconds',()=>{
 for(const patch of [{start:300,end:301},{start:'2.5',end:3},{start:-1,end:1}]){
 const r=syntheticListening(win[0]);Object.assign(r.lines[0].words[0],patch);const n=normalizeListening(r,win[0]);assert.equal(n.lines[0].tokens[0].start,null);assert.ok(n.issues>0);
 }
});
test('missing word entries preserve complete recognized line without interpolation',()=>{
 const r=observation(win[0],'晨光陪我');r.lines[0].words.splice(1,1);const n=normalizeListening(r,win[0]);
 assert.equal(n.lines[0].tokens.map(t=>t.text).join(''),'晨光陪我');assert.equal(n.lines[0].tokens[1].start,null);
 assert.equal(n.lines[0].tokens[2].start,3.2);
});
test('multi-character spans never acquire duplicated fake per-character times',()=>{
 const r=observation(win[0],'晨光');r.lines[0].words=[{text:'晨光',romanization:'',start:2,end:3.1,confidence:'high'}];
 const n=normalizeListening(r,win[0]);assert.deepEqual(n.lines[0].tokens.map(t=>t.start),[null,null]);
});
test('unclear audible placeholders are retained rather than silently deleted',()=>{
 const r=observation(win[0],'晨□光');const n=normalizeListening(r,win[0]);assert.equal(n.lines[0].text,'晨□光');assert.equal(wordKey('□'),'□');
});
test('contradictory no-vocals plus lyrics is a format failure',()=>{assert.throws(()=>normalizeListening({...syntheticListening(win[0]),content:'no_vocals'},win[0]));});
test('unknown timing uses line bounds but never fills gold word positions',()=>{
 const score=mergeListening([pass(win[0],observation(win[0],'晨光陪我',2,{wordTimes:false}))],survey),p=score.phrases[0];
 assert.equal(p.start,2);assert.ok(p.tokens.every(t=>t.start===null&&t.timingMode==='line'));assert.equal(score.listening.lineOnly,4);
 assert.ok(p.tokens.every(t=>tokenLyricState(t,p,3)==='upcoming'));assert.ok(p.tokens.every(t=>tokenLyricState(t,p,9)==='played'));
});
test('word confidence is separate from teaching confidence',()=>{
 const score=mergeListening([pass()],survey),t=score.phrases[0].tokens[0];assert.equal(t.timingConfidence,'high');assert.equal(t.confidence,'low');assert.equal(t.timingMode,'word');
});
test('wholly untimed text remains readable outside the synchronized score',()=>{
 const r=observation(win[0],'仍然聽見',2,{wordTimes:false});r.lines[0].start=null;r.lines[0].end=null;
 const score=mergeListening([pass(win[0],r)],survey);assert.equal(score.phrases.length,0);assert.deepEqual(score.unalignedLyrics,['仍然聽見']);
});
test('monotone merge keeps three rapid repeated words as three occurrences',()=>{
 const pairs=orderedMatches(['啦','啦','啦'],['啦','啦','啦'],(a,b)=>a===b?1:0);assert.deepEqual(pairs,[[0,0],[1,1],[2,2]]);
});
test('overlap joins split lines without losing or doubling boundary words',()=>{
 const a=pass(win[0],observation(win[0],'晨光陪我',23.5));
 const b=pass(win[1],observation(win[1],'晨光陪我',23.5));
 const merged=mergeListening([a,b],survey);assert.equal(merged.phrases.flatMap(p=>p.tokens).map(t=>t.text).join(''),'晨光陪我');assert.equal(merged.listening.mergedOverlapWords,4);
});
test('same words in a later chorus are never globally deduplicated',()=>{
 const a=pass(win[0],observation(win[0],'晨光',2));const b=pass(win[1],observation(win[1],'晨光',35));
 const merged=mergeListening([a,b],survey);assert.equal(merged.phrases.length,2);assert.deepEqual(merged.phrases.map(p=>p.start),[2,35]);
});
test('different overlap estimates are marked uncertain instead of averaged',()=>{
 const a=pass(win[0],observation(win[0],'晨光',23));const b=pass(win[1],observation(win[1],'晨光',23.7));
 const merged=mergeListening([a,b],survey);assert.ok(merged.listening.boundaryDisagreements>0);
 assert.ok(merged.phrases[0].tokens.every(t=>t.start===null&&t.timingReview==='boundary-disputed'));
});
test('all original synthetic demo words survive windowing and assembly',()=>{
 const score=mergeListening(win.map(w=>pass(w)),survey);assert.equal(score.phrases.length,demo.phrases.length);
 assert.equal(score.phrases.flatMap(p=>p.tokens).map(t=>t.text).join(''),demo.phrases.flatMap(p=>p.tokens).map(t=>t.text).join(''));
 assert.equal(score.phrases.at(-1).tokens.at(-1).end,demo.phrases.at(-1).tokens.at(-1).end);
});
test('lyric/timing disagreement triggers detection, not an agreement label',()=>{
 const a=pass(),r=syntheticListening(win[0]);r.lines[0].words[0].start+=.6;r.lines[0].words[0].end+=.6;const b=pass(win[0],r);
 assert.equal(compareListening(a,b).agreement,false);
});
test('matching AI outputs are explicitly not an acoustic accuracy certificate',()=>{
 const r=observation(win[0],'晨光',12);const a=pass(win[0],r),b=pass(win[0],copy(r));assert.equal(compareListening(a,b).agreement,true);
 const score=mergeListening([a],survey);assert.equal(score.listening.accuracyVerified,false);
 // Even identical wrong estimates can pass this consistency check. No measured
 // truth is available in this synthetic test; keep that distinction explicit.
});
test('second pass is blind: carries media and no first-pass draft or user lyric sheet',async()=>{
 const log=[];await analyzeByListening({...input,lyrics:'EXTERNAL_LYRIC_SENTINEL'},mockRequest(log));
 for(const c of log){assert.equal(c.i.lyrics,'');if(c.kind==='listen-review'){assert.equal(c.i.listeningDrafts,undefined);const b=interactionsBody(c.i,c.kind);assert.equal(b.input[0].uri,input.url);assert.ok(!JSON.stringify(b).includes('EXTERNAL_LYRIC_SENTINEL'));}}
 assert.equal(log.filter(c=>c.kind==='listen').length,3);assert.equal(log.filter(c=>c.kind==='listen-review').length,3);
});
test('a conflicting first draft causes a third media re-listen, not an average',async()=>{
 const log=[];const r=await analyzeByListening(input,mockRequest(log,(raw,i,kind)=>{
  if(kind==='listen'&&i.listeningWindow.id==='w000'){raw.lines[0].words[0].start+=.7;raw.lines[0].words[0].end+=.7;}
  return raw;
 }));assert.equal(log.filter(c=>c.kind==='listen-resolve').length,1);assert.equal(r.listening.relistenedWindows,1);
 assert.equal(r.phrases[0].tokens[0].start,demo.phrases[0].tokens[0].start);assert.equal(r.phrases[0].tokens[0].timingReview,'ai-relistened');
 const call=log.find(c=>c.kind==='listen-resolve');assert.equal(call.i.listeningDrafts.length,2);assert.equal(interactionsBody(call.i,call.kind).input[0].uri,input.url);
});
test('completion events reflect actual completed listening windows',async()=>{
 const events=[];await analyzeByListening(input,mockRequest(),{onProgress:e=>events.push(e)});
 const count=events.filter(e=>e.detail?.completedWindows!==undefined).map(e=>e.detail.completedWindows);
 assert.equal(count.at(-1),3);assert.ok(count.every((v,i)=>!i||v>=count[i-1]));
 assert.ok(!events.some(e=>/retry|重試/.test(e.message)));
});
test('bounded listening concurrency never exceeds two provider requests',async()=>{
 let active=0,max=0;const base=mockRequest();await analyzeByListening(input,async(...args)=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));try{return await base(...args);}finally{active--;}},{concurrency:99});assert.equal(max,2);
});
test('cancellation stops scheduling new listening or teaching work',async()=>{
 const c=new AbortController(),log=[];const base=mockRequest(log);await assert.rejects(analyzeByListening(input,async(...args)=>{const r=await base(...args);if(args[1]==='listen')c.abort(new Error('cancelled fixture'));return r;},{signal:c.signal}),/cancelled/);
 assert.ok(log.length<=3);assert.equal(log.filter(e=>e.kind==='listen-review').length,0);
});
test('a fatal middle-window failure does not silently return first-verse-only success',async()=>{
 const base=mockRequest();await assert.rejects(analyzeByListening(input,async(...args)=>{if(args[0].listeningWindow?.id==='w001')throw new Error('fixture connection exhausted');return base(...args);}),/exhausted/);
});
test('all no-vocal windows return a clear no-vocals result, not fabricated lyrics',async()=>{
 await assert.rejects(analyzeByListening(input,mockRequest([], (raw,i,k)=>k==='survey'?raw:{...raw,content:'no_vocals',lines:[]})),e=>e.code==='NO_VOCALS');
});
test('pipeline provenance names recording-only input without leaking provided text',async()=>{
 const r=await analyzeByListening({...input,lyrics:'PRIVATE_UNUSED_TEXT'},mockRequest());assert.equal(r.provenance.pipeline,'audio-first-v1');assert.equal(r.provenance.inputLyricsUsed,false);assert.equal(r.provenance.sourceIdentity,input.url);assert.ok(!JSON.stringify(r).includes('PRIVATE_UNUSED_TEXT'));
});
test('word timing and uncertainty survive annotations, final schema, and JSON reload',async()=>{
 const transcript=mergeListening([pass(win[0],observation(win[0],'晨光陪我',2,{wordTimes:false}))],survey);
 const before=transcript.phrases[0].tokens.map(t=>[t.start,t.end,t.timingMode]);
 const annotated=await annotateTranscript(transcript,async b=>normalizeTeachingBatch(syntheticTeaching(b.phrases),b));
 const reload=normalizeAnalysis(JSON.parse(JSON.stringify(annotated)));
 assert.deepEqual(reload.phrases[0].tokens.map(t=>[t.start,t.end,t.timingMode]),before);assert.equal(reload.teachingCoverage.identified,4);assert.equal(reload.listening.accuracyVerified,false);
});
test('unsafe self-declared accuracyVerified true is never trusted on import',()=>{
 const score=mergeListening([pass()],survey);score.listening.accuracyVerified=true;assert.equal(normalizeAnalysis(score).listening.accuracyVerified,false);
});
test('actual generate orchestrator falls back from rejected YouTube clipping without changing the model',async()=>{
 const calls=[];const r=await generate(input,'analyze',config,undefined,async(u,o)=>{
  const body=JSON.parse(o.body);calls.push({u,body});const legacy=u.includes(':generateContent');
  if(!legacy&&body.input[0]?.processing)return new Response('{}',{status:400});
  return new Response(JSON.stringify(completedFor(o,legacy)),{status:200});
 });
 const legacyWindows=calls.filter(c=>c.u.includes(':generateContent'));
 assert.equal(legacyWindows.length,1);assert.ok(legacyWindows.every(c=>c.u.includes('gemini-3.8-flash')&&c.body.contents[0].parts[0].videoMetadata===undefined));assert.equal(r.adaptive.selectedLines,0);assert.equal(r.teachingCoverage.unknown,0);
 assert.ok(!calls.some(c=>JSON.stringify(c.body).includes('external lyric sheet')));
});
test('new exact user QA URL selects video ID, not the radio playlist',async()=>{
 const {parseYouTube}=await import('../shared/music.mjs');const r=parseYouTube('https://www.youtube.com/watch?v=YaJ_lYFgr6c&list=RDeV9a5oUCbZQ&index=2');assert.equal(r.id,'YaJ_lYFgr6c');
});
