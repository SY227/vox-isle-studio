import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {createApp} from '../server/index.mjs';
import {AppError} from '../server/validation.mjs';
const demo=JSON.parse(readFileSync(new URL('../public/demo.json',import.meta.url),'utf8'));
const base={apiKey:'server-only-TEST-KEY',model:'gemini-3.8-flash',origin:'',accessCode:'',host:'127.0.0.1',port:0,production:false};
const request={rights:true,source:'youtube',url:'https://youtu.be/dQw4w9WgXcQ',language:'cantonese'};
async function start(t,patch={},generate=async()=>demo){const s=createApp({...base,...patch},{generate});s.listen(0,'127.0.0.1');await once(s,'listening');t.after(()=>new Promise(r=>s.close(r)));return `http://127.0.0.1:${s.address().port}`;}
const post=(url,data,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
test('status discloses readiness but no API key',async t=>{const u=await start(t),r=await fetch(u+'/api/status'),s=await r.text();assert.equal(r.status,200);assert.ok(!s.includes(base.apiKey));assert.equal(JSON.parse(s).language,'zh-Hant');});
test('HTML has protective response headers and no exposed config',async t=>{const u=await start(t),r=await fetch(u+'/');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/object-src 'none'/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(await r.text(),/zh-Hant/);});
test('private server files and .env are not served',async t=>{const u=await start(t);for(const p of ['/.env','/server/config.mjs','/shared/%2e%2e/server/config.mjs']){const r=await fetch(u+p);assert.ok([403,404].includes(r.status),p);}});
test('audio range requests support seeking',async t=>{const u=await start(t),r=await fetch(u+'/audio/demo.wav',{headers:{Range:'bytes=0-43'}});assert.equal(r.status,206);assert.match(r.headers.get('content-range'),/^bytes 0-43\//);assert.equal((await r.arrayBuffer()).byteLength,44);});
test('invalid audio byte range returns 416',async t=>{const u=await start(t),r=await fetch(u+'/audio/demo.wav',{headers:{Range:'bytes=99999999-'}});assert.equal(r.status,416);});
test('cross-site POST is refused before provider call',async t=>{let called=false;const u=await start(t,{},async()=>{called=true;return demo;});const r=await post(u+'/api/analyze',request,{Origin:'https://untrusted.example'});assert.equal(r.status,403);assert.equal(called,false);});
test('validated request streams actual phases then result',async t=>{let source;const u=await start(t,{},async x=>{source=x;return demo;}),r=await post(u+'/api/analyze',request);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/ndjson/);const packets=(await r.text()).trim().split('\n').map(JSON.parse);assert.equal(packets[0].phase,'accepted');assert.equal(packets.at(-1).type,'done');assert.equal(source.url,'https://www.youtube.com/watch?v=dQw4w9WgXcQ');});
test('model failure becomes error packet, never successful demo',async t=>{const u=await start(t,{},async()=>{throw new AppError('配額已到',429,'QUOTA');});const r=await post(u+'/api/analyze',request),p=(await r.text()).trim().split('\n').map(JSON.parse);assert.equal(p.at(-1).type,'error');assert.equal(p.at(-1).code,'QUOTA');assert.ok(!p.some(x=>x.type==='done'));});
test('missing local key gives explicit 503',async t=>{const u=await start(t,{apiKey:''}),r=await post(u+'/api/analyze',request);assert.equal(r.status,503);assert.equal((await r.json()).code,'NO_API_KEY');});
test('song analysis accepts no rights flag and makes no verification claim',async t=>{const u=await start(t);const {rights,...data}=request;const r=await post(u+'/api/analyze',data);assert.equal(r.status,200);const text=await r.text();assert.ok(!text.includes('權限已確認'));assert.ok(text.includes('done'));});
test('private access code protects AI routes and yields HttpOnly session',async t=>{const u=await start(t,{accessCode:'correct-long-test-access-code'});let r=await post(u+'/api/analyze',request);assert.equal(r.status,401);r=await post(u+'/api/session',{code:'wrong'});assert.equal(r.status,401);r=await post(u+'/api/session',{code:'correct-long-test-access-code'});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);r=await post(u+'/api/analyze',request,{Cookie:cookie.split(';')[0]});assert.equal(r.status,200);await r.text();});
test('JSON and method checks fail safely',async t=>{const u=await start(t);let r=await fetch(u+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'});assert.equal(r.status,400);r=await fetch(u+'/api/analyze',{method:'POST',body:'text'});assert.equal(r.status,415);r=await fetch(u+'/',{method:'DELETE'});assert.equal(r.status,405);});

test('server response identifies correct build and bypasses stale module cache',async t=>{
 const u=await start(t);for(const path of ['/','/app.mjs?v=1.2.2','/modules/player.mjs?v=1.2.2']){
 const r=await fetch(u+path);assert.equal(r.headers.get('x-vox-build'),'1.2.2');assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.status,200);}
});
test('exact supplied radio URL becomes the single intended video',async t=>{
 let input;const u=await start(t,{},async x=>{input=x;return demo;});
 const r=await post(u+'/api/analyze',{source:'youtube',language:'auto',url:'https://www.youtube.com/watch?v=4ULVNHHqbew&list=RD4ULVNHHqbew&start_radio=1'});await r.text();assert.equal(input.id,'4ULVNHHqbew');assert.equal(input.url,'https://www.youtube.com/watch?v=4ULVNHHqbew');
});
test('provider-receipt progress is forwarded before the completed analysis',async t=>{
 const u=await start(t,{},async(input,kind,config,signal,fetcher,onProgress)=>{onProgress({phase:'normalizing',message:'正在整理'});return demo;});
 const r=await post(u+'/api/analyze',request),packets=(await r.text()).trim().split('\n').map(JSON.parse);
 assert.deepEqual(packets.map(p=>p.phase||p.type),['accepted','analyzing','normalizing','validated','done']);
});
