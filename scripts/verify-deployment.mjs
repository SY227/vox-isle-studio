#!/usr/bin/env node
/** GET-only smoke test. Never sends a song, requests a paid analysis, or prints a key. */
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from '../server/config.mjs';
const origin=process.argv.find(v=>/^https?:\/\//.test(v))||'https://vox-isle-studio.vercel.app';
const results=[];
for(const route of ['/','/app.mjs','/boot-guard.mjs','/shared/music.mjs','/shared/schema.mjs','/shared/annotations.mjs','/api/status']){
 try{
  const r=await fetch(new URL(route,origin),{signal:AbortSignal.timeout(12000)}),text=await r.text();
  let ok=r.ok;
  if(route.endsWith('.mjs'))ok&&=/javascript/.test(r.headers.get('content-type')||'')&&!/^\s*</.test(text);
  if(route==='/')ok&&=text.includes('vox-production-style');
  if(route==='/api/status'){const data=JSON.parse(text);ok&&=data.version==='1.2.1'&&data.configured===true;results.push({route,status:r.status,ok,configured:data.configured,version:data.version});}
  else results.push({route,status:r.status,ok});
 }catch(e){results.push({route,ok:false,code:e.cause?.code||e.code||e.name});}
}
const report={scope:'Real deployment GET smoke only; no live audio analysis',checkedAt:new Date().toISOString(),result:results.every(r=>r.ok)?'passed':'not-passed',results};
await mkdir(path.join(ROOT,'test-results'),{recursive:true});await writeFile(path.join(ROOT,'test-results/deployment.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.result!=='passed')process.exitCode=1;
