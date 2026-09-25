import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recoverAnalysis,seconds,midi} from '../shared/recovery.mjs';
import {normalizeAnalysis} from '../shared/schema.mjs';
import {generate} from '../server/gemini.mjs';
const base=JSON.parse(readFileSync(new URL('../public/demo.json',import.meta.url),'utf8'));
const copy=()=>structuredClone(base);

test('valid source is preserved exactly; no invented notes or timing changes',()=>{
 const a=recoverAnalysis(copy());assert.deepEqual(a.phrases,normalizeAnalysis(base).phrases);assert.equal(a.dataQuality.mode,'complete');
});
test('one invalid note no longer destroys the entire song',()=>{
 const raw=copy();raw.phrases[0].tokens[0].notes=[440,60,null];
 const a=recoverAnalysis(raw);assert.equal(a.phrases.length,8);assert.deepEqual(a.phrases[0].tokens[0].notes,[60]);assert.equal(a.dataQuality.omittedNotes,2);
});
test('unknown pitch preserves a timed lyric, with no fake default pitch',()=>{
 const raw=copy();raw.phrases[0].tokens[0].notes=[-1,0,900];
 const a=recoverAnalysis(raw);assert.deepEqual(a.phrases[0].tokens[0].notes,[]);assert.equal(a.phrases[0].tokens[0].confidence,'low');assert.equal(a.dataQuality.unknownPitchTokens,1);
});
test('numeric strings, MM:SS, and named notes normalize deterministically',()=>{
 const raw=copy();raw.duration='00:32';raw.phrases[0].tokens[0].start='00:01.500';raw.phrases[0].tokens[0].end='2.1';raw.phrases[0].tokens[0].notes=['C4','F#4','B♭3','69'];
 const a=recoverAnalysis(raw),t=a.phrases[0].tokens[0];assert.equal(t.start,1.5);assert.equal(t.end,2.1);assert.deepEqual(t.notes,[60,66,58,69]);
});
test('timestamp parser rejects booleans, unknown, NaN and ambiguous minute decimals',()=>{
 for(const v of [null,undefined,true,'','unknown','0:99','12:75:00',Infinity])assert.equal(seconds(v),null);
 assert.equal(seconds('01:02:03.5'),3723.5);assert.equal(seconds('2.30'),2.3);assert.equal(seconds('9.1s'),9.1);
});
test('MIDI parser never guesses frequency units',()=>{
 for(const v of [440,'440',null,'La4','A4 Hz',true,0,Infinity])assert.equal(midi(v),null);
 assert.equal(midi('a4'),69);assert.equal(midi('C♯4'),61);assert.equal(midi('G♭3'),54);
});
test('legacy recovery retains its six-minute cap; new schema separately accepts fifteen minutes',()=>{
 const raw=copy();raw.duration=402.8;assert.doesNotThrow(()=>normalizeAnalysis(raw));const a=recoverAnalysis(raw);assert.equal(a.duration,360);assert.equal(a.phrases.length,8);
});
test('actual upload duration caps analysis without rewriting retained syllable times',()=>{
 const a=recoverAnalysis(copy(),{sourceDuration:10});assert.equal(a.duration,10);for(const p of a.phrases)for(const t of p.tokens)assert.ok(t.end<=10);
});
test('bad phrase envelope is repaired from existing token timestamps, not invented alignment',()=>{
 const raw=copy();raw.phrases[0].start=3;raw.phrases[0].end=3.1;
 const a=recoverAnalysis(raw);assert.deepEqual(a.phrases[0].tokens,normalizeAnalysis(base).phrases[0].tokens);assert.equal(a.phrases[0].start,a.phrases[0].tokens[0].start);
});
test('wrong or zero-length word timestamps preserve the words as untimed lyrics',()=>{
 const raw=copy(),word=raw.phrases[0].tokens[0].text;raw.phrases[0].tokens[0].end=raw.phrases[0].tokens[0].start;
 const a=recoverAnalysis(raw);assert.ok(a.unalignedLyrics.join('').includes(word));assert.equal(a.dataQuality.untimedTokens,1);assert.equal(a.phrases.length,8);
});
test('all words missing times yield a read-only transcript, not fabricated success timing',()=>{
 const raw=copy();for(const p of raw.phrases)for(const t of p.tokens){t.start=null;t.end=null;}
 const a=recoverAnalysis(raw);assert.equal(a.phrases.length,0);assert.equal(a.unalignedLyrics.length,8);assert.equal(a.range.low,null);assert.equal(a.dataQuality.mode,'partial');assert.deepEqual(normalizeAnalysis(a),a);
});
test('small negative rounding repaired, substantial negative time retained untimed',()=>{
 const raw=copy();raw.phrases[0].tokens[0].start=-0.02;raw.phrases[0].tokens[1].start=-5;
 const a=recoverAnalysis(raw);assert.equal(a.phrases[0].tokens[0].start,0);assert.equal(a.dataQuality.untimedTokens,1);
});
test('unsorted time order is disclosed and sorted, without moving any valid timestamp',()=>{
 const raw=copy();raw.phrases[0].tokens.reverse();const a=recoverAnalysis(raw);assert.equal(a.dataQuality.reorderedGroups,1);assert.deepEqual(a.phrases[0].tokens,normalizeAnalysis(base).phrases[0].tokens);
});
test('unknown technique is marked unknown, never diagnosed as a mechanism',()=>{
 const raw=copy();raw.phrases[0].tokens[0].technique='scientifically-proven-mix';raw.phrases[0].tokens[0].ornaments=['run','bogus','run'];const a=recoverAnalysis(raw);assert.equal(a.phrases[0].tokens[0].technique,'unknown');assert.deepEqual(a.phrases[0].tokens[0].ornaments,['run']);
});
test('unknown tempo does not reject valid lyrics',()=>{const raw=copy();raw.tempo=0;assert.equal(recoverAnalysis(raw).tempo,null);});
test('excess payload metadata is never returned to the browser',()=>{const raw=copy();raw.apiKey='fake-secret';raw.html='<script>';const a=recoverAnalysis(raw);assert.equal(a.apiKey,undefined);assert.equal(a.html,undefined);});
test('no invented demo fallback for unavailable or empty input',()=>{
 for(const raw of [null,{}, {status:'unavailable',reason:'unavailable'}, {...base,phrases:[]}])assert.throws(()=>recoverAnalysis(raw));
});
test('recovery is idempotent under final strict schema validation',()=>{
 const raw=copy();raw.phrases[0].tokens[0].notes=[500];raw.phrases[0].tokens[1].start=null;const a=recoverAnalysis(raw);assert.deepEqual(normalizeAnalysis(a),a);
});
test('legacy transcript output_text parses; normalization phase emitted before result',async()=>{
 const raw=copy();raw.duration=381;raw.phrases[0].tokens[0].notes=[440];const events=[];
 const a=await generate({source:'youtube',url:'https://www.youtube.com/watch?v=4ULVNHHqbew',language:'auto'},'transcript',
  {model:'gemini-3.8-flash',apiKey:'FAKE-test-only',timeout:1000},new AbortController().signal,
  async()=>new Response(JSON.stringify({status:'completed',output_text:'```json\n'+JSON.stringify(raw)+'\n```'}),{status:200}),x=>events.push(x));
 assert.equal(a.phrases.length,8);assert.equal(a.duration,360);assert.ok(events.some(e=>e.phase==='normalizing'));
});
test('provider refusal is not mislabeled as a numerical validation error',async()=>{
 await assert.rejects(generate({source:'youtube',url:'https://www.youtube.com/watch?v=4ULVNHHqbew'},'analyze',
 {model:'gemini-3.8-flash',apiKey:'FAKE-test-only',timeout:1000},undefined,
 async()=>new Response(JSON.stringify({status:'completed',output_text:JSON.stringify({status:'unavailable',reason:'Cannot hear source'})}),{status:200})),e=>e.code==='SOURCE_UNAVAILABLE');
});
test('fuzz: finite malformed numbers do not yield unsafe note/timing output',()=>{
 let seed=93271;const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
 for(let i=0;i<120;i++){
  const raw=copy();raw.duration=360+random()*100;
  const t=raw.phrases[0].tokens[0];t.notes=[-random()*40,24+random()*84,200+random()*500];t.start=random()>.5?null:String(t.start);raw.tempo=-1;
  const a=recoverAnalysis(raw);assert.doesNotThrow(()=>normalizeAnalysis(a));for(const p of a.phrases)for(const n of p.tokens.flatMap(t=>t.notes))assert.ok(n>=24&&n<=108);
 }
});
