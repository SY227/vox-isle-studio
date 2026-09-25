import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeAnalysis} from '../shared/schema.mjs';
import {buildTeachingBatches,normalizeTeachingBatch,applyTeachingBatches,teachingCoverage,missingTeachingBatch,tokenId} from '../shared/annotations.mjs';
import {annotateTranscript} from '../server/teaching.mjs';
import {requestBody,interactionsBody} from '../server/gemini.mjs';
import {lyricState} from '../shared/lyric-clock.mjs';
const demo=normalizeAnalysis(JSON.parse(readFileSync(new URL('../public/demo.json',import.meta.url))));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function fullSong(count=40){
 const phrases=Array.from({length:count},(_,pi)=>({start:pi*7,end:pi*7+6,section:pi%2?'副歌':'主歌',focus:'',instruction:'',pronunciation:'',exercise:'',caution:'',
 tokens:Array.from('微光陪我遠行').map((text,ti)=>({text,romanization:'',start:pi*7+ti,end:pi*7+ti+.9,notes:[],technique:'unknown',ornaments:[],confidence:'low'}))}));
 return normalizeAnalysis({...demo,duration:count*7,phrases,unalignedLyrics:[]});
}
function rawFor(batch,{technique='mix'}={}){
 return {status:'ok',reason:'',key:'C',tempo:90,summary:'唱完整首歌',warnings:[],phrases:batch.phrases.map(p=>({id:p.id,focus:'輕輕銜接',instruction:'可以輕輕唱',pronunciation:'保留字音',exercise:'慢唱一次',caution:'不适停止',tokens:p.tokens.map((t,ti)=>({id:t.id,text:t.text,notes:[60+ti],technique,ornaments:ti===2?['run']:[],confidence:'medium'}))}))};
}

test('every occurrence across all 40 phrases is scheduled once, including repeated choruses',()=>{
 const song=fullSong(),batches=buildTeachingBatches(song),ids=batches.flatMap(b=>b.phrases.flatMap(p=>p.tokens.map(t=>t.id)));
 assert.equal(batches.length,5);assert.equal(ids.length,240);assert.equal(new Set(ids).size,240);assert.ok(ids.includes('p39t5'));
 for(const b of batches){assert.ok(b.tokenCount<=120);assert.ok(b.phrases.length<=8);assert.equal(b.totalBatches,5);}
});
test('batch limits are bounds per call, not a first-page song truncation',()=>{
 const song=fullSong(50),batches=buildTeachingBatches(song,{maxTokens:64,maxPhrases:3});assert.equal(batches.length,17);assert.equal(batches.at(-1).phrases.at(-1).id,'p49');
});
test('invalid batch limits are rejected',()=>{assert.throws(()=>buildTeachingBatches(demo,{maxTokens:1}));});
test('fixed token IDs tolerate different output order without shifting lyrics or timestamps',()=>{
 const song=fullSong(2),batch=buildTeachingBatches(song)[0],raw=rawFor(batch);raw.phrases.reverse();raw.phrases.forEach(p=>p.tokens.reverse());
 const normalized=normalizeTeachingBatch(raw,batch),result=applyTeachingBatches(song,[normalized]);
 assert.equal(result.teachingCoverage.identified,12);assert.deepEqual(result.phrases.map(p=>p.tokens.map(t=>[t.text,t.start,t.end])),song.phrases.map(p=>p.tokens.map(t=>[t.text,t.start,t.end])));
});
test('same character in a later chorus receives its own technique, never a nearby match',()=>{
 const song=fullSong(2),batch=buildTeachingBatches(song)[0],raw=rawFor(batch);raw.phrases[1].tokens[0].technique='falsetto';
 const r=applyTeachingBatches(song,[normalizeTeachingBatch(raw,batch)]);
 assert.equal(r.phrases[0].tokens[0].technique,'mix');assert.equal(r.phrases[1].tokens[0].technique,'falsetto');
});
test('an unknown ID cannot add lyrics or attach phantom annotations',()=>{
 const b=buildTeachingBatches(fullSong(1))[0],raw=rawFor(b);raw.phrases[0].tokens.push({...raw.phrases[0].tokens[0],id:'p999t0'});
 assert.equal(normalizeTeachingBatch(raw,b).annotations.size,6);
});
test('matching ID with mismatching text is rejected, not silently reassigned',()=>{
 const b=buildTeachingBatches(fullSong(1))[0],raw=rawFor(b);raw.phrases[0].tokens[0].text='錯';const r=normalizeTeachingBatch(raw,b);
 assert.equal(r.annotations.has('p0t0'),false);assert.deepEqual(r.missing,['p0t0']);
});
test('matching token ID in the wrong phrase is rejected',()=>{
 const b=buildTeachingBatches(fullSong(2))[0],raw=rawFor(b);raw.phrases[1].tokens.push(raw.phrases[0].tokens.shift());
 assert.equal(normalizeTeachingBatch(raw,b).annotations.has('p0t0'),false);
});
test('duplicate IDs do not silently take the last conflicting value',()=>{
 const b=buildTeachingBatches(fullSong(1))[0],raw=rawFor(b);raw.phrases[0].tokens.push({...raw.phrases[0].tokens[0],technique:'head'});
 assert.equal(normalizeTeachingBatch(raw,b).annotations.has('p0t0'),false);
});
test('repair requests keep original IDs rather than renumbering omitted words',()=>{
 const b=buildTeachingBatches(fullSong(2))[0],raw=rawFor(b);raw.phrases[1].tokens.splice(2,1);const normalized=normalizeTeachingBatch(raw,b),repair=missingTeachingBatch(b,normalized.annotations);
 assert.equal(repair.tokenCount,1);assert.equal(repair.phrases[0].id,'p1');assert.equal(repair.phrases[0].tokens[0].id,'p1t2');assert.equal(repair.repair,true);
});
test('invalid MIDI is omitted, not converted from hertz or clamped',()=>{
 const b=buildTeachingBatches(fullSong(1))[0],raw=rawFor(b);raw.phrases[0].tokens[0].notes=[440,-1,'C#4',69,109];
 assert.deepEqual(normalizeTeachingBatch(raw,b).annotations.get('p0t0').notes,[61,69]);
});
test('unknown technique remains an explicit reviewed uncertainty',()=>{
 const song=fullSong(1),b=buildTeachingBatches(song)[0],r=applyTeachingBatches(song,[normalizeTeachingBatch(rawFor(b,{technique:'unknown'}),b)]);
 assert.equal(r.teachingCoverage.unknown,6);assert.equal(r.teachingCoverage.reviewed,6);assert.equal(r.teachingCoverage.missing,0);
});
test('unavailable teaching never fabricates true/fake voice to fill coverage',()=>{
 const song=fullSong(1),b=buildTeachingBatches(song)[0];const r=applyTeachingBatches(song,[normalizeTeachingBatch({status:'unavailable',reason:'no audio',phrases:[]},b)]);
 assert.equal(r.teachingCoverage.identified,0);assert.equal(r.phrases[0].tokens.length,6);assert.ok(r.warnings.some(w=>w.includes('尚未取得')));
});
test('broken batch schema fails safely',()=>{const b=buildTeachingBatches(demo)[0];for(const raw of [null,{}, {status:'ok'}])assert.throws(()=>normalizeTeachingBatch(raw,b));});
test('legacy imports preserve valid labels and gain accurate coverage without inventing missing ones',()=>{
 const raw=structuredClone(demo);raw.phrases.at(-1).tokens[0].technique='unknown';const r=normalizeAnalysis(raw);
 assert.equal(teachingCoverage(r).unknown,1);assert.equal(r.teachingCoverage.unknown,1);
});
test('coverage survives strict normalization, export and re-import',()=>{
 const s=fullSong(1),b=buildTeachingBatches(s)[0],r=applyTeachingBatches(s,[normalizeTeachingBatch(rawFor(b),b)]);
 assert.deepEqual(normalizeAnalysis(JSON.parse(JSON.stringify(r))).teachingCoverage,r.teachingCoverage);
});
test('all batches are annotated at bounded concurrency, with final-chorus coverage',async()=>{
 const song=fullSong();let active=0,peak=0;const progress=[];
 const result=await annotateTranscript(song,async b=>{active++;peak=Math.max(peak,active);await wait(b.index%2?1:5);active--;return normalizeTeachingBatch(rawFor(b),b);},{onProgress:p=>progress.push(p)});
 assert.equal(peak,2);assert.equal(result.teachingCoverage.identified,240);assert.equal(result.teachingCoverage.reviewed,240);
 assert.equal(result.phrases.at(-1).tokens.at(-1).technique,'mix');assert.equal(progress.at(-1).detail.examinedTokens,240);
 const counts=progress.map(p=>p.detail.examinedTokens);assert.deepEqual(counts,[...counts].sort((a,b)=>a-b));
});
test('an omitted word gets one targeted repair, not a second full-song guess',async()=>{
 const calls=[];const r=await annotateTranscript(fullSong(2),async b=>{calls.push(b);const raw=rawFor(b);if(!b.repair)raw.phrases[1].tokens.pop();return normalizeTeachingBatch(raw,b);});
 assert.equal(calls.length,2);assert.equal(calls[1].tokenCount,1);assert.equal(calls[1].phrases[0].tokens[0].id,'p1t5');assert.equal(r.teachingCoverage.unknown,0);
});
test('a valid unknown result does not produce repeated forced-classification attempts',async()=>{
 let calls=0;const r=await annotateTranscript(fullSong(1),async b=>{calls++;return normalizeTeachingBatch(rawFor(b,{technique:'unknown'}),b);});assert.equal(calls,1);assert.equal(r.teachingCoverage.reviewed,6);
});
test('repeated missing IDs do not create an infinite repair loop',async()=>{
 let calls=0;const r=await annotateTranscript(fullSong(1),async b=>{calls++;return normalizeTeachingBatch({...rawFor(b),phrases:[]},b);});assert.equal(calls,2);assert.equal(r.teachingCoverage.unknown,6);
});
test('one failed section retains its lyrics and does not erase later annotation batches',async()=>{
 const r=await annotateTranscript(fullSong(),async b=>{if(b.index===1)throw Object.assign(new Error('503'),{code:'GEMINI_503'});return normalizeTeachingBatch(rawFor(b),b);});
 assert.equal(r.phrases.length,40);assert.equal(r.teachingCoverage.total,240);assert.equal(r.teachingCoverage.unknown,48);assert.equal(r.phrases.at(-1).tokens.at(-1).technique,'mix');
});
test('cancel before annotation prevents all additional provider calls',async()=>{
 const c=new AbortController();c.abort();let calls=0;await assert.rejects(annotateTranscript(fullSong(),async()=>{calls++;},{signal:c.signal}));assert.equal(calls,0);
});
test('cancellation during repair is not swallowed as a partial success',async()=>{
 const c=new AbortController();let calls=0;
 await assert.rejects(annotateTranscript(fullSong(1),async b=>{calls++;if(b.repair){c.abort();throw Object.assign(new Error('cancelled'),{code:'CANCELLED'});}return normalizeTeachingBatch({...rawFor(b),phrases:[]},b);},{signal:c.signal}));assert.equal(calls,2);
});
test('provider authentication failures are not relabeled as successful teaching',async()=>{
 await assert.rejects(annotateTranscript(fullSong(1),async()=>{throw Object.assign(new Error('no auth'),{code:'GEMINI_401'});}),e=>e.code==='GEMINI_401');
});
test('annotation output cannot change frozen timings even if extra fields are supplied',()=>{
 const s=fullSong(1),b=buildTeachingBatches(s)[0],raw=rawFor(b);raw.phrases[0].tokens[0].start=999;
 assert.equal(applyTeachingBatches(s,[normalizeTeachingBatch(raw,b)]).phrases[0].tokens[0].start,0);
});
test('teaching API schemas include stable IDs and exclude independently generated timestamps',()=>{
 const input={source:'youtube',url:'https://www.youtube.com/watch?v=4ULVNHHqbew',language:'cantonese',teachingBatch:buildTeachingBatches(fullSong(1))[0]};
 for(const body of [requestBody(input,'teaching'),interactionsBody(input,'teaching')]){
  const schema=body.response_format?.schema||body.generationConfig.responseJsonSchema;
  const properties=schema.properties.phrases.items.properties.tokens.items.properties;
  assert.ok(properties.id);assert.equal(properties.start,undefined);assert.equal(properties.end,undefined);
  assert.ok(JSON.stringify(body).includes('p0t5'));
 }
});
for(const [name,time,offset,expected] of [['before',1,0,'upcoming'],['at onset',2,0,'current'],['inside',2.5,0,'current'],['at end',3,0,'played'],['later',8,0,'played'],['back seek',1,0,'upcoming'],['positive offset',2.5,1,'upcoming'],['negative offset',1.5,-1,'current']])test(`lyric clock ${name} uses the source position`,()=>assert.equal(lyricState(2,3,time,offset),expected));

test('successful full-song annotation replaces the transcript-only unknown-pitch counter',()=>{
 const s=fullSong(1);s.dataQuality={version:1,unknownPitchTokens:6,mode:'partial'};
 const b=buildTeachingBatches(s)[0],r=applyTeachingBatches(s,[normalizeTeachingBatch(rawFor(b),b)]);
 assert.equal(r.dataQuality.unknownPitchTokens,0);assert.equal(r.dataQuality.mode,'complete');
});
test('real timing uncertainty remains partial even after all techniques are annotated',()=>{
 const s=fullSong(1);s.dataQuality={version:1,unknownPitchTokens:6,untimedTokens:1,mode:'partial'};
 const b=buildTeachingBatches(s)[0],r=applyTeachingBatches(s,[normalizeTeachingBatch(rawFor(b),b)]);
 assert.equal(r.dataQuality.unknownPitchTokens,0);assert.equal(r.dataQuality.mode,'partial');
});
test('a fatal auth error stops sibling workers scheduling further paid batches',async()=>{
 let calls=0;
 await assert.rejects(annotateTranscript(fullSong(40),async b=>{
  calls++;if(b.index===0){await wait(1);throw Object.assign(new Error('auth'),{code:'GEMINI_401'});}
  await wait(15);return normalizeTeachingBatch(rawFor(b),b);
 }),e=>e.code==='GEMINI_401');
 await wait(40);assert.equal(calls,2);
});
