#!/usr/bin/env node
/** Live acceptance only: real configured provider + Chrome, never fixtures. */
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from '../server/config.mjs';
const sources=[
  {id:'YaJ_lYFgr6c',url:'https://www.youtube.com/watch?v=YaJ_lYFgr6c&list=RDeV9a5oUCbZQ&index=2'},
  {id:'4ULVNHHqbew',url:'https://www.youtube.com/watch?v=4ULVNHHqbew&list=RD4ULVNHHqbew&start_radio=1'}
];
if(process.argv.includes('--help')){
 console.log('npm run verify:links\n依序測試兩條提供的 YouTube 連結。使用本機 .env，會產生真實 AI 用量。\n報告存於 test-results/live-links/；blocked 不是通過。');process.exit(0);
}
const out=path.join(ROOT,'test-results/live-links');await mkdir(out,{recursive:true});const reports=[];
for(const source of sources){
 console.log('\n=== '+source.id+' ===');
 const child=spawn(process.execPath,[path.join(ROOT,'scripts/verify-live.mjs'),source.url,...(process.argv.includes('--headless')?['--headless']:[])],{cwd:ROOT,stdio:'inherit'});
 const exitCode=await new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',reject);});
 const report=JSON.parse(await readFile(path.join(ROOT,'test-results/live-check.json'),'utf8'));
 reports.push({id:source.id,url:source.url,result:report.result,exitCode});
 await writeFile(path.join(out,source.id+'.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
}
await writeFile(path.join(out,'summary.json'),JSON.stringify({checkedAt:new Date().toISOString(),scope:'Real network, real local API configuration; not musical ground-truth accuracy',reports},null,2)+'\n',{mode:0o600});
if(reports.some(r=>r.result!=='passed'))process.exitCode=1;
console.log('\nReports: '+out);
