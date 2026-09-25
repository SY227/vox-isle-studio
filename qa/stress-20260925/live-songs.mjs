#!/usr/bin/env node
/** Real deployed-API checks. One POST per specified video, sequential; no API key input.
 * Never calls a simulation. Reports contain counts/timings only, not full lyrics.
 * HTTP + model data checks are NOT a listening-based singing-accuracy certificate.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseYouTube} from '../../shared/music.mjs';
import {analyze} from '../../public/modules/api.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const argv=process.argv.slice(2),execute=argv.includes('--execute');
let base='https://vox-isle-studio.vercel.app',out=process.env.SF_QA_OUT||path.join(ROOT,'test-results/production-songs-20260925'),provided=[];
for(let i=0;i<argv.length;i++){
 if(argv[i]==='--execute')continue;
 if(argv[i]==='--base'){base=argv[++i];continue;}
 if(argv[i]==='--out'){out=path.resolve(argv[++i]);continue;}
 if(argv[i]==='--help'){console.log('node qa/stress-20260925/live-songs.mjs --execute [--base HTTPS_ORIGIN] [YOUTUBE_URL ...]\nNo --execute: deployment preflight only. --execute: one real billable song request per URL, sequential. Default URLs are the three requested songs.');process.exit(0);}
 if(argv[i].startsWith('--'))throw Error('Unknown option: '+argv[i]);provided.push(argv[i]);
}
const parsed=new URL(base);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=='/')throw Error('Supply a plain HTTP(S) origin without credentials/path');base=parsed.origin;
const defaults=['https://www.youtube.com/watch?v=eV9a5oUCbZQ&list=RDMMYaJ_lYFgr6c&index=2','https://www.youtube.com/watch?v=J2uD1UXLTVs&list=RDMMYaJ_lYFgr6c&index=3','https://www.youtube.com/watch?v=miBGaUagOz8&list=RDMMYaJ_lYFgr6c&index=7'];
const targets=(provided.length?provided:defaults).map(text=>{
 const markdown=text.match(/^\[[^\]]*\]\((https?:\/\/[^\s)]+)\)$/);
 const target=parseYouTube((markdown?markdown[1]:text).replaceAll('\\&','&'));
 if(!target)throw Error('Invalid YouTube URL; no substitute video will be selected.');return target;
});
if(new Set(targets.map(t=>t.id)).size!==targets.length)throw Error('Duplicate song IDs rejected to avoid duplicate billed calls');
await mkdir(out,{recursive:true});
const checkedAt=new Date().toISOString(),summary={checkedAt,base,expectedBuild:'1.2.2',execute,scope:'Real deployed HTTP analysis; playback and listening-verified accuracy not tested',preflight:{},songs:[]};
const safeCode=e=>String(e?.cause?.code||e?.code||e?.name||'UNKNOWN').replace(/[^A-Za-z0-9_-]/g,'').slice(0,80);
let status,preflightError;
try{
 const r=await fetch(base+'/api/status',{cache:'no-store',signal:AbortSignal.timeout(15000)});
 summary.preflight.httpStatus=r.status;
 if(!r.ok){preflightError='STATUS_HTTP_'+r.status;}
 else{status=await r.json();summary.preflight={...summary.preflight,version:status.version,configured:status.configured===true,authenticated:status.authenticated===true};
 if(status.version!=='1.2.2')preflightError='BUILD_DIFFERS_FROM_TESTED_V1_2_2';
 else if(!status.configured)preflightError='MISSING_SERVER_KEY';
 else if(status.requiresAccessCode&&!status.authenticated)preflightError='ACCESS_CODE_REQUIRED';}
}catch(e){preflightError=safeCode(e);summary.preflight.error=preflightError;}
function metrics(score){
 const ps=Array.isArray(score?.phrases)?score.phrases:[],tokens=ps.flatMap(p=>p.tokens||[]),finite=Number.isFinite;
 const text=ps.map(p=>p.tokens.map(t=>t.text).join('')).join('\n');
 const outside=tokens.filter(t=>finite(t.start)&&(!finite(t.end)||t.end<=t.start||t.start<0||t.end>score.duration+.25)).length;
 return {phrases:ps.length,tokens:tokens.length,unalignedLines:score?.unalignedLyrics?.length||0,
  timedWords:tokens.filter(t=>finite(t.start)&&finite(t.end)).length,
  identifiedTechniques:tokens.filter(t=>t.technique&&t.technique!=='unknown').length,
  reviewedWords:tokens.filter(t=>t.annotationStatus==='reviewed').length,
  missingTeaching:tokens.filter(t=>['missing','unavailable','pending'].includes(t.annotationStatus)).length,
  invalidBoundaryCount:outside,transcriptDigest:createHash('sha256').update(text).digest('hex'),
  state:score?.adaptive?.state||'unknown',completeScan:score?.adaptive?.completeScan===true,
  failedTasks:score?.adaptive?.failedTasks??null,completedTasks:score?.adaptive?.completedTasks??null,totalTasks:score?.adaptive?.totalTasks??null,
  timingAccuracy:'not-listening-verified',noteAndRegisterAccuracy:'not-verified'};
}
for(const target of targets){
 const row={videoId:target.id,canonicalUrl:target.url,analysisSubmitted:false,playback:'not-tested',timingAccuracy:'not-measured'};
 if(preflightError){row.result='blocked';row.reason=preflightError;}
 else if(!execute){row.result='not-run';row.reason='--execute required for real API usage';}
 else{
  const started=Date.now(),c=new AbortController(),t=setTimeout(()=>{const e=Error('Overall test deadline');e.code='QA_TOTAL_TIMEOUT';c.abort(e);},280000);let latest;
  row.analysisSubmitted=true;row.milestones=[];
  console.log('LIVE',target.id,'one hosted analysis; no automatic duplicate POST');
  try{
   const result=await analyze(base+'/api/analyze',{source:'youtube',url:target.url,language:'auto'},p=>{
    row.milestones.push({event:'phase',phase:String(p.phase||'').slice(0,40),ms:Date.now()-started});
   },c.signal,p=>{
    latest=p.result;if(row.firstUsableMs===undefined)row.firstUsableMs=Date.now()-started;
    row.milestones.push({event:p.type,ms:Date.now()-started,...metrics(p.result)});
   },{headersMs:20000,idleMs:45000});
   row.final=metrics(result);row.result=row.final.phrases>0&&row.final.state==='complete'&&row.final.completeScan&&row.final.missingTeaching===0&&row.final.invalidBoundaryCount===0?'processing-check-passed':'partial';
   if(!row.final.completeScan)row.reason='TRANSCRIPT_NOT_CONFIRMED_COMPLETE';
   else if(row.final.missingTeaching)row.reason='TEACHING_ENTRIES_MISSING';
   else if(row.final.state!=='complete')row.reason='REFINEMENT_NOT_COMPLETE';
  }catch(e){row.result=latest?'partial':'failed';row.errorCode=safeCode(e);row.requestId=/^[A-Za-z0-9-]{1,80}$/.test(e.requestId||'')?e.requestId:undefined;if(latest)row.final=metrics(latest);}
  finally{clearTimeout(t);row.totalMs=Date.now()-started;}
 }
 summary.songs.push(row);await writeFile(path.join(out,target.id+'.json'),JSON.stringify({checkedAt,base,...row},null,2)+'\n',{mode:0o600});console.log(target.id,row.result,row.reason||row.errorCode||'');
}
summary.result=summary.songs.every(s=>s.result==='processing-check-passed')?'processing-checks-passed':preflightError?'blocked':'not-fully-passed';
summary.noListeningOrPlaybackCertification=true;
await writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});console.log('Report:',path.join(out,'summary.json'));process.exitCode=summary.result==='processing-checks-passed'?0:2;
