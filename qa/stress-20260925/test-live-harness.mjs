/** Self-test of the new hosted QA CLI, against localhost canned NDJSON only. */
import http from 'node:http';import {spawn} from 'node:child_process';import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),OUT=process.env.SF_QA_OUT||path.join(ROOT,'test-results/live-harness-selftest');await mkdir(OUT,{recursive:true});
const results=[];const score={duration:30,phrases:[{start:1,end:5,tokens:[{text:'微',start:1,end:2,technique:'chest',annotationStatus:'reviewed'},{text:'光',start:2,end:3,technique:'mix',annotationStatus:'reviewed'}]}],adaptive:{state:'complete',completeScan:true,failedTasks:0,completedTasks:1,totalTasks:1}};
for(const mode of ['ok','no-key','unauthenticated','wrong-version','error503','partial','missing-labels','markdown-url']){
 let posts=0,received=[];const dir=await mkdtemp(path.join(os.tmpdir(),'sf-qa-harness-'));
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:mode==='wrong-version'?'0.0.0':'1.2.2',configured:mode!=='no-key',requiresAccessCode:mode==='unauthenticated',authenticated:mode!=='unauthenticated'}));return;}
  const chunks=[];for await(const c of req)chunks.push(c);received.push(JSON.parse(Buffer.concat(chunks)));posts++;
  if(mode==='error503'){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"code":"NO_API_KEY"}');return;}
  const result=structuredClone(score);if(mode==='missing-labels')result.phrases[0].tokens[0].annotationStatus='missing';if(mode==='partial')result.adaptive.state='partial';
  res.writeHead(200,{'Content-Type':'application/x-ndjson'});res.write(JSON.stringify({type:'ready',result:{...result,adaptive:{...result.adaptive,state:'refining'}}})+'\n');res.end(JSON.stringify({type:'done',result})+'\n');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const args=['qa/stress-20260925/live-songs.mjs','--execute','--base',base,'--out',dir];if(mode==='markdown-url')args.push('[https://www.youtube.com/watch?v=eV9a5oUCbZQ](https://www.youtube.com/watch?v=eV9a5oUCbZQ)');
 const child=spawn(process.execPath,args,{cwd:ROOT,stdio:'ignore'});const code=await new Promise((resolve,reject)=>{child.on('close',resolve);child.on('error',reject);});
 const report=JSON.parse(await readFile(path.join(dir,'summary.json'),'utf8'));
 const blocked=['no-key','unauthenticated','wrong-version'].includes(mode),pass=['ok','markdown-url'].includes(mode);
 let valid=blocked?posts===0&&report.result==='blocked':pass?code===0&&report.result==='processing-checks-passed':code!==0&&report.result==='not-fully-passed';
 if(mode==='markdown-url')valid=valid&&posts===1&&received[0].url==='https://www.youtube.com/watch?v=eV9a5oUCbZQ';else if(!blocked)valid=valid&&posts===3;
 results.push({mode,passed:valid,exitCode:code,posts,result:report.result});console.log(mode,valid?'PASS':'FAIL');server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});
}
await writeFile(path.join(OUT,'selftest.json'),JSON.stringify({scope:'QA helper self-tests using local canned HTTP; no Google calls',tests:results.length,passed:results.filter(x=>x.passed).length,results},null,2));process.exitCode=results.some(x=>!x.passed)?1:0;
