#!/usr/bin/env node
/**
 * Genuine end-to-end check: fresh local server -> visible Chrome -> actual
 * /api/analyze -> actual YouTube IFrame API -> advancing media clock.
 * No fixtures, no extraction, no autoplay bypass, no exposed API key.
 * One analysis job: full recording scan, playable transcript, selective timing review, progressive teaching.
 * Provider retries/repair may add billable calls; no fixed two-call assumption.
 */
import {lookup} from 'node:dns/promises';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {getConfig,ROOT} from '../server/config.mjs';
import {createApp} from '../server/index.mjs';
import {parseYouTube} from '../shared/music.mjs';
import {CDP,waitFor} from './lib/live-browser.mjs';

const args=process.argv.slice(2),raw=args.find(a=>!a.startsWith('--'))||'https://www.youtube.com/watch?v=YaJ_lYFgr6c&list=RDeV9a5oUCbZQ&index=2';
if(args.includes('--help')){
  console.log('npm run verify:live -- "YOUTUBE_URL" [--headless]\n使用本機 .env；開啟獨立 Chrome 測試視窗；會產生真實 AI 用量。預設非 headless。\n結果：test-results/live-check.json。報告不包含金鑰、原始 AI 回覆或完整歌詞。');process.exit(0);
}
const target=parseYouTube(raw);if(!target){console.error('請提供有效的 YouTube 影片網址。');process.exit(1);}
const build=JSON.parse(await readFile(path.join(ROOT,'package.json'),'utf8')).version;
const config=getConfig(),out=path.join(ROOT,'test-results');await mkdir(out,{recursive:true});
const report={build,startedAt:new Date().toISOString(),source:target.url,scope:'Real network and real Chrome; no simulated AI or YouTube. Passing media clock is not a human audit of musical accuracy.',checks:[],timingAccuracy:'not-measured; no independently listened reference timeline',result:'not-run'};
const redact=s=>String(s||'').replaceAll(config.apiKey||'\u0000','[REDACTED]').slice(0,800);
function check(name,status,detail=''){report.checks.push({name,status,detail:redact(detail)});console.log(`${status==='passed'?'✓':status==='blocked'?'!':'✕'} ${name}${detail?' — '+redact(detail):''}`);}
let server,chrome,cdp,profile,chromeDone,failed=false;
try {
  console.log('\n聲狐 · 真實歌曲驗收\n來源：'+target.url+'\n本次會呼叫 AI 服務，請保持測試視窗可見；不需再次輸入金鑰。\n');
  const internet=await Promise.all(['www.youtube.com','generativelanguage.googleapis.com'].map(async host=>{
    try{await Promise.race([lookup(host),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('DNS timeout')),8000);t.unref();})]);check('DNS '+host,'passed');return true;}
    catch(e){check('DNS '+host,'blocked',e.code||e.message);return false;}
  }));
  check('本機 API 設定',config.apiKey?'passed':'blocked',config.apiKey?'已設定；不讀出、不儲存金鑰':'請先執行 npm run setup');
  if(!internet.every(Boolean)||!config.apiKey){report.result='blocked';throw new Error('前置條件未通過；未發出歌曲分析請求，也未把阻擋當成測試成功。');}
  const candidates=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser',process.env.PROGRAMFILES&&path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe')].filter(Boolean);
  const executable=candidates.find(existsSync);if(!executable){report.result='blocked';throw new Error('找不到 Chrome。請安裝 Google Chrome，或設定 CHROME_PATH。');}
  // A fresh loopback-only server avoids mistaking an old port-3000 build for this release.
  server=createApp({...config,host:'127.0.0.1',port:0,origin:'',accessCode:'',production:false});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const status=await (await fetch(origin+'/api/status')).json();
  if(status.version!==build)throw new Error('測試伺服器版本不相符。');
  check('新啟動的實際後端','passed','版本 '+status.version);
  profile=await mkdtemp(path.join(tmpdir(),'vox-live-'));
  const flags=[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check','--window-size=1440,1000'];
  if(args.includes('--headless'))flags.push('--headless=new');
  // Do NOT turn off autoplay, sandbox, origin checks, or platform restrictions.
  chrome=spawn(executable,[...flags,'about:blank'],{stdio:'ignore'});
  let chromeError;chrome.on('error',e=>{chromeError=e;});chromeDone=new Promise(resolve=>chrome.once('close',resolve));
  const devtools=await waitFor(async()=>{
    if(chromeError)throw chromeError;if(chrome.exitCode!==null)throw new Error('Chrome 提早結束，請檢查本機瀏覽器政策。');
    try{return (await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return null;}
  },20000);
  const tabs=await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json();
  const tab=tabs.find(t=>t.type==='page');if(!tab?.webSocketDebuggerUrl)throw new Error('Chrome 沒有可操作的測試分頁。');
  cdp=await CDP.connect(tab.webSocketDebuggerUrl);await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Page.bringToFront');
  const nav=await cdp.send('Page.navigate',{url:origin});
  if(nav.errorText){report.result='blocked';throw new Error('Chrome 導覽被阻擋：'+nav.errorText);}
  await waitFor(()=>cdp.evaluate('typeof window.voxDiagnostics==="function"&&Boolean(document.querySelector("#song-url"))'),20000);
  check('實際 UI 載入','passed');
  if(await cdp.evaluate('Boolean(document.querySelector("#rights-input"))'))throw new Error('舊版權利勾選框仍存在。');
  check('無歌曲權利勾選框','passed');
  await cdp.evaluate(`(()=>{const i=document.querySelector('#song-url');i.value=${JSON.stringify(target.url)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const analysisStarted=Date.now();
  await cdp.click('#song-form button[type=submit]');
  await waitFor(()=>cdp.evaluate('window.voxDiagnostics().loading||window.voxDiagnostics().page==="studio"||Boolean(window.voxDiagnostics().error)'),15000);
  const progress=await cdp.evaluate('Boolean(document.querySelector("#analysis-progress"))');check('載入進度條',progress?'passed':'failed');if(!progress)failed=true;
  const result=await waitFor(async()=>{
    const d=await cdp.evaluate('window.voxDiagnostics()');if(d?.error)throw new Error('真實分析未完成：'+d.error);
    return d?.page==='studio'&&!d.loading?d:null;
  },config.timeout+25000,750);
  report.firstStudioMs=Date.now()-analysisStarted;report.firstAdaptive=result.adaptive;
  check('真實全曲首輪已展開可用樂譜','passed',`${result.timedTokens} 個逐字時間；${result.unalignedLines} 行待對齊；首輪 ${report.firstStudioMs}ms`);
  const adaptive=['adaptive-recording-v1','adaptive-recording-v2'].includes(result.adaptive?.version);
  check('使用自適應而非強制逐段核對',adaptive?'passed':'failed');if(!adaptive)failed=true;
  report.refiningWhenStudioOpened=Boolean(result.refining);
  check('工作室已在首輪後開啟','passed',result.refining?'後續精修仍在執行；播放不需等待':'後續已很快結束；沒有觀察到進行中精修');
  const phraseCount=await cdp.evaluate('document.querySelectorAll(".phrase-row").length');
  if(!phraseCount){check('至少一行有時間可供跟唱','failed');failed=true;}
  // These checks measure plumbing. They cannot certify the sung-word boundaries.
  if(!result.timedTokens)check('逐字邊界','blocked','目前只有樂句同步，不捏造逐字邊界');
  const ready=await waitFor(async()=>{const p=(await cdp.evaluate('window.voxDiagnostics()')).playback;return p.ready||['native','error','missing'].includes(p.status)?p:null;},35000);
  if(!ready.ready){check('YouTube 同步播放器','failed',ready.message);report.result='failed';throw new Error('原生影片可能仍可播放，但同步控制未通過；不能宣稱完整成功。');}
  check('真實 YouTube onReady','passed');
  // Start on the native YouTube player first; the app button has never been hit.
  // This is a trusted click on its center play overlay, not playVideo() via JS.
  await cdp.click('#youtube-mount iframe');
  const started=await waitFor(async()=>{const p=(await cdp.evaluate('window.voxDiagnostics()')).playback;return p.playing?p:null;},16000);
  const later=await waitFor(async()=>{const p=(await cdp.evaluate('window.voxDiagnostics()')).playback;return p.playing&&p.time>=started.time+2?p:null;},15000,750);
  check('YouTube 原生播放先啟動，實際時鐘前進','passed',`${started.time.toFixed(2)}s → ${later.time.toFixed(2)}s`);
  await cdp.click('#play-toggle');
  const paused=await waitFor(async()=>!(await cdp.evaluate('window.voxDiagnostics()')).playback.playing,5000);
  check('上方唯一播放列可暫停同一原片',paused?'passed':'failed');
  await cdp.click('#play-toggle');
  await waitFor(async()=>(await cdp.evaluate('window.voxDiagnostics()')).playback.playing,10000);
  check('上方唯一播放列可繼續播放','passed');
  await cdp.click('#play-toggle');
  const oneControl=await cdp.evaluate('document.querySelectorAll("[data-action=play]").length===1&&Boolean(document.querySelector(".studio-chrome #play-toggle"))');
  check('唯一播放列位於頂部',oneControl?'passed':'failed');if(!oneControl)failed=true;
  const coverage=await cdp.evaluate('document.querySelector(".tech-coverage")?.textContent||""');
  check('全曲唱法覆蓋資訊','passed',coverage); // Coverage is disclosed, not certified as 100%.
  const highlights=await cdp.evaluate('document.querySelectorAll(".token.played,.token.current,.token.upcoming").length');
  const total=await cdp.evaluate('document.querySelectorAll(".token").length');
  check('已建立媒體時間驅動的歌詞狀態',highlights===total?'passed':'failed',`${highlights} / ${total} 個字；狀態不等於真人聽辨的時序準確度`);
  if(highlights!==total)failed=true;
  const final=await waitFor(async()=>{const d=await cdp.evaluate('window.voxDiagnostics()');return !d.refining?d:null;},config.timeout+25000,1500);
  report.finalAdaptive=final.adaptive;
  const complete=final.adaptive?.state==='complete';
  check('精修完成或可用結果保留',final.page==='studio'?'passed':'failed',`精修狀態 ${final.adaptive?.state||'unknown'}；失敗工作 ${final.adaptive?.failedTasks||0}`);
  if(!complete||final.page!=='studio')failed=true;
  const nativeStill=await cdp.evaluate('Boolean(document.querySelector("#youtube-mount iframe"))');
  check('精修後保留原片播放器',nativeStill?'passed':'failed');if(!nativeStill)failed=true;
  report.result=failed?'partial':'passed';
  console.log('\n已測真實傳輸與播放。這不代表歌詞、每個音高或聲樂教法已經真人逐項核對。');
} catch(e){
  if(report.result==='not-run')report.result='failed';
  report.failure=redact(e.message);check('整體驗收',report.result==='blocked'?'blocked':'failed',report.failure);process.exitCode=1;
} finally {
  if(cdp){try{await cdp.send('Browser.close');}catch{}cdp.close();}
  if(chrome&&chrome.exitCode===null){chrome.kill('SIGTERM');await Promise.race([chromeDone,new Promise(r=>setTimeout(r,2500))]);if(chrome.exitCode===null)chrome.kill('SIGKILL');}
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  if(profile)await rm(profile,{recursive:true,force:true}).catch(()=>{});
  report.finishedAt=new Date().toISOString();
  await writeFile(path.join(out,'live-check.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log('\n驗收報告：'+path.join(out,'live-check.json')+'\n結果：'+report.result);
  if(report.result!=='passed')process.exitCode=1;
}
