import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import {once} from 'node:events';
import {createApp} from '../server/index.mjs';
import {getConfig} from '../server/config.mjs';
const root=new URL('../',import.meta.url);
const config={apiKey:'test-only',model:'gemini-3.8-flash',origin:'',accessCode:'',production:false,timeout:1000};
async function appTest(fn,{body,limits={},run}={}){
 const app=createApp({...config,...limits},{generate:run||(async()=>({title:'QA',phrases:[]}))});
 const server=http.createServer((req,res)=>{if(body==='throws')Object.defineProperty(req,'body',{get(){throw new Error('invalid');}});else if(body!==undefined)req.body=body;return app.handle(req,res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{await fn(base);}finally{server.closeAllConnections();server.close();app.close();}
}
const post=base=>fetch(base+'/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
test('build copies all public module dependencies, not server or environment secrets',()=>{
 execFileSync(process.execPath,['scripts/build-vercel.mjs'],{cwd:root});const dist=new URL('dist/',root);
 for(const f of ['index.html','app.mjs','boot-guard.mjs','shared/music.mjs','shared/schema.mjs','shared/annotations.mjs'])assert.ok(existsSync(new URL(f,dist)),f);
 for(const f of ['.env','server','api','scripts'])assert.ok(!existsSync(new URL(f,dist)),f);
 const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(new URL(e.name+'/',d)):[new URL(e.name,d)]);
 for(const file of walk(dist).filter(f=>/\.m?js$/.test(f.pathname))){const s=readFileSync(file,'utf8');for(const match of s.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){const spec=match[1];if(!spec.startsWith('.')&&!spec.startsWith('/'))continue;const target=new URL(spec.startsWith('/')?spec.slice(1):spec,spec.startsWith('/')?dist:file);target.search='';assert.ok(existsSync(target),`${file.pathname} -> ${spec}`);}}
});
test('deployment defines the API handler, body source files and deadline',()=>{const v=JSON.parse(readFileSync(new URL('vercel.json',root)));assert.equal(v.functions['api/index.mjs'].maxDuration,300);assert.equal(v.outputDirectory,'dist');assert.equal(v.rewrites[0].destination,'/api/index?__vox_route=:path*');});
test('HTTP adapter accepts platform-preparsed object body',async()=>{let invoked=0;await appTest(async base=>{const r=await post(base);assert.equal(r.status,200);assert.match(await r.text(),/"type":"done"/);assert.equal(invoked,1);},{body:{source:'youtube',url:'https://www.youtube.com/watch?v=J2uD1UXLTVs',language:'auto'},run:async()=>{invoked++;return {};}});});
test('HTTP adapter rejects lazy JSON parse errors before spending provider calls',async()=>appTest(async base=>assert.equal((await post(base)).status,400),{body:'throws',run:async()=>{throw new Error('must not run');}}));
test('preparsed body still respects the deployment payload cap',async()=>appTest(async base=>assert.equal((await post(base)).status,413),{body:{text:'x'.repeat(1000)},limits:{maxBodyBytes:100}}));
test('raw request validation includes a safe request identifier',async()=>appTest(async base=>{const r=await post(base);const b=await r.json();assert.match(b.requestId,/^[a-f0-9]{16}$/);assert.equal(r.headers.get('x-request-id'),b.requestId);assert.doesNotMatch(JSON.stringify(b),/test-only/);}));
test('production origin checks reject arbitrary hostnames',async()=>appTest(async base=>assert.equal((await fetch(base+'/api/status')).status,403),{limits:{production:true,origin:'https://studio.example'}}));
test('exact preview origin works but attacker lookalike does not',async()=>appTest(async base=>{const request=host=>new Promise((resolve,reject)=>http.get(base+'/api/status',{headers:{host}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));}).on('error',reject));assert.equal(await request('preview.example'),200);assert.equal(await request('preview.example.attacker.com'),403);},{limits:{production:true,origin:'https://studio.example',allowedOrigins:['https://preview.example']}}));
test('Vercel budget is shorter than the function maximum',()=>{const env={...process.env};try{process.env.VERCEL='1';process.env.VOX_JOB_TIMEOUT_MS='900000';process.env.VERCEL_PROJECT_PRODUCTION_URL='studio.example';const c=getConfig();assert.equal(c.timeout,260000);assert.equal(c.maxBodyBytes,4000000);assert.equal(c.origin,'https://studio.example');}finally{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}});
test('real handler adapter returns API status through deployment rewrite shape',async()=>{
 const env={...process.env};let server;
 try{const {default:handler}=await import('../api/index.mjs');server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;process.env.APP_ORIGIN=base;process.env.GEMINI_API_KEY='test-only';const r=await fetch(base+'/api/index?__vox_route=status');assert.equal(r.status,200);const b=await r.json();assert.equal(b.version,'1.2.2');assert.equal(b.configured,true);assert.doesNotMatch(JSON.stringify(b),/test-only/);const bad=await fetch(base+'/api/index?__vox_route=..%2F.env');assert.equal(bad.status,404);}
 finally{server?.closeAllConnections();server?.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
