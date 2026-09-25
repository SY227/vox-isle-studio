import {completedFor,wave} from './fixtures/listening-fixture.mjs';
import {buildTeachingBatches} from '../shared/annotations.mjs';
import {normalizeAnalysis} from '../shared/schema.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestBody,interactionsBody,generate,modelName,checkModel} from '../server/gemini.mjs';
const demo=JSON.parse(readFileSync(new URL('../public/demo.json',import.meta.url),'utf8'));
const config={apiKey:'test-key-NOT-A-REAL-SECRET',model:'gemini-3.8-flash',timeout:2000,retryDelays:[0,0,0]};
const input={source:'youtube',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ',language:'cantonese',lyrics:''};
const signal=()=>new AbortController().signal;
const reply=(raw,status=200)=>new Response(JSON.stringify(raw),{status,headers:{'Content-Type':'application/json'}});
const legacyCompleted=()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(demo)}]}}]});
const interactionCompleted=()=>({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(demo)}]}],usage:{total_input_tokens:123,total_output_tokens:456}});

test('legacy YouTube fallback uses fileData with video MIME and no brittle forced endOffset',()=>{
  const b=requestBody(input);
  assert.equal(b.contents[0].parts[0].fileData.fileUri,input.url);
  assert.equal(b.contents[0].parts[0].fileData.mimeType,'video/*');
  assert.equal(b.contents[0].parts[0].videoMetadata,undefined);
  assert.equal(b.generationConfig.responseMimeType,'application/json');
  assert.ok(b.generationConfig.responseJsonSchema?.properties);
});

test('preferred YouTube transport uses official Interactions direct video URI and structured JSON',()=>{
  const b=interactionsBody(input,'analyze','gemini-3.8-flash');
  assert.equal(b.model,'gemini-3.8-flash');
  assert.deepEqual(b.input[0],{type:'video',uri:input.url});
  assert.equal(b.response_format.type,'text');
  assert.equal(b.response_format.mime_type,'application/json');
  assert.equal(b.store,false);
});

test('upload/recording uses WAV inlineData rather than external arbitrary URL',()=>{
  const b=requestBody({source:'upload',audioData:'AA==',language:'auto'});
  assert.equal(b.contents[0].parts[0].inlineData.mimeType,'audio/wav');
  assert.equal(b.contents[0].parts[0].inlineData.data,'AA==');
});

test('YouTube analysis uses Interactions API first and returns validated result',async()=>{
  let target,options;
  const r=await generate(input,'analyze',config,signal(),async(u,o)=>{target=u;options=o;return reply(completedFor(o));});
  assert.ok(target.endsWith('/v1beta/interactions'));
  assert.equal(options.headers['x-goog-api-key'],config.apiKey);
  assert.equal(r.provenance.kind,'ai-estimate');
  assert.equal(r.provenance.transport,'recording-first-adaptive');
  assert.equal(r.phrases.length,8);
  assert.equal(r.teachingCoverage.unknown,0);
  assert.equal(r.teachingCoverage.reviewed,r.teachingCoverage.total);
  assert.ok(!JSON.stringify(r).includes(config.apiKey));
});

test('YouTube falls through official variants when a preview request shape is rejected',async()=>{
  const targets=[];
  const r=await generate(input,'analyze',config,signal(),async(u,o)=>{
    targets.push({u,body:JSON.parse(o.body)});
    // Reject structured Interactions survey only; unstructured Interactions must recover.
    if(targets.length===1)return reply({error:{message:'preview route rejected'}},400);
    return reply(completedFor(o,u.includes(':generateContent')));
  });
  assert.ok(targets[0].u.endsWith('/v1beta/interactions'));
  assert.equal(targets[0].body.response_format.mime_type,'application/json');
  assert.ok(targets.some(x=>x.u.endsWith('/v1beta/interactions')&&!x.body.response_format));
  assert.equal(r.provenance.transport,'recording-first-adaptive');
});

test('GenerateContent compatibility body uses its native structured-output field names',()=>{
  const b=requestBody({...input,listeningWindow:{clipStart:12,clipEnd:36,id:'w000'}},'listen');
  assert.equal(b.generationConfig.responseMimeType,'application/json');
  assert.ok(b.generationConfig.responseJsonSchema);
  assert.equal(b.generationConfig.responseFormat,undefined);
  assert.equal(b.contents[0].parts[0].videoMetadata,undefined);
  assert.match(b.contents[0].parts[1].text,/完整原片/);
  assert.match(b.contents[0].parts[1].text,/source_seconds/);
});

test('YouTube auth/policy denial is not hammered with a second provider call',async()=>{
  let calls=0;
  await assert.rejects(generate(input,'analyze',config,signal(),async()=>{calls++;return reply({},403);}),e=>e.code==='GEMINI_403');
  assert.equal(calls,1);
});

test('non-YouTube request uses exact model and server-side header',async()=>{
  let target,options;
  const upload={source:'upload',audioData:wave(demo.duration).toString('base64'),duration:demo.duration,language:'auto'};
  const r=await generate(upload,'analyze',config,signal(),async(u,o)=>{target=u;options=o;return reply(completedFor(o,true));});
  assert.ok(target.endsWith('/gemini-3.8-flash:generateContent'));
  assert.equal(options.headers['x-goog-api-key'],config.apiKey);
  assert.equal(r.provenance.transport,'recording-first-adaptive');
});

test('missing key is a clear failure, never demo fallback',async()=>{await assert.rejects(generate(input,'analyze',{...config,apiKey:''},signal()),e=>e.code==='NO_API_KEY');});
test('404 does not silently switch models',async()=>{await assert.rejects(generate(input,'analyze',config,signal(),async()=>reply({},404)),e=>e.code==='GEMINI_404');});
test('429 quota exposes no provider response secrets',async()=>{await assert.rejects(generate(input,'analyze',config,signal(),async()=>reply({secret:config.apiKey},429)),e=>e.code==='GEMINI_429'&&!e.message.includes(config.apiKey));});
test('truncated Interactions output is rejected rather than partially rendered',async()=>{await assert.rejects(generate(input,'analyze',config,signal(),async()=>reply({status:'incomplete',steps:[]})),e=>e.code==='TRUNCATED');});
test('invalid JSON and empty Interactions output fail safely',async()=>{for(const raw of [{status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'not-json'}]}]},{status:'completed',steps:[]}])await assert.rejects(generate(input,'analyze',config,signal(),async()=>reply(raw)));});
test('transient Google failures are retried silently three times before succeeding',async()=>{
  let calls=0;const phases=[];
  const r=await generate(input,'analyze',config,signal(),async(u,o)=>{calls++;if(calls<4)throw new TypeError('network down');return reply(completedFor(o));},p=>phases.push(p));
  assert.equal(calls,5);assert.equal(r.provenance.transport,'recording-first-adaptive');assert.ok(!phases.some(p=>/retry|重試|重新連接/.test(p.message||'')));
});
test('transient 503 responses receive exactly three silent retries',async()=>{
  let calls=0;await assert.rejects(generate(input,'analyze',config,signal(),async()=>{calls++;return reply({},503);}),e=>e.code==='GEMINI_503');assert.equal(calls,4);
});
test('user cancellation stops provider retry immediately',async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(generate(input,'analyze',{...config,retryDelays:[50,50,50]},controller.signal,async()=>{calls++;controller.abort();throw new TypeError('network down');}),e=>e.code==='CANCELLED');assert.equal(calls,1);
});
test('model names cannot inject request paths',()=>{assert.throws(()=>modelName({model:'../../secrets'}));});
test('model permission check distinguishes metadata from generation',async()=>{const r=await checkModel(config,async()=>reply({displayName:'Gemini 3.8 Flash',supportedGenerationMethods:['generateContent']}));assert.equal(r.ok,true);assert.equal(r.generateContent,true);});
