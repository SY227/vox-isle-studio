import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze} from '../public/modules/api.mjs';
const encode=new TextEncoder(),packet=x=>encode.encode(JSON.stringify(x)+'\n');
const ready={title:'Original QA',phrases:[{text:'原創測試'}],adaptive:{state:'refining',revision:1}};
async function withFetch(fetcher,fn){const before=global.fetch;global.fetch=fetcher;try{return await fn();}finally{global.fetch=before;}}
const noCancel=()=>new Promise(()=>{});
function response(start,cancel){return new Response(new ReadableStream({start,cancel}),{headers:{'content-type':'application/x-ndjson','x-request-id':'0123456789abcdef'}});}
const call=(limits={})=>analyze('/api/analyze',{},()=>{},new AbortController().signal,()=>{},{headersMs:100,idleMs:35,...limits});
test('browser header stall ends within a bound and does not duplicate the POST',async()=>{let calls=0;await withFetch(()=>{calls++;return new Promise(()=>{});},async()=>{await assert.rejects(call({headersMs:25}),e=>e.code==='STREAM_TIMEOUT');assert.equal(calls,1);});});
test('dead stream before first lyrics exits even if stream.cancel never settles',async()=>{await withFetch(async()=>response(()=>{},noCancel),()=>assert.rejects(call(),e=>e.code==='STREAM_TIMEOUT'));});
test('dead stream after ready preserves the entire usable score as partial',async()=>{await withFetch(async()=>response(c=>c.enqueue(packet({type:'ready',result:ready})),noCancel),async()=>{const r=await call();assert.equal(r.adaptive.state,'partial');assert.deepEqual(r.phrases,ready.phrases);});});
test('connection break after ready preserves usable result',async()=>{await withFetch(async()=>response(c=>{c.enqueue(packet({type:'ready',result:ready}));setTimeout(()=>c.error(new Error('broken')),10);}),async()=>{assert.equal((await call()).adaptive.state,'partial');});});
test('complete packet resolves without waiting for TCP EOF',async()=>{await withFetch(async()=>response(c=>c.enqueue(packet({type:'done',result:ready})),noCancel),async()=>{const r=await call();assert.deepEqual(r,ready);});});
test('heartbeats prevent a false stall while a provider is busy',async()=>{let timer;await withFetch(async()=>response(c=>{let n=0;timer=setInterval(()=>{c.enqueue(packet({type:'heartbeat'}));if(++n===7){c.enqueue(packet({type:'done',result:ready}));clearInterval(timer);c.close();}},10);},()=>clearInterval(timer)),async()=>assert.deepEqual(await call(),ready));});
test('user cancellation is not converted to a completed or partial result',async()=>{const ac=new AbortController();await withFetch(async()=>response(c=>c.enqueue(packet({type:'ready',result:ready}))),async()=>{setTimeout(()=>ac.abort(),15);await assert.rejects(analyze('/api/analyze',{},()=>{},ac.signal),e=>e.name==='AbortError');});});
test('platform error reports retain only the server reference identifier',async()=>{await withFetch(async()=>new Response(JSON.stringify({error:'service unavailable',code:'NO_API_KEY',requestId:'abcd'}),{status:503}),()=>assert.rejects(call(),e=>e.code==='NO_API_KEY'&&e.requestId==='abcd'));});
test('split UTF-8 Chinese and multiple packets in a chunk survive streaming',async()=>{const bytes=packet({type:'done',result:ready});await withFetch(async()=>response(c=>{for(let i=0;i<bytes.length;i+=2)c.enqueue(bytes.slice(i,i+2));c.close();}),async()=>assert.deepEqual(await call(),ready));});
test('malformed stream before ready fails visibly rather than hanging',async()=>{await withFetch(async()=>response(c=>{c.enqueue(encode.encode('bad json\n'));}),()=>assert.rejects(call(),SyntaxError));});
