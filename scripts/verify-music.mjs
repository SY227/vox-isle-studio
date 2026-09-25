#!/usr/bin/env node
/** Optional LIVE first-result / coverage check; never claims audible accuracy.
 * One job per exact source, sequential; no automatic job replay. No secrets or
 * full lyrics are written. --execute is required for billable provider work. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {lookup} from 'node:dns/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,getConfig} from '../server/config.mjs';
import {parseYouTube} from '../shared/music.mjs';
import {vocalCoverage} from '../shared/vocal-intelligence.mjs';
import {teachingCoverage} from '../shared/annotations.mjs';
import {generate} from '../server/gemini.mjs';
import {newProviderRuntime} from '../server/provider-client.mjs';
const DEFAULTS=['62VyD_SVS40','J2uD1UXLTVs','eV9a5oUCbZQ','miBGaUagOz8'];
export function parseSources(args){
 const supplied=args.filter(a=>!a.startsWith('--'));
 const list=supplied.length?supplied:DEFAULTS.map(id=>'https://www.youtube.com/watch?v='+id);
 return list.map(raw=>{const m=/^\[[^\]]+\]\((https?:[^)]+)\)$/.exec(raw);const target=parseYouTube(m?.[1]||raw);if(!target)throw Error('Invalid YouTube URL; no fallback source substituted.');return target;});
}
export function musicMetrics(a){
 const original=vocalCoverage(a),practice=teachingCoverage(a),quarters=Array.from({length:4},(_,i)=>{
  const phrases=a.phrases.filter(p=>Math.min(3,Math.floor((p.start+p.end)/2/a.duration*4))===i);
  const v=vocalCoverage({...a,phrases,unalignedLyrics:[]}),t=teachingCoverage({phrases});return {quarter:i+1,phrases:phrases.length,original:v,practice:t};
 });
 const key=a.tonality;
 const result=a.adaptive?.state==='complete'&&a.adaptive.completeScan===true&&original.identified>0&&original.missing===0&&original.pending===0&&practice.missing===0?'pipeline-integrity-passed':'partial';
 return {result,accuracy:'not-measured',firstResultMs:a.adaptive?.firstResultMs,processing:a.adaptive?.state,completeScan:a.adaptive?.completeScan,
 phrases:a.phrases.length,original,practice,quarters,key:key?{status:key.status,primary:key.primary,alternative:key.alternative,agreeingWindows:key.agreeingWindows,received:key.received,expected:key.expected,changes:key.changes}:null,
 stages:a.vocalIntelligence,failedTasks:a.adaptive?.failedTasks,calls:a.adaptive?.calls};
}
async function main(){
 const args=process.argv.slice(2);let sources;try{sources=parseSources(args);}catch(e){console.error(e.message);process.exitCode=1;return;}
 if(!args.includes('--execute')){console.log('Dry run. Live analysis can incur provider usage. Add --execute to run.\n'+sources.map(s=>s.url).join('\n'));return;}
 const config=getConfig(),build=JSON.parse(await readFile(path.join(ROOT,'package.json'),'utf8')).version;
 const dir=path.join(ROOT,'test-results','v130-music',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(dir,{recursive:true});
 const network=[];for(const host of ['www.youtube.com','generativelanguage.googleapis.com']){
  try{await Promise.race([lookup(host),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('DNS_TIMEOUT')),8000);t.unref();})]);network.push({host,resolved:true});}
  catch(e){network.push({host,resolved:false,code:e.code||'DNS_TIMEOUT'});}
 }
 const reports=[];
 for(const source of sources){
  const report={build,videoId:source.id,startedAt:new Date().toISOString(),result:'blocked',keyConfigured:!!config.apiKey,network,scope:'Live local provider analysis. Not browser playback or listening-reference accuracy.',events:[]};
  if(!config.apiKey||network.some(n=>!n.resolved)){report.reason='Preflight blocked; zero provider calls.';}
  else{
   const started=Date.now();console.log(`LIVE ${source.id} — one analysis job`);
   const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),265000);
   try{
    const a=await generate({source:'youtube',id:source.id,url:source.url,language:'auto'},'analyze',
     {...config,timeout:260000,providerRuntime:newProviderRuntime(),onDiagnostic:e=>report.events.push(e)},ctrl.signal);
    Object.assign(report,musicMetrics(a),{totalMs:Date.now()-started});
   }catch(e){report.result='failed';report.code=/^[A-Za-z0-9_-]+$/.test(String(e.code))?e.code:e.name;report.totalMs=Date.now()-started;}
   finally{clearTimeout(timeout);}
  }
  reports.push(report);await writeFile(path.join(dir,source.id+'.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(`${source.id} ${report.result}${report.firstResultMs!==undefined?' first-result '+report.firstResultMs+'ms':''}`);
 }
 await writeFile(path.join(dir,'summary.json'),JSON.stringify({build,scope:'Provider processing only; independent musical accuracy NOT measured',reports},null,2)+'\n',{mode:0o600});
 console.log('Report: '+path.join(dir,'summary.json'));if(reports.some(r=>r.result!=='pipeline-integrity-passed'))process.exitCode=1;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))await main();
