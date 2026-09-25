#!/usr/bin/env node
/** Real provider diagnostic. Reports contain timing/codes, never secrets or lyrics. */
import {mkdir,writeFile} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import path from 'node:path';
import {getConfig,ROOT} from '../server/config.mjs';
import {generate,checkModel} from '../server/gemini.mjs';
import {validateInput} from '../server/validation.mjs';
import {newProviderRuntime} from '../server/provider-client.mjs';
const source=process.argv.find(a=>/^https?:\/\//.test(a))||'https://www.youtube.com/watch?v=J2uD1UXLTVs';
const config=getConfig(),started=Date.now();
const report={version:'1.2.2',checkedAt:new Date().toISOString(),result:'blocked',scope:'Real provider; does not certify lyric timing accuracy',keyConfigured:!!config.apiKey,network:[],events:[],milestones:[]};
try{
 const input=validateInput({source:'youtube',url:source,language:'auto'});report.videoId=input.id;
 for(const host of ['www.youtube.com','generativelanguage.googleapis.com']){try{await lookup(host);report.network.push({host,resolved:true});}catch(e){report.network.push({host,resolved:false,code:e.code||'DNS'});}}
 if(report.network.some(x=>!x.resolved)||!config.apiKey){report.reason='Network or local configuration unavailable; zero songs analyzed.';}
 else{
  await checkModel(config);report.modelAccessible=true;
  const result=await generate(input,'analyze',{...config,providerRuntime:newProviderRuntime(),onDiagnostic:e=>{report.events.push(e);console.log(JSON.stringify(e));}},new AbortController().signal,undefined,p=>{
   if(['ready','done','update'].includes(p.type)){report.milestones.push({type:p.type,elapsedMs:Date.now()-started,phrases:p.result?.phrases?.length||0,state:p.result?.adaptive?.state});}
  });
  report.result=result.adaptive?.state==='complete'?'completed':'partial';report.phraseCount=result.phrases.length;report.firstResultMs=result.adaptive?.firstResultMs;report.totalMs=Date.now()-started;
  report.note='Analysis completed does not establish listening-verified line or word accuracy, or browser playback.';
 }
}catch(e){report.result='failed';report.code=e.code||e.name||'UNKNOWN';report.status=e.status;}
finally{
 report.elapsedMs=Date.now()-started;const dir=path.join(ROOT,'test-results/provider');await mkdir(dir,{recursive:true});const file=path.join(dir,(report.videoId||'invalid')+'.json');await writeFile(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(`Diagnostic result: ${report.result}\nReport: ${file}`);if(report.result!=='completed')process.exitCode=1;
}
