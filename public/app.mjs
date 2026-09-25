import {Avatar} from './modules/avatar.mjs?v=1.2.1';
import {icon,esc,toast,modal,closeModal,saveFile} from './modules/ui.mjs?v=1.2.1';
import {Player} from './modules/player.mjs?v=1.2.1';
import {Recorder,decodeFile,toBase64,scanPitch,playNotes,stopNotes,speak} from './modules/audio.mjs?v=1.2.1';
import * as api from './modules/api.mjs?v=1.2.1';
import {noteName,clock,clamp,TECHNIQUES,ORNAMENTS,parseYouTube,rangeFromPhrases} from '/shared/music.mjs?v=1.2.1';
import {normalizeAnalysis} from '/shared/schema.mjs?v=1.2.1';
import {lyricState,tokenLyricState} from '/shared/lyric-clock.mjs?v=1.2.1';
import {teachingCoverage} from '/shared/annotations.mjs?v=1.2.1';

const $=q=>document.querySelector(q),$$=q=>[...document.querySelectorAll(q)];
const state={page:'home',mode:'youtube',url:'',language:'auto',lyrics:'',advanced:false,solo:false,file:null,
  analysis:null,source:null,selectedPhrase:0,selectedToken:0,showRoman:true,filter:'all',transpose:0,offset:0,rate:1,time:0,
  loading:false,phase:'accepted',error:'',backend:{configured:false},take:null,feedback:null,recording:false,micPending:false,coaching:false,measured:null,localPitchFrames:[],library:[],coachRights:false,playerIssue:''};
let avatar,abortController,loadingTimer,recorder,recordUrl,uploadUrl,activation=0;
let analysisRun=0,analysisInput=null,lessonAbort=null,lessonTimer=null;
const lessons=new Map(),editedPhrases=new Set();
state.refining=false;state.lessonPending=-1;state.lessonError=-1;
const BUILD='1.2.1';
try{const saved=JSON.parse(localStorage.getItem('vox-isle-library-v1')||'[]');state.library=Array.isArray(saved)?saved.slice(0,8):[];}catch{}
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const player=new Player(onTick,onPlayerState,message=>{state.playerIssue=message;});
$('#app').innerHTML=`<div class="studio-chrome"><header class="topbar"><button class="brand" data-action="home" aria-label="聲嶼首頁"><span class="brand-symbol">${icon('wave',36)}</span><span><span class="brand-main">聲嶼</span><span class="brand-en" style="display:block">VOX ISLE</span></span></button><nav class="nav" aria-label="主選單"><button data-action="studio-nav" id="nav-studio">練歌室</button></nav></header><section id="player-dock" class="player-dock" aria-label="歌曲播放控制" hidden></section></div><main id="main" class="app-main" tabindex="-1"></main><div id="youtube-parking" class="youtube-parking" aria-hidden="true"><div id="youtube-mount"></div></div><input id="source-audio" type="file" accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg" class="hidden"><input id="library-import" type="file" accept="application/json,.json" class="hidden">`;

// A measured offset keeps the sticky controls, legend, and video from overlapping
// at any screen width or browser text size.
if('ResizeObserver' in window)new ResizeObserver(entries=>{
  document.documentElement.style.setProperty('--chrome-height',Math.ceil(entries[0].target.getBoundingClientRect().height)+'px');
}).observe($('.studio-chrome'));
let lyricNodes=[],lyricRows=[],lastSyncedTime=NaN,lastSyncedOffset=NaN;
function rebuildLyricNodes(){
  lastSyncedTime=NaN;lastSyncedOffset=NaN;lyricNodes=[];lyricRows=[];
  for(let pi=0;pi<(state.analysis?.phrases.length||0);pi++){
    const p=state.analysis.phrases[pi],row=$(`#phrase-${pi}`);
    if(!row)continue;lyricRows.push({p,pi,element:row,last:''});
    p.tokens.forEach((t,ti)=>{const element=$(`[data-token="${pi}:${ti}"]`);if(element)lyricNodes.push({t,p,pi,ti,element,last:''});});
  }
}
function languageLabel(language){return {cantonese:'粵語',mandarin:'國語',mixed:'粵／國混合',unknown:'待確認'}[language]||'自動';}
function labelKind(){return state.analysis?.provenance?.kind==='demo-score'?'原創教學示範':state.analysis?.provenance?.kind==='imported'?'匯入資料 · 未驗證':state.analysis?.provenance?.kind==='user-edited'?'已手動校正':state.analysis?.adaptive?'原聲聆聽 · AI 估計':state.analysis?.listening?'原聲逐段聆聽 · AI 估計':'AI 估計 · 可校正';}
function sourceCard(){
  if(state.source?.kind!=='youtube')return '';
  return `<section id="youtube-sidecar" class="source-sidecar" aria-label="原片播放器"><div class="source-sidecar-head"><div><span class="eyebrow">ORIGINAL VIDEO</span><strong>原片</strong></div><a id="youtube-open" class="youtube-open" href="${esc(state.source.url)}" target="_blank" rel="noopener noreferrer">YouTube ↗</a></div><div id="youtube-slot" class="source-video-slot"></div><div class="source-sidecar-body"><p id="media-message" role="status" aria-live="polite">正在準備原片…</p><div class="source-sidecar-actions"><button class="secondary" data-action="retry-player">${icon('loop',14)} 重新連線</button><button class="text-btn" data-action="attach-audio">連結本機音訊</button></div><small>在原片內播放，或使用上方播放列，歌詞都會跟隨。</small></div></section>`;
}
function parkYouTubeMount(){const mount=$('#youtube-mount'),parking=$('#youtube-parking');if(mount&&parking&&mount.parentElement!==parking)parking.append(mount);}
function dockYouTubeMount(){
  const mount=$('#youtube-mount'),slot=$('#youtube-slot'),parking=$('#youtube-parking');
  if(!mount)return;
  if(slot&&mount.parentElement!==slot)slot.append(mount);
  else if(!slot&&parking&&mount.parentElement!==parking)parking.append(mount);
}
function phrase(){return state.analysis?.phrases[state.selectedPhrase];}
function token(){return phrase()?.tokens[state.selectedToken]||phrase()?.tokens[0];}
function lyrics(p){return p.tokens.map(t=>t.text).join('');}
function updateHeader(){
  $('#nav-studio').classList.toggle('active',['home','studio','loading'].includes(state.page));
}
function setAvatar(){avatar?.dispose();const mount=$('#avatar');avatar=mount?new Avatar(mount):null;avatar?.setState({technique:token()?.technique||'mix',playing:player.playing});}
function render(){parkYouTubeMount();avatar?.dispose();avatar=null;updateHeader();
  if(state.page==='home')renderHome();else if(state.page==='studio')renderStudio();else if(state.page==='practice')renderPractice();else if(state.page==='library')renderLibrary();else if(state.page==='loading')renderLoading();
  dockYouTubeMount();
  setAvatar();
  renderDock();
  rebuildLyricNodes();
  syncPlayerControls();
  if(state.analysis)syncLyricProgress(state.time);
}
function renderHome(){
  $('#main').innerHTML=`<section class="landing"><div class="hero"><div class="hero-copy"><div class="eyebrow">為粵語與國語而生 · YOUR VOCAL ATELIER</div><h1>每一句歌，<br>都有<em>你的唱法。</em></h1><p class="hero-description">貼上你喜歡的歌。讓歌詞、旋律與呼吸，<br>變成一條看得懂的練習路線。</p><form id="song-form" class="input-card"><div class="source-tabs"><button type="button" class="${state.mode==='youtube'?'active':''}" data-action="source-youtube">${icon('play',15)} YouTube 連結</button><span class="divider"></span><button type="button" class="${state.mode==='upload'?'active':''}" data-action="source-upload">${icon('upload',15)} 音訊檔</button></div>
  <div class="source-input">${state.mode==='youtube'?`<div class="url-wrap">${icon('link',18)}<input class="url-input" id="song-url" type="url" value="${esc(state.url)}" placeholder="貼上 YouTube 歌曲連結…" aria-label="YouTube 歌曲連結" autocomplete="off"></div>`:`<label class="drop-zone" for="song-file">${icon('upload',23)}<span><strong id="file-title">${esc(state.file?.name||'選擇你的音訊檔')}</strong><small>MP3 / WAV / M4A 等 · 最多 6 分鐘、50 MB</small></span><input id="song-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg" class="hidden"></label>`}<button class="primary warm" type="submit">打開這首歌 ${icon('upRight',17)}</button></div>
  <div class="form-foot"><select id="song-language" aria-label="歌曲語言"><option value="auto" ${state.language==='auto'?'selected':''}>自動辨識 · 粵語／國語</option><option value="cantonese" ${state.language==='cantonese'?'selected':''}>粵語歌曲</option><option value="mandarin" ${state.language==='mandarin'?'selected':''}>國語歌曲</option></select><span class="hint">${state.mode==='youtube'?'公開單曲 · 最多 15 分鐘':'本機轉換 · 按下分析才上傳'}</span></div>
  ${state.mode==='upload'?`<label class="consent"><input type="checkbox" id="solo-input" ${state.solo?'checked':''}><span>這是清唱或已分離主唱；額外執行本機音高量測。</span></label>`:''}
  <p class="source-disclosure">直接聆聽原聲，自動產生歌詞、時間與唱法。不需要準備歌詞。按下按鈕後，來源會送往 Google 分析。</p>
  <div class="details-toggle"><button type="button" data-action="limits">${icon('info',12)} 分析說明</button></div>
  </form>${state.error?`<div class="error-banner" role="alert">${esc(state.error)}</div>`:''}
  <button class="demo-link" data-action="demo"><span>還沒有準備好歌曲？<strong>先體驗《微光練習曲》</strong></span>${icon('arrow',17)}</button></div>
  <div class="hero-art" aria-label="動畫聲音嚮導展示"><div class="orbit"></div><div class="orbit two"></div><div class="orbit three"></div><span class="hero-note">A LITTLE GUIDANCE.</span><div id="avatar" class="avatar-canvas hero-avatar"></div><div class="floating-tag tag-a"><span class="tag-icon">${icon('wave',18)}</span><span>讓聲音自然連起來<small>FIND YOUR FLOW</small></span></div><div class="floating-tag tag-b"><span class="tag-icon">${icon('music',18)}</span><span>真聲・混聲・假聲<small>ONE LINE AT A TIME</small></span></div><div class="floating-tag tag-c"><span class="tag-icon">${icon('spark',18)}</span><span>轉音，慢慢就會了<small>SMALL STEPS. YOUR VOICE.</small></span></div><div class="guide-label">澄，你的聲音嚮導<span>MEET CHENG · YOUR VOCAL COMPANION</span></div></div></div>
  <div class="arrival-bottom"><article class="feature-item"><span class="feature-number">01 /</span><div><h3>歌詞，就是你的練習譜</h3><p>自動轉錄、同步亮字。在哪裡轉音、如何銜接，<br>直接在歌詞上看懂。</p></div></article><article class="feature-item"><span class="feature-number">02 /</span><div><h3>難的地方，一個字一個字拆</h3><p>點開一句，聽慢速提示音。帶著具體建議，<br>找到更適合自己的唱法。</p></div></article><article class="feature-item"><span class="feature-number">03 /</span><div><h3>原片與歌詞，同一個時間軸</h3><p>按一次播放，原片、進度與逐字歌詞一起走。<br>已播放、正在唱、還未到，一眼分清。</p></div></article></div><footer class="landing-footer"><span>VOX ISLE — A STUDIO FOR YOUR OWN VOICE.</span><span>繁體中文 / 粵語 · 國語</span></footer></section>`;
}
function renderStudio(){
  if(!state.analysis){state.page='home';renderHome();return;}
  const a=state.analysis,r=a.range?.low!=null?a.range:a.firstScanRange||rangeFromPhrases(a.phrases),runs=a.phrases.reduce((n,p)=>n+p.tokens.filter(t=>t.ornaments.includes('run')).length,0);
  const coverage=teachingCoverage(a);
  const aligned=a.phrases.reduce((n,p)=>n+p.tokens.filter(t=>Number.isFinite(t.start)).length,0),unaligned=(a.unalignedLyrics||[]).reduce((n,line)=>n+Array.from(line).length,0);
  $('#main').innerHTML=`<section class="studio"><div class="breadcrumb"><button data-action="home">練歌室</button><span>/</span><span>${esc(a.title)}</span><span style="margin-left:auto" class="mono">VOCAL BLUEPRINT / 01</span></div><div class="song-top"><div class="song-id"><div><h1>${esc(a.title)}</h1><div class="song-meta"><span class="artist">${esc(a.artist||'演唱者待確認')}</span><span>·</span><span>${languageLabel(a.language)}</span><button class="pill ${a.provenance?.kind==='demo-score'?'warm':'mint'}" data-action="limits">${esc(labelKind())}</button></div></div></div><div class="song-actions"><div class="song-tools"><button class="secondary" data-action="export" title="匯出樂譜" aria-label="匯出樂譜">${icon('download',15)}<span class="button-label">匯出</span></button><button class="secondary" data-action="home" title="匯入另一首" aria-label="匯入另一首">${icon('plus',16)}</button></div></div></div>
  <div class="range-strip"><div class="range-block"><div class="range-stat"><small>最低旋律音 ${a.provenance?.kind==='demo-score'?'':'· 估計'}</small><strong>${noteName(r.low)}</strong></div><div class="range-stat"><small>最高旋律音 ${a.provenance?.kind==='demo-score'?'':'· 估計'}</small><strong>${noteName(r.high)}</strong></div><div class="range-stat"><small>常見音區 · 音符分布</small><strong class="tiny">${noteName(r.typicalLow)} <span style="color:#5f8385">—</span> ${noteName(r.typicalHigh)}</strong></div><div class="range-stat"><small>標記的轉音</small><strong>${runs}<sup>處</sup></strong></div></div><button class="range-note" data-action="limits">${icon('info',14)}<span>${a.provenance?.kind==='demo-score'?'原創合成旋律示範，非真人演唱。唱法標記是可探索的教學選項。':'音高與逐字時間為 AI 估計。唱法是練習建議，不是原唱聲區判定。'}</span></button></div>
  <div id="refinement-status">${refinementStatus()}</div><div id="quality-slot">${qualityNotice(a)}</div><div class="workspace studio-performance-grid"><div class="score-column"><section class="panel lyrics-panel"><div class="section-head"><div><h2>完整歌詞 · 跟著原聲走</h2><div class="caption">FULL SONG · ${a.phrases.length} 個同步樂句 · ${aligned} 字有時間估計${unaligned?` · ${unaligned} 字待對齊`:''}</div></div><div class="lyric-toolbar"><button class="mini-btn ${state.showRoman?'active':''}" data-action="roman" aria-pressed="${state.showRoman}">拼音</button><button class="mini-btn" data-action="edit" aria-label="校正歌詞與時間">${icon('edit',12)} 校正</button></div></div><div class="notation-heading"><span>每一段，都有練習方向</span><span class="tech-coverage" aria-label="全曲唱法覆蓋">${coverage.identified} / ${coverage.total} 字有唱法${coverage.unknown?` · ${coverage.unknown} 字待確認`:""}</span></div><div class="legend" aria-label="全曲唱法篩選"><span class="legend-label">建議唱法</span><button data-filter="all" aria-pressed="${state.filter==='all'}" class="${state.filter==='all'?'active':''}">全部</button>${Object.entries(TECHNIQUES).filter(([k])=>k!=='unknown'||coverage.unknown>0).map(([k,v])=>`<button data-filter="${k}" aria-pressed="${state.filter===k}" class="${state.filter===k?'active':''}" style="--tech:${v.color}"><i></i>${v.label}</button>`).join('')}<button data-filter="run" aria-pressed="${state.filter==='run'}" class="${state.filter==='run'?'active':''}" style="color:var(--peach)">↝ 轉音</button></div><div class="lyrics-scroll ${state.showRoman?'':'no-roman'}" id="lyrics-scroll">${renderLyrics()}</div><div class="lyric-bottom"><span>整首歌詞完整列出 · <span class="sync-key sync-done">已播放</span> · <span class="sync-key sync-now">正在唱</span> · <span class="sync-key sync-next">未播放</span> · <span style="color:var(--peach)">↝</span> 轉音</span><div class="timing-control"><span>歌詞偏移</span><button data-action="offset-minus" aria-label="歌詞提前零點一秒">−</button><code id="offset-label">${signed(state.offset)}s</code><button data-action="offset-plus" aria-label="歌詞延後零點一秒">＋</button></div></div></section><section class="panel score-map"><div class="section-head"><h2>這首歌的高低起伏</h2><span class="pill">${esc(a.key||'調性待確認')} · ${clock(a.duration)}</span></div><div id="pitch-map">${pitchMap()}</div><div class="map-foot">${a.provenance?.kind==='demo-score'?'DEMO SCORE':'AI-ESTIMATED MELODY'} · 點擊音圖定位 · 字內分音時間僅為示意</div></section>${state.measured?`<div class="source-note">${icon('wave',12)}<span>清唱音訊的本機單音量測：${noteName(state.measured.low)}–${noteName(state.measured.high)}，保留 ${state.measured.events?.length||0} 個持續音。這不等於完整個人音域。</span></div>`:''}<div class="source-note">${icon('shield',12)}<span>${state.source?.kind==='demo'?'示範歌詞與旋律為本專案原創；不含商業歌曲或人聲素材。':'分析只包含這次來源可聽到的內容；可逐句校正，也可匯出你的樂譜。'}</span></div></div>
  <aside class="studio-side-rail">${sourceCard()}<section class="coach-panel"><div class="coach-name"><div><strong>澄 · 你的聲音嚮導</strong><small>YOUR VOCAL COMPANION</small></div><span class="pill mint">${icon('spark',10)} 逐句陪練</span></div><div class="coach-avatar-wrap"><div id="avatar" class="avatar-canvas coach-avatar"></div><div id="coach-mode" class="coach-mode">${esc(TECHNIQUES[token()?.technique||'unknown'].label)} · 練習選項</div></div><div id="coach-detail" class="coach-detail">${coachDetail()}</div><div class="coach-foot">角色動作與發光是教學比喻，不是發聲器官的模擬。<br>不需硬推高音；不適時停止練習。</div></section></aside></div></section>`;
}
function signed(n){return (n>0?'+':'')+Number(n).toFixed(1);}
function renderLyrics(){
  const a=state.analysis;
  const synced=(a?.phrases||[]).map((p,pi)=>`<div class="phrase-row ${pi===state.selectedPhrase?'selected':''}" id="phrase-${pi}" data-phrase-row="${pi}"><button class="row-time" data-phrase-seek="${pi}" aria-label="前往 ${clock(p.start)}"><span>${clock(p.start)}<br><span class="section-mini">${esc(p.section)}</span>${p.tokens.some(t=>!Number.isFinite(t.start))?'<br><span class="section-mini">樂句同步</span>':''}</span></button><div class="phrase-tokens">${p.tokens.map((t,ti)=>{
    const label=t.annotationStatus==='pending'?(state.refining?'分析中':'待補上'):TECHNIQUES[t.technique].label,orn=t.ornaments.includes('run')?'↝':t.ornaments.includes('slide')?'⌁':t.ornaments.includes('breath')?'˅':t.ornaments.includes('transition')?'↗':t.ornaments.includes('vibrato')?'∿':'';
    const dim=state.filter!=='all'&&(state.filter==='run'?!t.ornaments.includes('run'):state.filter!==t.technique);
    return `<button class="token t-${t.technique} ${pi===state.selectedPhrase&&ti===state.selectedToken?'selected':''} ${dim?'dim':''} ${t.ornaments.includes('run')?'has-run':''}" data-token="${pi}:${ti}" data-technique="${t.technique}" aria-label="${esc(t.text)}，${label}建議，${t.notes.map(noteName).join('、')||'音高待確認'}${orn?'，'+t.ornaments.map(o=>ORNAMENTS[o]).join('、'):''}"><span class="roman">${esc(t.romanization)}</span><span class="han">${esc(t.text)}</span><span class="note">${t.notes.length>1?noteName(t.notes[0])+' ↝':noteName(t.notes[0])}</span><span class="tech-mini">${label}${t.annotationStatus==='pending'?'':t.confidence==='low'?' ?':''}</span>${orn?`<span class="ornament">${orn}</span>`:''}</button>`;
  }).join('')}</div></div>`).join('');
  const untimed=(a?.unalignedLyrics||[]).length?`<section class="lyrics-unaligned" aria-label="待對齊歌詞"><div class="lyrics-unaligned-head"><strong>待對齊歌詞</strong><span>已保留原辨識文字 · 不冒充同步時間</span></div>${a.unalignedLyrics.map(line=>`<p>${esc(line)}</p>`).join('')}</section>`:'';
  return synced||untimed?`${synced}${untimed}`:'<div class="untimed-empty"><h3>尚未取得可顯示的歌詞。</h3><p>可重試分析或提供較清楚的來源。</p></div>';
}
function coachDetail(){
  const p=phrase(),t=token();if(!p||!t)return '<h2>先聽，慢慢來。</h2><p>這次沒有足夠可靠的逐字時間。已保留辨識到的歌詞，暫不產生虛構的音符或練習對齊。</p>';
  const notes=t.notes.map(n=>n+state.transpose),run=t.ornaments.includes('run');
  return `<div class="eyebrow">${run?'TURN THE RUN INTO SMALL STEPS':'ONE WORD. ONE SMALL STEP.'}</div><h2><span class="coach-word">「${esc(t.text)}」</span>${run?'的轉音，<br>一步一步來。':'，找到舒服的唱法。'}</h2><div class="spread"><span class="pill t-${t.technique}" style="color:var(--tech)">${TECHNIQUES[t.technique].label} · 可嘗試</span><span class="subtle mono" style="font-size:9px">${Number.isFinite(t.start)?clock(t.start,true)+' — '+clock(t.end,true):'樂句同步 · 逐字待確認'}</span></div>
  <div class="note-run">${notes.length?notes.map((n,i)=>`${i?icon('arrow',12):''}<span>${noteName(n)}</span>`).join(''):'<span style="font-family:var(--font);font-size:10px">音高待確認，暫不播放提示音</span>'}</div>${state.transpose?`<small class="muted">提示音已移調 ${state.transpose>0?'+':''}${state.transpose} 半音；原音不變。</small>`:''}
  ${t.confidence==='low'&&t.annotationStatus!=='pending'?`<div class="low-confidence">${icon('info',12)} 此字聽辨不確定，請先核對。</div>`:''}${lessonStatus()}<p><strong style="color:#24484b">${esc(p.focus)}</strong><br>${esc(p.instruction)}</p><div class="coach-actions"><button class="secondary" data-action="hear-word" ${notes.length?'':'disabled'}>${icon('music',13)} 慢速拆音</button><button class="secondary" data-action="speak">${icon('volume',13)} 朗讀教學</button></div><details><summary>咬字與練法 ${icon('chevron',12)}</summary><p>${esc(p.pronunciation)}</p><p>${esc(p.exercise)}</p><p style="color:#7f9ca2">${esc(p.caution)}</p></details>`;
}
function pitchMap(){
  if(state.analysis.range?.low==null)return '<p class="untimed-empty">音高仍待確認；沒有建立猜測的旋律地圖。</p>';
  const a=state.analysis,r=a.range,min=(r.low??48)-2,max=(r.high??84)+2,w=700,h=100,left=43,right=680,top=13,bottom=77;
  const x=t=>left+(t/a.duration)*(right-left),y=n=>bottom-(n-min)/(max-min)*(bottom-top);
  const ticks=[Math.round(min+2),Math.round((max+min)/2),Math.round(max-2)];let shapes='';
  for(const n of ticks)shapes+=`<line x1="${left}" y1="${y(n)}" x2="${right}" y2="${y(n)}" stroke="#315a5b12"/><text x="13" y="${y(n)+3}" font-size="8" fill="#57797d" font-family="monospace">${noteName(n)}</text>`;
  for(const p of a.phrases)for(const t of p.tokens)for(let i=0;i<t.notes.length;i++){
    if(!Number.isFinite(t.start)||!Number.isFinite(t.end))continue;
    const n=t.notes[i],start=t.start+(t.end-t.start)*i/t.notes.length,end=t.start+(t.end-t.start)*(i+1)/t.notes.length;
    shapes+=`<line x1="${x(start).toFixed(2)}" y1="${y(n).toFixed(2)}" x2="${x(end).toFixed(2)}" y2="${y(n).toFixed(2)}" stroke="${TECHNIQUES[t.technique].color}" stroke-width="2" stroke-linecap="round" opacity=".7"/>`;
    if(i>0)shapes+=`<line x1="${x(start)}" y1="${y(t.notes[i-1])}" x2="${x(start)}" y2="${y(n)}" stroke="#edb89e" stroke-width=".8" opacity=".45"/>`;
    if(n===r.high)shapes+=`<circle cx="${x((start+end)/2)}" cy="${y(n)}" r="2.8" fill="#eed2a6"/>`;
  }
  return `<svg id="melody-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="歌曲旋律音高地圖，音高來源 ${esc(labelKind())}">${shapes}<line id="map-playhead" x1="${x(state.time)}" x2="${x(state.time)}" y1="6" y2="83" stroke="#2d645f" stroke-width="1" opacity=".7"/><text x="${left}" y="95" font-size="8" fill="#617f83" font-family="monospace">0:00</text><text x="${right}" y="95" text-anchor="end" font-size="8" fill="#617f83" font-family="monospace">${clock(a.duration)}</text></svg>`;
}
function renderDock(){
  const dock=$('#player-dock');if(!state.analysis||state.page!=='studio'){dock.hidden=true;return;}dock.hidden=false;
  dock.innerHTML=`<div class="player-track"><span><strong>${esc(state.analysis.title)}</strong><small>${state.source?.kind==='demo'?'原創合成旋律 · 非真人演唱':state.source?.kind==='youtube'?'YouTube 原聲 · 不變調':'原始音訊 · 不變調'}${state.source?.kind==='youtube'?` · <a class="player-source-link" href="${esc(state.source.url)}" target="_blank" rel="noopener noreferrer">原片 ↗</a>`:''}</small><small id="playback-status" role="status">準備播放器…</small></span></div><div class="player-center"><div class="transport"><button data-action="previous" aria-label="上一句">${icon('prev',15)}</button><button data-action="play" id="play-toggle" class="big-play" aria-label="${player.ready?'播放':state.playerIssue?'頁內原片不可播放':'播放器連線中'}" ${player.ready?'':'disabled'} title="${esc(player.ready?'播放':state.playerIssue?'頁內原片不可播放；可點左側原片連結':'播放器連線中…')}">${icon('play',17)}</button><button data-action="next" aria-label="下一句">${icon('next',15)}</button><button data-action="loop" id="loop-toggle" class="loop ${player.loop?'active':''}" aria-label="循環目前樂句" aria-pressed="${Boolean(player.loop)}">${icon('loop',15)}</button></div><div class="seek-wrap"><span id="elapsed">${clock(state.time)}</span><input type="range" id="seek" min="0" max="${state.analysis.duration}" step="0.05" value="${state.time}" aria-label="歌曲播放位置"><span id="total-duration">${clock(state.analysis.duration)}</span></div></div><div class="player-tools"><select id="rate-select" aria-label="播放速度">${[.5,.75,1,1.25].map(r=>`<option value="${r}" ${state.rate===r?'selected':''}>${r}×</option>`).join('')}</select><div><div class="transpose"><button data-action="transpose-down" aria-label="提示音降低半音">−</button><span id="transpose-value">${state.transpose>0?'+':''}${state.transpose}</span><button data-action="transpose-up" aria-label="提示音提高半音">＋</button></div><div class="transpose-label">只移調提示音</div></div></div>`;
  syncPlayerControls();
}
function renderPractice(){
  if(!state.analysis||!state.analysis.phrases.length){$('#main').innerHTML=`<div class="practice-page"><div class="empty-state"><span class="empty-icon">${icon('mic',35)}</span><h2>先選一首，從一句開始。</h2><p>打開歌曲後，點選你想練習的那一句。錄音、音高與 AI 建議，就會圍繞這一句展開。</p><button class="primary" data-action="home">選擇歌曲 ${icon('arrow',16)}</button><button class="secondary" data-action="demo" style="margin-left:8px">體驗原創示範</button></div></div>`;return;}
  const p=phrase(),target=p.tokens.flatMap(t=>t.notes).map(n=>n+state.transpose);
  $('#main').innerHTML=`<section class="practice-page"><div class="practice-top"><div><div class="eyebrow">YOUR VOICE, NOT A SCORE</div><h1>先唱一句。<br>我們一起聽。</h1><p>不用追求一次完美。聽見一個可以改善的地方，就夠了。</p></div><select id="practice-phrase" aria-label="選擇練習樂句" ${state.recording||state.micPending||state.coaching?'disabled':''}>${state.analysis.phrases.map((line,i)=>`<option value="${i}" ${i===state.selectedPhrase?'selected':''}>${clock(line.start)} · ${esc(lyrics(line))}</option>`).join('')}</select></div><div class="practice-grid"><div><section class="panel record-panel"><div class="spread"><span class="pill">${languageLabel(state.analysis.language)} · ${esc(p.section)}</span><button class="mini-btn" data-action="hear-phrase">${icon('music',12)} 聽提示音</button></div><div class="reference-line">${esc(lyrics(p))}</div><div class="reference-notes">${target.length?`${noteName(Math.min(...target))} — ${noteName(Math.max(...target))} · ${state.transpose?`提示音移調 ${state.transpose>0?'+':''}${state.transpose}`:'提示音原調'}`:'目標音高待確認'} · ${state.analysis.provenance?.kind==='demo-score'?'原創譜面':'AI 估計'}</div><div class="mic-ring ${state.recording?'recording':''}" id="mic-ring"><button class="mic-button" id="record-button" data-action="record" aria-label="${state.recording?'停止錄音':'開始錄音'}" ${state.micPending?'disabled':''}>${icon(state.recording?'stop':'mic',38)}</button></div><div class="live-note" id="live-note">${state.micPending?'⋯':'—'}</div><div class="live-info" id="live-info">${state.recording?'正在聆聽你的聲音':'音高只在偵測到穩定單音時顯示'}</div><div class="record-instruction" id="record-instruction">${state.micPending?'正在開啟麥克風…':state.recording?'再按一下停止 · 最多 30 秒':'輕按開始，再按停止 · 最多 30 秒'}</div><svg class="live-plot" viewBox="0 0 600 72" aria-label="這次錄音的即時音高軌跡"><path d="M0 18H600M0 36H600M0 54H600" stroke="#315a5b16"/><path id="take-curve" fill="none" stroke="#1b9d83" stroke-width="1.7" stroke-linejoin="round"/></svg><div class="privacy-note">${icon('shield',12)} 錄音先留在此頁。按「請 AI 聽聽」後才送往 Google。</div></section>${state.take?takePanel():''}${state.feedback?feedbackPanel():''}</div><aside class="coach-panel practice-aside"><div class="coach-name"><div><strong>澄 · 陪你再試一次</strong><small>GENTLE PRACTICE. REAL PROGRESS.</small></div><span class="pill mint">${state.recording?'聆聽中':'準備好了'}</span></div><div class="coach-avatar-wrap"><div class="avatar-canvas coach-avatar" id="avatar"></div><div class="coach-mode">用舒服的聲量，慢慢唱</div></div><div class="coach-detail"><div class="eyebrow">TODAY, ONE SMALL THING.</div><h2>${esc(p.focus)}</h2><div class="micro-steps"><div class="micro-step"><span class="step-number">1</span><span>先聽一次提示音。這是樂器音，不是 AI 模仿原唱。</span></div><div class="micro-step"><span class="step-number">2</span><span>${esc(p.exercise)}</span></div><div class="micro-step"><span class="step-number">3</span><span>錄下這一句。回聽後，選擇是否讓 AI 教練提供一個練習重點。</span></div></div><button class="secondary coach-practice" data-action="back-score">${icon('arrow',14)} 回到互動歌詞</button></div><div class="coach-foot">建議使用耳機、安靜環境與舒服音域。本機工具量測單音音高，不判定真／假聲、健康或完整個人音域。</div></aside></div></section>`;
}
function takePanel(){const t=state.take,s=t.summary;return `<section class="panel take-panel"><div class="spread"><h2>剛剛這一句</h2><span class="pill">${clock(t.duration,true)} · 本機錄音</span></div><div class="take-stats"><div><small>此段保留音高 · 估計</small><strong>${noteName(s.low)} — ${noteName(s.high)}</strong></div><div><small>有效單音幀</small><strong>${s.voicedFrames}</strong></div><div><small>保留的持續音</small><strong>${s.events.length}</strong></div></div><audio controls src="${recordUrl}" aria-label="回聽剛才錄音"></audio><p class="quality-note">${s.events.length?'已過濾短促雜訊；仍可能出現八度與背景音誤判。這不是你的完整音域。':'未取得足夠持續單音。請靠近麥克風、減少背景音，再試一次。'}</p><label class="consent"><input type="checkbox" id="coach-consent" ${state.coachRights?'checked':''}><span>我同意把這次錄音與參考樂句送往 Google，取得 AI 回饋。</span></label><div class="take-actions"><button class="primary" data-action="coach-take" ${state.coaching?'disabled':''}>${state.coaching?'<span class="spinner"></span>':icon('spark',14)} ${state.coaching?'AI 正在聆聽…':'請 AI 聽聽'}</button><button class="secondary" data-action="download-take">${icon('download',14)} 儲存錄音</button><button class="text-btn" data-action="${state.coaching?'cancel':'clear-take'}">${state.coaching?'取消回饋':'刪除此段'}</button></div></section>`;}
function feedbackPanel(){const f=state.feedback;return `<section class="feedback-card"><h3>${icon('spark',14)} AI 教練的這一句建議</h3><p>${esc(f.heard)}</p><div class="feedback-label">這次只專心一件事</div><p><strong>${esc(f.focus)}</strong></p><div class="feedback-label">再試一次</div><p>${esc(f.tryThis)}</p>${f.pronunciation?`<div class="feedback-label">咬字</div><p>${esc(f.pronunciation)}</p>`:''}<div class="line"></div><p style="font-size:10px;color:#7e9b9e">${esc(f.limitations)} ${esc(f.caution)}</p></section>`;}
function renderLibrary(){
  $('#main').innerHTML=`<section class="library"><div class="library-head"><div><div class="eyebrow">KEEP THE SONGS THAT MOVE YOU</div><h1>收藏你的練習路線。</h1><p>樂譜保存在這個瀏覽器，不會自動上傳雲端。</p></div><button class="secondary" data-action="import">${icon('upload',15)} 匯入 JSON</button></div>${state.library.length?`<div class="library-grid">${state.library.map((item,i)=>`<article class="panel library-card"><img src="/cover.svg" alt="聲嶼原創抽象封面"><h3>${esc(item.analysis?.title||'未命名樂譜')}</h3><p>${languageLabel(item.analysis?.language)} · ${item.analysis?.phrases?.length||0} 個樂句 · ${esc(item.savedAt?.slice(0,10)||'')}</p><div class="spread"><button class="primary" data-open-saved="${i}">繼續練習 ${icon('arrow',13)}</button><button class="icon-btn" data-delete-saved="${i}" aria-label="刪除 ${esc(item.analysis?.title||'樂譜')}">${icon('trash',14)}</button></div></article>`).join('')}</div>`:`<div class="empty-state"><span class="empty-icon">${icon('island',35)}</span><h2>為喜歡的歌，留一個位置。</h2><p>分析完一首歌後，按下「收藏」，下次就可以接著練。不儲存音訊，也不需要登入。</p><button class="primary" data-action="home">開始第一首 ${icon('arrow',16)}</button></div>`}<p class="library-note">最多保留 8 份樂譜。清除瀏覽器資料會移除收藏；重要樂譜請先匯出 JSON。音訊檔不會存入收藏。</p></section>`;
}
const PHASES=['preparing','accepted','analyzing','normalizing','validated'];
const COMPLETED={preparing:0,accepted:1,analyzing:1,normalizing:2,validated:3,complete:4};
function renderLoading(){
  $('#main').innerHTML=`<section class="loading-page"><div><div class="eyebrow">EVERY SONG HAS A PATH</div><h1>正在聽這首歌。<br>每一步，都看得見。</h1><p>先聽完整首歌，建立第一份歌詞時間軸。<br>歌詞一到就能播放，不必等待每段精修。</p><div class="analysis-progress"><div class="progress-heading"><strong id="loading-message" role="status" aria-live="polite">正在準備來源…</strong><span id="loading-count">0 / 4 步</span></div><div id="analysis-progress" class="progress-track is-working" role="progressbar" aria-label="分析流程已完成步驟" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0" aria-valuetext="正在準備來源"><div id="analysis-progress-fill" class="progress-fill"></div><span class="progress-shimmer"></span></div><div class="progress-caption"><span>依實際流程更新，非音訊處理百分比</span><span id="loading-elapsed">已經過 0:00</span></div></div><ol class="loading-steps"><li class="loading-step" data-phase="preparing"><span class="step-dot">1</span><span>準備來源</span></li><li class="loading-step" data-phase="analyzing"><span class="step-dot">2</span><span>聆聽全曲・建立歌詞</span></li><li class="loading-step" data-phase="normalizing"><span class="step-dot">3</span><span>整理初步時間軸</span></li><li class="loading-step" data-phase="validated"><span class="step-dot">4</span><span>展開樂譜與連接原片</span></li></ol><p id="loading-patience" class="loading-patience">正在等待首輪結果；完成時間視歌曲及服務回應而定。精修會在進入練歌室後繼續。</p><button class="secondary" data-action="cancel">取消分析</button></div><div class="loading-art"><div id="avatar" class="avatar-canvas loading-avatar"></div><div class="loading-wave" aria-hidden="true">${Array.from({length:24},(_,i)=>`<i style="--i:${i}"></i>`).join('')}</div></div></section>`;
  phaseUpdate({phase:state.phase,message:state.phase==='preparing'?'正在準備來源…':'正在處理…'});
}
function phaseUpdate(packet){
  if(packet.type==='heartbeat')return;
  state.phase=packet.phase;let completed=COMPLETED[packet.phase]??1;
  const d=packet.detail;
  if(d?.stage==='listening'&&d.totalWindows>0)completed=1+0.65*d.completedWindows/d.totalWindows;
  if(d?.stage==='teaching'&&d.totalBatches>0)completed=1.65+0.35*d.completedBatches/d.totalBatches;
  const bar=$('#analysis-progress');if(bar){bar.setAttribute('aria-valuenow',String(completed));bar.setAttribute('aria-valuetext',packet.message);}
  if($('#analysis-progress-fill'))$('#analysis-progress-fill').style.width=(completed/4*100)+'%';
  if($('#loading-count'))$('#loading-count').textContent=d?.stage==='listening'?`${d.completedWindows} / ${d.totalWindows} 段`:(Math.floor(completed)+' / 4 步');
  if($('#loading-message'))$('#loading-message').textContent=packet.message;
  const active={preparing:0,accepted:1,analyzing:1,normalizing:2,validated:3,complete:4}[packet.phase]??1;
  $$('.loading-step').forEach((el,i)=>{el.classList.toggle('current',i===active);el.classList.toggle('done',i<active);});
}
function qualityNotice(a){
  const q=a.dataQuality,untimed=a.unalignedLyrics||[];
  if(!q&&!untimed.length)return '';
  const partial=q?.mode==='partial';
  return `<details class="quality-notice ${partial?'needs-review':''}" ${!a.phrases.length?'open':''}><summary>${icon('info',15)}<span>${partial?'部分細節待確認；完整辨識文字仍會顯示在歌詞區。':'歌詞已整理；音高與時間仍為 AI 估計。'}</span><span>${q?.timedTokens??a.phrases.reduce((n,p)=>n+p.tokens.length,0)} 字有時間估計${q?.untimedTokens?' · '+q.untimedTokens+' 字待對齊':''}</span></summary><div>${(a.warnings||[]).map(w=>`<p>${esc(w)}</p>`).join('')}${untimed.length?`<p>待對齊文字已保留在完整歌詞底部，但不會參與同步亮字。</p>`:''}</div></details>`;
}
async function refreshStatus(signal){try{state.backend=await api.status(signal);updateHeader();}catch{} }
async function openDemo(){
  abortController?.abort();lessonAbort?.abort();clearTimeout(lessonTimer);analysisRun++;analysisInput=null;lessons.clear();editedPhrases.clear();state.lessonPending=-1;state.refining=false;
  const raw=await fetch('/demo.json').then(r=>r.json());await activate(raw,{kind:'demo',audioUrl:'/audio/demo.wav'});state.selectedPhrase=0;state.selectedToken=2;updateSelection(0,2,false);
}
async function activate(raw,source,measured=null){
  const id=++activation;player.release();stopNotes();await recorder?.dispose();state.recording=false;state.micPending=false;
  const normalized=normalizeAnalysis(raw);state.analysis={...normalized,provenance:raw.provenance||{kind:'ai-estimate'},usage:raw.usage};
  state.source=source;state.measured=measured;state.selectedPhrase=0;state.selectedToken=0;state.time=0;state.offset=0;state.transpose=0;state.filter='all';state.rate=1;player.rate=1;state.take=null;state.feedback=null;state.coachRights=false;state.playerIssue='';state.page='studio';state.error='';
  if(recordUrl){URL.revokeObjectURL(recordUrl);recordUrl=null;}
  render();renderDock();
  // Analysis completion must not hang behind an 18-second player handshake.
  player.load(source,$('#youtube-mount')).then(()=>{if(id===activation)syncPlayerControls();}).catch(e=>{if(id===activation){state.playerIssue=e.message;syncPlayerControls();}});
  window.scrollTo({top:0,behavior:'auto'});
}
async function revealPlayer(){
  if(state.source?.kind!=='youtube')return;
  if(state.page!=='studio'){await navigate('studio');}
  dockYouTubeMount();
  $('#youtube-sidecar')?.scrollIntoView({block:'nearest',behavior:reduced.matches?'auto':'smooth'});
}
async function retryPlayer(){
  if(!state.source)return;
  await revealPlayer();state.playerIssue='';await player.load(state.source,$('#youtube-mount'));syncPlayerControls();
}
async function attachSourceAudio(file){
  if(!file||!state.analysis)return;
  if(file.size>50*1024*1024)throw new Error('本機音訊上限為 50 MB。');
  if(!file.type.startsWith('audio/')&&!/\.(mp3|wav|m4a|ogg|flac|aac|opus)$/i.test(file.name))throw new Error('請選擇可播放的音訊檔。');
  player.release();if(uploadUrl)URL.revokeObjectURL(uploadUrl);uploadUrl=URL.createObjectURL(file);
  state.source={kind:'upload',audioUrl:uploadUrl,fileName:file.name};state.playerIssue='';state.time=0;
  render();renderDock();await player.load(state.source,$('#youtube-mount'));syncPlayerControls();
  toast('已連結本機音訊，沒有重新分析或上傳。請核對版本與歌詞時間。');
}
async function startAnalysis(){
  if(state.loading)return;
  if(state.mode==='youtube'&&!parseYouTube(state.url)){toast('請貼上有效的 YouTube 歌曲連結。',true);return;}
  if(state.mode==='upload'&&!state.file){toast('請先選擇音訊檔。',true);return;}
  abortController?.abort();lessonAbort?.abort();clearTimeout(lessonTimer);
  const run=++analysisRun;lessons.clear();editedPhrases.clear();analysisInput=null;
  state.lessonPending=-1;state.lessonError=-1;state.refining=false;
  player.pause();state.loading=true;state.error='';state.page='loading';state.phase='preparing';
  const controller=new AbortController();abortController=controller;const signal=controller.signal;
  render();const started=performance.now();
  loadingTimer=setInterval(()=>{if($('#loading-elapsed'))$('#loading-elapsed').textContent='已經過 '+clock((performance.now()-started)/1000);},1000);
  let temporaryUrl,opened=false;
  try{
    await refreshStatus(signal);
    if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    if(!state.backend.configured)throw new Error('分析服務目前未就緒，請聯絡工作室管理員。');
    if(state.backend.requiresAccessCode&&!state.backend.authenticated){state.page='home';state.loading=false;render();showLogin();return;}
    const request={source:state.mode,language:state.language};let source,measured=null;
    if(state.mode==='youtube'){const yt=parseYouTube(state.url);request.url=yt.url;source={kind:'youtube',...yt};}
    else{
      const decoded=await decodeFile(state.file);if(signal.aborted)throw new DOMException('Cancelled','AbortError');
      if(state.solo){phaseUpdate({phase:'preparing',message:'本機正在量測清唱音高…'});measured=(await scanPitch(decoded.samples,()=>{},signal)).summary;}
      if(state.backend.maxRequestBytes && decoded.blob.size*4/3+10000>state.backend.maxRequestBytes)throw new Error('音訊超過這個網站的上傳大小上限，請改用 YouTube 連結或較短音訊。');
      request.audioData=await toBase64(decoded.blob);request.fileName=state.file.name;request.measured=measured;
      temporaryUrl=URL.createObjectURL(state.file);source={kind:'upload',audioUrl:temporaryUrl,fileName:state.file.name};
    }
    analysisInput=request;
    const receive=async packet=>{
      if(run!==analysisRun||signal.aborted)return;
      if(!opened){
        if(uploadUrl)URL.revokeObjectURL(uploadUrl);uploadUrl=temporaryUrl||null;temporaryUrl=null;
        clearInterval(loadingTimer);state.loading=false;state.refining=packet.result.adaptive?.state==='refining';
        await activate(packet.result,source,measured);opened=true;state.phase='playable';
        toast('歌詞已準備，可以先播放。唱法與細節會逐步補上。');
      }else applyProgressive(packet.result);
    };
    const result=await api.analyze('/api/analyze',request,p=>{if(run===analysisRun&&!opened)phaseUpdate(p);},signal,receive);
    if(run!==analysisRun||signal.aborted)return;
    if(!opened)await receive({result});else applyProgressive(result);
    state.phase='complete';state.refining=false;refreshRefinementStatus();
  }catch(e){
    if(run!==analysisRun)return;
    if(opened){
      state.refining=false;state.analysis.adaptive={...state.analysis.adaptive,state:signal.aborted?'cancelled':'partial'};refreshScoreFragments();
    }else{
      if(temporaryUrl)URL.revokeObjectURL(temporaryUrl);
      state.page='home';state.error=signal.aborted?'':e.message+(e.requestId?'（參考編號：'+e.requestId+'）':'');render();
      if(!signal.aborted)toast(e.message,true);
    }
  }finally{if(run===analysisRun){state.loading=false;clearInterval(loadingTimer);if(abortController===controller)abortController=null;}}
}

function refinementStatus(){
  const m=state.analysis?.adaptive;if(!m)return '';
  const running=m.state==='refining',percent=m.totalTasks?Math.floor(100*m.completedTasks/m.totalTasks):0;
  const title=running?'歌詞已準備 · 正在精修':m.state==='complete'?'精修已結束 · 可以繼續練習':m.state==='cancelled'?'精修已暫停 · 目前樂譜已保留':'部分精修未完成 · 目前樂譜已保留';
  return `<section class="refinement-banner ${running?'is-refining':''}" aria-label="樂譜精修狀態"><div class="refinement-copy"><strong role="status">${title}</strong><span>${running?`已處理 ${m.completedTasks} / ${m.totalTasks} 項 · 可一邊播放`:'歌詞與時間仍為 AI 估計，不是已驗證準確度。'}</span></div>${running?`<div class="refinement-meter" role="progressbar" aria-label="已處理的精修項目" aria-valuemin="0" aria-valuemax="${m.totalTasks}" aria-valuenow="${m.completedTasks}"><i style="width:${percent}%"></i></div><button class="text-btn" data-action="stop-refining">停止精修</button>`:''}</section>`;
}
function refreshRefinementStatus(){if($('#refinement-status'))$('#refinement-status').innerHTML=refinementStatus();}
function applyProgressive(raw){
  if(!state.analysis)return;
  if((raw.adaptive?.revision??0)<(state.analysis.adaptive?.revision??0))return;
  const normalized=normalizeAnalysis(raw),old=state.analysis;
  for(const pi of editedPhrases)if(old.phrases[pi])normalized.phrases[pi]=structuredClone(old.phrases[pi]);
  normalized.phrases.forEach((p,pi)=>{const cached=lessons.get(lessonKey(p,pi));if(cached)Object.assign(p,cached);});
  state.analysis={...normalized,provenance:editedPhrases.size?{...(raw.provenance||old.provenance),kind:'user-edited'}:raw.provenance||old.provenance,usage:raw.usage};
  state.refining=raw.adaptive?.state==='refining';
  if(state.page!=='studio')return;
  refreshScoreFragments();
}
function refreshScoreFragments(){
  const scroll=$('#lyrics-scroll');if(!scroll)return;
  const anchor=$$('.phrase-row').find(n=>n.getBoundingClientRect().top>=($('.studio-chrome')?.getBoundingClientRect().height||0));
  const anchorId=anchor?.id,top=anchor?.getBoundingClientRect().top;
  const active=document.activeElement?.dataset.token;
  scroll.innerHTML=renderLyrics();rebuildLyricNodes();
  if(active)$(`[data-token="${active}"]`)?.focus({preventScroll:true});
  const after=anchorId?document.getElementById(anchorId):null;
  if(after&&Number.isFinite(top))window.scrollBy({top:after.getBoundingClientRect().top-top,behavior:'instant'});
  const a=state.analysis,c=teachingCoverage(a);
  if($('.song-meta button'))$('.song-meta button').textContent=labelKind();
  if($('.tech-coverage'))$('.tech-coverage').textContent=`${c.identified} / ${c.total} 字有唱法${state.refining?' · 逐步補上':c.unknown?' · '+c.unknown+' 字待確認':''}`;
  if($('#pitch-map'))$('#pitch-map').innerHTML=pitchMap();
  const r=a.range?.low!=null?a.range:a.firstScanRange;
  const stats=$$('.range-stat strong');
  if(stats[0])stats[0].textContent=noteName(r?.low);if(stats[1])stats[1].textContent=noteName(r?.high);
  if(stats[2])stats[2].textContent=noteName(r?.typicalLow)+' — '+noteName(r?.typicalHigh);
  if(stats[3])stats[3].innerHTML=a.phrases.flatMap(p=>p.tokens).filter(t=>t.ornaments.includes('run')).length+'<sup>處</sup>';
  if($('#quality-slot'))$('#quality-slot').innerHTML=qualityNotice(a);
  if($('#coach-detail'))$('#coach-detail').innerHTML=coachDetail();
  if(player.loop){const p=a.phrases[player.loop.phraseIndex];if(p)player.loop={...player.loop,start:p.start+state.offset,end:p.end+state.offset};}
  refreshRefinementStatus();syncLyricProgress(state.time);syncPlayerControls();
}
function lessonKey(p,pi){return pi+':'+p.tokens.map(t=>t.text).join('');}
function lessonStatus(){
  if(!analysisInput)return '';
  if(state.lessonPending===state.selectedPhrase)return '<p class="lesson-status" role="status">正在為這一句整理教學…歌曲可繼續播放。</p>';
  if(state.lessonError===state.selectedPhrase)return '<p class="lesson-status">這句教學暫未取得，原有樂譜不受影響。<button class="text-btn" data-action="retry-lesson">重試這句</button></p>';
  if(!lessons.has(lessonKey(phrase(),state.selectedPhrase)))return '<p class="lesson-status">點選這句的字，再聆聽並整理詳細教學。</p>';
  return '<p class="lesson-status">這句教學已準備</p>';
}
function requestLesson(pi){
  if(!analysisInput||!state.analysis?.phrases[pi])return;
  const key=lessonKey(state.analysis.phrases[pi],pi);
  if(lessons.has(key)||state.lessonPending===pi)return;
  clearTimeout(lessonTimer);lessonAbort?.abort();state.lessonPending=pi;state.lessonError=-1;
  if($('#coach-detail'))$('#coach-detail').innerHTML=coachDetail();
  const run=analysisRun,recording=analysisInput;
  lessonTimer=setTimeout(async()=>{
    const controller=new AbortController();lessonAbort=controller;
    try{
      const p=structuredClone(state.analysis.phrases[pi]);
      const result=await api.analyze('/api/lesson',{...recording,duration:state.analysis.duration,phrase:p},()=>{},controller.signal);
      if(controller.signal.aborted||run!==analysisRun||key!==lessonKey(state.analysis.phrases[pi],pi))return;
      const values=Object.fromEntries(['focus','instruction','pronunciation','exercise','caution'].map(k=>[k,typeof result[k]==='string'?result[k]:'']));
      lessons.set(key,values);Object.assign(state.analysis.phrases[pi],values);
    }catch(e){if(!controller.signal.aborted&&run===analysisRun)state.lessonError=pi;}
    finally{if(run===analysisRun&&lessonAbort===controller){state.lessonPending=-1;lessonAbort=null;if($('#coach-detail'))$('#coach-detail').innerHTML=coachDetail();}}
  },300);
}

function onPlayerState(playing,snapshot){
  if(snapshot?.status==='error')state.playerIssue=snapshot.message;
  else if(snapshot?.ready)state.playerIssue='';
  if(Number.isFinite(snapshot?.rate))state.rate=snapshot.rate;
  syncPlayerControls();avatar?.setState({playing});
}
function syncPlayerControls(){
  if(!state.analysis)return;
  const s=player.snapshot(),isYouTube=state.source?.kind==='youtube';
  const needsNative=isYouTube&&['native','error'].includes(s.status);
  const action=needsNative?'retry-player':s.status==='missing'?'attach-audio':'play';
  const label=needsNative?'重新連線':s.status==='missing'?'連結本機音訊':s.status==='loading'?'播放器連線中':s.playing?'暫停':'播放';
  const iconName=needsNative?'loop':s.status==='missing'?'upload':s.playing?'pause':'play';
  const btn=$('#play-toggle');
  if(btn){
    btn.dataset.action=action;btn.disabled=!s.ready&&!needsNative&&s.status!=='missing';
    btn.setAttribute('aria-label',label);btn.setAttribute('aria-pressed',String(s.playing));btn.title=label;
    btn.innerHTML=['loading','buffering'].includes(s.status)?'<span class="spinner"></span>':icon(iconName,19);
  }
  if($('#seek')){$('#seek').disabled=!s.ready;$('#seek').max=String(s.duration||state.analysis.duration);}
  if($('#rate-select')){
    const select=$('#rate-select');select.disabled=!s.ready;
    const rate=Number.isFinite(s.rate)?s.rate:state.rate;
    if(![...select.options].some(o=>Number(o.value)===rate))select.add(new Option(rate+'×',String(rate)));
    select.value=String(rate);
  }
  if($('#total-duration'))$('#total-duration').textContent=clock(s.duration||state.analysis.duration);

  const messages={idle:'準備播放器…',loading:'原片連線中…',ready:'可以播放',playing:'播放中 · 歌詞同步',paused:'已暫停',buffering:'正在緩衝…',ended:'播放完畢',native:'原片可播放；同步正在等待重新連線',error:'原片連線中斷',missing:'請連結原本的音訊檔','needs-gesture':'請在影片內按一次播放'};
  if($('#playback-status'))$('#playback-status').textContent=s.message||messages[s.status]||'';
  if($('#media-message'))$('#media-message').textContent=s.message||messages[s.status]||'';
  if($('#youtube-sidecar'))$('#youtube-sidecar').dataset.playback=s.status;
}

function syncLyricProgress(mediaTime=state.time){
  if(!state.analysis||!lyricNodes.length)return;
  if(mediaTime===lastSyncedTime&&state.offset===lastSyncedOffset)return;
  lastSyncedTime=mediaTime;lastSyncedOffset=state.offset;
  let activePi=-1,activeTi=-1;
  for(const item of lyricRows){
    const next=lyricState(item.p.start,item.p.end,mediaTime,state.offset);
    if(item.last!==next){
      if(item.last)item.element.classList.remove(item.last==='current'?'active':item.last);
      item.element.classList.add(next==='current'?'active':next);item.last=next;
    }
    if(next==='current')activePi=item.pi;
  }
  for(const item of lyricNodes){
    const next=tokenLyricState(item.t,item.p,mediaTime,state.offset);
    if(item.last!==next){
      if(item.last)item.element.classList.remove(item.last);
      item.element.classList.add(next);item.last=next;
      if(next==='current')item.element.setAttribute('aria-current','true');else item.element.removeAttribute('aria-current');
    }
    if(next==='current'&&item.pi===activePi)activeTi=item.ti;
  }
  if(activePi>=0&&activeTi<0)activeTi=0;
  if(activePi>=0&&activeTi>=0&&state.page==='studio'&&(activePi!==state.selectedPhrase||activeTi!==state.selectedToken)){
    const changedLine=activePi!==state.selectedPhrase;
    updateSelection(activePi,activeTi,player.playing&&changedLine,true);
  }
}

function onTick(time){
  if(!state.analysis)return;state.time=time;
  if($('#elapsed'))$('#elapsed').textContent=clock(time);

  if($('#seek')&&document.activeElement!==$('#seek'))$('#seek').value=String(time);
  const line=$('#map-playhead'),x=43+clamp(time/state.analysis.duration,0,1)*637;if(line){line.setAttribute('x1',x);line.setAttribute('x2',x);}
  syncLyricProgress(time);
}

function updateSelection(pi,ti,scroll=false,fromPlayback=false){
  state.selectedPhrase=pi;state.selectedToken=ti;
  $$('.phrase-row.selected,.token.selected').forEach(el=>el.classList.remove('selected'));$(`#phrase-${pi}`)?.classList.add('selected');$(`[data-token="${pi}:${ti}"]`)?.classList.add('selected');
  if($('#coach-detail'))$('#coach-detail').innerHTML=coachDetail();if($('#coach-mode'))$('#coach-mode').textContent=TECHNIQUES[token()?.technique||'unknown'].label+' · 練習選項';
  avatar?.setState({technique:token()?.technique||'unknown'});
  if(scroll&&$('#lyrics-scroll')){const list=$('#lyrics-scroll'),row=$(`#phrase-${pi}`);if(row){const style=getComputedStyle(list),scrollable=/(auto|scroll)/.test(style.overflowY)&&list.scrollHeight>list.clientHeight+8;if(scrollable){const delta=row.getBoundingClientRect().top-list.getBoundingClientRect().top;if(delta<0||delta>list.clientHeight-120)list.scrollTo({top:list.scrollTop+delta-45,behavior:reduced.matches?'auto':'smooth'});}else {const rect=row.getBoundingClientRect(),chrome=$('.studio-chrome')?.getBoundingClientRect().height||0;const legend=$('.legend')?.getBoundingClientRect().height||0;if(rect.top<chrome+legend+12||rect.bottom>innerHeight-32)row.scrollIntoView({block:'center',behavior:reduced.matches?'auto':'smooth'});}}}
  if(player.loop&&!fromPlayback){player.loop={start:phrase().start+state.offset,end:phrase().end+state.offset,phraseIndex:pi};}
}
async function navigate(page){
  if(state.loading){toast('請先取消或完成目前分析。');return;}
  if(state.recording||state.micPending){toast('請先停止錄音。');return;}
  if(state.coaching){toast('AI 正在回饋這段錄音，請先取消或等結果回來。');return;}
  if(page!=='studio'){abortController?.abort();lessonAbort?.abort();clearTimeout(lessonTimer);analysisRun++;state.lessonPending=-1;state.refining=false;if(state.analysis?.adaptive?.state==='refining')state.analysis.adaptive.state='cancelled';}
  player.pause();stopNotes();if('speechSynthesis'in window)speechSynthesis.cancel();state.page=page;render();window.scrollTo({top:0,behavior:'auto'});
}
async function toggleRecording(){
  if(state.recording){await recorder.stop();return;}
  if(state.micPending)return;
  player.pause();stopNotes();if('speechSynthesis'in window)speechSynthesis.cancel();$$('audio').forEach(el=>el.pause());state.micPending=true;render();
  recorder??=new Recorder(updateRecording,finishRecording);
  try{await recorder.start();if(recorder.active){state.recording=true;state.micPending=false;render();avatar?.setState({playing:true});}}
  catch(e){state.micPending=false;state.recording=false;render();toast(e.message,true);}finally{state.micPending=false;}
}
function updateRecording({elapsed,result}){
  const note=$('#live-note'),info=$('#live-info'),hint=$('#record-instruction');if(note)note.textContent=result?noteName(result.midi):'—';
  if(info)info.textContent=result?`${Math.round(result.hz)} Hz · 距最近半音 ${result.cents>0?'+':''}${result.cents} cents`:'等待清楚的單音…';
  if(hint)hint.textContent=`${clock(elapsed)} / 0:30 · 再按一下停止`;
  const level=clamp((result?.rms||0)*3,0,.5);$('#mic-ring')?.style.setProperty('--level',String(level));avatar?.setState({level,playing:true});
  const points=recorder.frames.filter(Boolean).filter((_,i)=>i%2===0);const min=45,max=89;
  if($('#take-curve'))$('#take-curve').setAttribute('d',points.map((p,i)=>`${i?'L':'M'}${(p.time/30*600).toFixed(1)},${clamp(68-(p.midi-min)/(max-min)*64,4,68).toFixed(1)}`).join(' '));
}
function finishRecording(take,error){
  if(!take){state.recording=false;state.micPending=false;render();toast(error||'錄音未完成，請重試。',true);return;}
  state.recording=false;state.micPending=false;state.take=take;state.feedback=null;state.coachRights=false;
  if(recordUrl)URL.revokeObjectURL(recordUrl);recordUrl=URL.createObjectURL(take.blob);render();toast('這一句錄好了。先回聽，再決定是否請 AI 聽聽。');
}
async function coachTake(){
  if(!state.take||state.coaching)return;
  if(!state.coachRights){toast('請先同意把這段錄音送往 Google。',true);$('#coach-consent')?.focus();return;}
  if(!state.backend.configured){toast('分析服務暫時未就緒，請稍後再試。',true);return;}if(state.backend.requiresAccessCode&&!state.backend.authenticated){showLogin();return;}
  if(state.take.duration<.3){toast('錄音太短，請至少錄下完整一句。',true);return;}
  player.pause();state.coaching=true;render();abortController=new AbortController();
  try{state.feedback=await api.analyze('/api/coach',{audioData:await toBase64(state.take.blob),recordingConsent:true,language:state.analysis.language==='cantonese'?'cantonese':'mandarin',phrase:phrase(),transpose:state.transpose,measured:state.take.summary},()=>{},abortController.signal);toast('回饋已就緒。這次只專心一個重點。');}
  catch(e){toast(e.name==='AbortError'?'回饋已取消。':e.message,true);}finally{state.coaching=false;abortController=null;render();}
}
function showLimits(){
  const warnings=state.analysis?.warnings||[];
  modal('讓每個結果，都有清楚的界線',`<h3>歌詞、時間與音高</h3><p>YouTube 連結會透過雲端 AI 服務直接分析，並以官方播放器播放，不下載或拆出音軌。影片必須公開且可供服務存取；嵌入播放可能另受限制。YouTube 單首最長 15 分鐘；本機音訊上傳最長 6 分鐘。超過範圍會提示，不截掉後半首。</p><p>AI 先聆聽全曲，自動產生初步歌詞與時間；歌詞到達便展開練歌室。只有低把握或結構可疑的樂句在背景精修，詳細教學點句才產生。可信度是主觀安排複核的訊號，不是準確率；高分也可能出錯。時間仍是估計，不等同人工核對或精密旋律轉錄。不確定的逐字時間只跟隨樂句。顯示的真聲、混聲、頭聲、假聲，是練習選項，不是可確定的原唱生理機制。</p><h3>「轉音」不等於「轉聲」</h3><p>轉音：一個字唱多個音；轉聲：聲音銜接策略。滑音、顫音與換氣另行標記。唱法流派可能使用不同術語，本工具不以某個固定音符要求所有人換聲。</p><h3>本機音高量測</h3><p>錄音及勾選清唱的上傳音訊使用 YIN 類單音偵測；它不做人聲分離，可能把背景音或八度判錯。保留持續至少 120 毫秒的可信音高段；顯示的是這段音訊，不是完整個人音域。</p><h3>提示音與咬字</h3><p>字內多音的分音時間僅為均分示意。移調只作用於提示音，不改 YouTube／上傳原音。粵拼與漢語拼音供辨字參考，可能需要校正，不能把說話聲調直接當作歌唱旋律。</p><h3>資料與安全</h3><p>來源送往 AI 服務後，適用該 API 專案的資料處理條款。此伺服器不把錄音或歌詞寫入資料庫或應用程式日誌。</p><p>若出現疼痛、持續沙啞或不舒服，先停止練習並尋求合適的專業協助。角色的胸／頭發光是視覺比喻，不是器官或氣流模擬。</p>${warnings.length?`<h3>這次來源的提醒</h3>${warnings.map(w=>`<p class="note">${esc(w)}</p>`).join('')}`:''}<div class="modal-actions"><button class="primary" data-action="close-modal">知道了</button></div>`,true);
}
function showLogin(){modal('進入私人工作室',`<p>這個部署啟用了存取保護。輸入工作室擁有者提供的存取碼，不是 AI 服務金鑰。</p><form id="login-form"><input id="access-code" type="password" autocomplete="current-password" placeholder="工作室存取碼" aria-label="工作室存取碼" style="width:100%" required><div class="modal-actions"><button class="primary" type="submit">進入工作室</button></div></form>`);}
function showEdit(){
  if(!state.analysis)return;player.pause();const p=phrase();
  modal('校正這一句',`<p class="note">修改文字或逐字時間。新增／刪除字元時，會清除未重新分析的音高，並保留為樂句同步，不會平均分配逐字時間。</p><form id="edit-form"><label for="edit-text">歌詞</label><textarea id="edit-text" maxlength="64" style="min-height:65px">${esc(lyrics(p))}</textarea><div class="form-grid"><div><label for="edit-start">樂句開始（秒）</label><input id="edit-start" type="number" min="0" max="900" step="0.001" value="${p.start}" required></div><div><label for="edit-end">樂句結束（秒）</label><input id="edit-end" type="number" min="0" max="900" step="0.001" value="${p.end}" required></div></div><div style="overflow-x:auto;margin-top:16px"><table><thead><tr><th>字</th><th>開始秒</th><th>結束秒</th><th>音符（如 C4,E4）</th><th>建議唱法</th></tr></thead><tbody>${p.tokens.map((t,i)=>`<tr><td>${esc(t.text)}</td><td><input aria-label="${esc(t.text)} 開始時間" data-edit-start="${i}" type="number" min="0" step="0.001" value="${t.start??''}"></td><td><input aria-label="${esc(t.text)} 結束時間" data-edit-end="${i}" type="number" min="0" step="0.001" value="${t.end??''}"></td><td><input aria-label="${esc(t.text)} 音符" data-edit-notes="${i}" value="${t.notes.map(noteName).join(',')}" style="width:110px"></td><td><select aria-label="${esc(t.text)} 建議唱法" data-edit-technique="${i}" style="font-size:10px;padding:6px;width:80px">${Object.entries(TECHNIQUES).map(([k,v])=>`<option value="${k}" ${t.technique===k?'selected':''}>${v.label}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div><p class="note">音符留白＝待確認。修改記錄不代表已通過音樂專家驗證。全曲只差一點時間，可用歌詞下方「偏移」調整。</p><div class="modal-actions"><button type="button" class="secondary" data-action="close-modal">取消</button><button class="primary" type="submit">儲存校正</button></div></form>`,true);
}
function parseNotes(value){
  if(!value.trim())return [];
  return value.split(/[\s,，→]+/).filter(Boolean).map(s=>{
    if(/^\d+(\.\d+)?$/.test(s)){const n=Number(s);if(n<24||n>108)throw new Error('MIDI 音高需介於 24–108。');return n;}
    const m=/^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(s);if(!m)throw new Error('請用 C4、F#4、B♭3 等音名，或留白。');
    const semitone={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1].toUpperCase()],accidental=['#','♯'].includes(m[2])?1:['b','♭'].includes(m[2])?-1:0;
    const n=(Number(m[3])+1)*12+semitone+accidental;if(n<24||n>108)throw new Error('音高超出支援範圍。');return n;
  });
}
function applyEdit(){
  const p=structuredClone(phrase()),text=$('#edit-text').value.replace(/\s+/g,'').trim();if(!text)throw new Error('歌詞不能是空白。');
  const start=Number($('#edit-start').value),end=Number($('#edit-end').value);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>state.analysis.duration)throw new Error('樂句時間需位於歌曲範圍內，結束必須晚於開始。');
  if(text!==lyrics(p)){
    const chars=Array.from(text);
    p.tokens=chars.map(ch=>({text:ch,romanization:'',start:null,end:null,timingMode:'line',timingReview:'user-edited',notes:[],technique:'unknown',ornaments:[],confidence:'low'}));
    p.focus='歌詞已修改，唱法需要重新確認';p.instruction='原來的逐句教學可能不再符合新歌詞。請重新分析來源，或由老師校正。';p.pronunciation='新歌詞的拼音尚未確認。';p.exercise='先用舒服的聲量朗讀新歌詞，不要照未確認的音高勉強練唱。';p.caution='新增歌詞只跟隨樂句時間，逐字時間仍待確認。';
  }else{
    p.tokens=p.tokens.map((t,i)=>({...t,start:$(`[data-edit-start="${i}"]`).value===''?null:Number($(`[data-edit-start="${i}"]`).value),end:$(`[data-edit-end="${i}"]`).value===''?null:Number($(`[data-edit-end="${i}"]`).value),timingMode:$(`[data-edit-start="${i}"]`).value===''?'line':'word',timingReview:'user-edited',notes:parseNotes($(`[data-edit-notes="${i}"]`).value),technique:$(`[data-edit-technique="${i}"]`).value}));
  }
  p.start=start;p.end=end;
  const copy=structuredClone(state.analysis);copy.phrases[state.selectedPhrase]=p;const normalized=normalizeAnalysis(copy);
  const selected=normalized.phrases.findIndex(x=>x.start===p.start&&lyrics(x)===lyrics(p));
  // A reordered phrase changes occurrence IDs. Preserve the user's edit by
  // stopping optional work instead of merging a later snapshot onto wrong IDs.
  if(selected!==state.selectedPhrase){
    abortController?.abort();analysisRun++;state.refining=false;
    if(normalized.adaptive)normalized.adaptive.state='cancelled';
    editedPhrases.clear();lessons.clear();
  }
  lessonAbort?.abort();clearTimeout(lessonTimer);state.lessonPending=-1;state.lessonError=-1;
  state.analysis={...normalized,provenance:{...state.analysis.provenance,kind:'user-edited'}};state.selectedPhrase=Math.max(0,selected);state.selectedToken=0;
  editedPhrases.add(state.selectedPhrase);lessons.delete(lessonKey(p,state.selectedPhrase));closeModal();refreshScoreFragments();toast('校正已更新。新增文字的音高保留為待確認。');
}
function safeSource(source){return source?.kind==='youtube'?{kind:'youtube',...parseYouTube(source.url)}:source?.kind==='demo'?{kind:'demo',audioUrl:'/audio/demo.wav'}:{kind:'upload',fileName:source?.fileName||''};}
function currentExport(){return {format:'vox-isle/1',analysis:state.analysis,source:safeSource(state.source),timingOffset:state.offset,transpose:state.transpose,savedAt:new Date().toISOString()};}
function persistLibrary(){try{localStorage.setItem('vox-isle-library-v1',JSON.stringify(state.library));return true;}catch{toast('瀏覽器儲存空間不足或無法儲存。請改用匯出 JSON。',true);return false;}}
function saveCurrent(){if(!state.analysis)return;const item=currentExport(),key=JSON.stringify(item.source);const existing=state.library.findIndex(x=>JSON.stringify(x.source)===key&&x.analysis?.title===item.analysis.title);if(existing>=0)state.library.splice(existing,1);state.library.unshift(item);state.library=state.library.slice(0,8);if(persistLibrary())toast('已收藏在這個瀏覽器。音訊不會一併儲存。');}
async function openSaved(index){
  const item=state.library[index];if(!item)throw new Error('找不到這份樂譜。');
  const a=normalizeAnalysis(item.analysis);const s=item.source?.kind==='youtube'?{kind:'youtube',...parseYouTube(item.source.url)}:item.source?.kind==='demo'?{kind:'demo',audioUrl:'/audio/demo.wav'}:{kind:'upload',fileName:item.source?.fileName||''};
  if(s.kind==='youtube'&&!s.id)throw new Error('儲存的 YouTube 連結無效。');
  await activate({...a,provenance:item.analysis.provenance||{kind:'imported'}},s);
  state.offset=Number.isFinite(item.timingOffset)?clamp(item.timingOffset,-5,5):0;state.transpose=Number.isInteger(item.transpose)?clamp(item.transpose,-12,12):0;render();renderDock();
}
function exportModal(){if(!state.analysis)return;modal('帶走你的練習譜',`<p>JSON 保留逐字音符、唱法標記、教學與校正時間。LRC 可用於其他同步歌詞播放器；時間仍須自行核對。</p><div class="modal-actions"><button class="secondary" data-action="export-lrc">${icon('download',15)} 歌詞 LRC</button><button class="primary" data-action="export-json">${icon('download',15)} 完整 JSON</button></div><p class="note">匯出檔只包含練習譜資料，不包含來源音訊。</p>`);}
function filename(){return (state.analysis?.title||'聲嶼樂譜').replace(/[\\/:*?"<>|]/g,'_').slice(0,70);}
function downloadLrc(){
  const lines=state.analysis.phrases.map(p=>{const s=Math.max(0,p.start+state.offset);const time=`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`;return `[${time}]${lyrics(p)}`;});
  saveFile(filename()+'.lrc',`[ti:${state.analysis.title.replace(/[\r\n\]]/g,' ')}]\n[by:聲嶼 VOX ISLE — timing requires verification]\n`+lines.join('\n'),'text/plain;charset=utf-8');closeModal();
}
async function importFile(file){
  if(!file)return;if(file.size>2*1024*1024)throw new Error('JSON 樂譜上限為 2 MB。');
  const data=JSON.parse(await file.text());const a=normalizeAnalysis(data.analysis||data);
  const source=data.source?.kind==='youtube'&&parseYouTube(data.source.url)?{kind:'youtube',...parseYouTube(data.source.url)}:{kind:'upload',fileName:''};
  const item={format:'vox-isle/1',analysis:{...a,provenance:{kind:'imported'}},source,timingOffset:Number.isFinite(data.timingOffset)?clamp(data.timingOffset,-5,5):0,transpose:Number.isInteger(data.transpose)?clamp(data.transpose,-12,12):0,savedAt:new Date().toISOString()};
  // Imported content is never represented as a verified model or bundled demo.
  state.library.unshift(item);state.library=state.library.slice(0,8);persistLibrary();await openSaved(0);toast('已匯入樂譜。匯入內容尚未驗證；外部音訊需重新提供。');
}
function toggleLoop(){if(!phrase())return;if(player.loop)player.loop=null;else player.loop={start:phrase().start+state.offset,end:phrase().end+state.offset,phraseIndex:state.selectedPhrase};$('#loop-toggle')?.classList.toggle('active',Boolean(player.loop));$('#loop-toggle')?.setAttribute('aria-pressed',String(Boolean(player.loop)));toast(player.loop?'已開啟這一句循環。':'已關閉循環。');}
function transpose(delta){if(!state.analysis)return;state.transpose=clamp(state.transpose+delta,-12,12);if($('#transpose-value'))$('#transpose-value').textContent=(state.transpose>0?'+':'')+state.transpose;if($('#coach-detail'))$('#coach-detail').innerHTML=coachDetail();if(state.page==='practice'&&!state.recording)render();toast(`提示音 ${state.transpose>0?'+':''}${state.transpose} 半音；原始歌曲音訊不會變調。`);}

// Delegated events keep state changes explicit and avoid reattaching per-word listeners.
document.addEventListener('click',async event=>{
  const el=event.target.closest('button,[data-token],[data-filter]');if(!el)return;
  try{
    if(el.dataset.token){const [pi,ti]=el.dataset.token.split(':').map(Number);updateSelection(pi,ti);requestLesson(pi);return;}
    if(el.dataset.phraseSeek!==undefined){const pi=Number(el.dataset.phraseSeek);updateSelection(pi,0,true);player.seek(phrase().start+state.offset);return;}
    if(el.dataset.filter){state.filter=el.dataset.filter;$$('[data-filter]').forEach(b=>{const selected=b.dataset.filter===state.filter;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});$('#lyrics-scroll').innerHTML=renderLyrics();rebuildLyricNodes();syncLyricProgress(state.time);return;}
    if(el.dataset.openSaved!==undefined){await openSaved(Number(el.dataset.openSaved));return;}
    if(el.dataset.deleteSaved!==undefined){const i=Number(el.dataset.deleteSaved);modal('移除這份收藏？',`<p>${esc(state.library[i]?.analysis?.title||'這份樂譜')} 將從本機收藏移除。來源影片與檔案不受影響。</p><div class="modal-actions"><button class="secondary" data-action="close-modal">保留</button><button class="primary" data-delete-confirm="${i}">移除收藏</button></div>`);return;}
    if(el.dataset.deleteConfirm!==undefined){state.library.splice(Number(el.dataset.deleteConfirm),1);persistLibrary();closeModal();render();return;}
    const action=el.dataset.action;if(!action)return;
    if((state.recording||state.micPending||state.coaching)&&['next','previous','transpose-up','transpose-down','hear-word','hear-phrase','speak','edit'].includes(action)){toast('請先停止錄音或完成目前回饋，再切換練習內容。');return;}
    if(state.coaching&&['record','play'].includes(action)){toast('請先取消或完成目前 AI 回饋。');return;}
    switch(action){
      case 'home':await navigate('home');break;
      case 'studio-nav':await navigate(state.analysis?'studio':'home');break;
      case 'back-score':await navigate('studio');break;
      case 'practice':await navigate('practice');break;
      case 'library':await navigate('library');break;
      case 'demo':await openDemo();break;
      case 'source-youtube':state.mode='youtube';render();break;
      case 'source-upload':state.mode='upload';render();break;
      case 'advanced':state.advanced=!state.advanced;render();break;
      case 'cancel':abortController?.abort();break;
      case 'stop-refining':abortController?.abort();state.refining=false;if(state.analysis?.adaptive)state.analysis.adaptive.state='cancelled';refreshScoreFragments();break;
      case 'retry-lesson':requestLesson(state.selectedPhrase);break;
      case 'limits':showLimits();break;
      case 'close-modal':closeModal();break;
      case 'login':showLogin();break;
      case 'roman':state.showRoman=!state.showRoman;$('#lyrics-scroll').classList.toggle('no-roman',!state.showRoman);el.classList.toggle('active',state.showRoman);el.setAttribute('aria-pressed',String(state.showRoman));break;
      case 'edit':if(phrase())showEdit();else toast('目前沒有可校正的同步樂句，請核對待對齊歌詞後重試分析。');break;
      case 'save':saveCurrent();break;
      case 'export':exportModal();break;
      case 'export-json':saveFile(filename()+'.vox.json',JSON.stringify(currentExport(),null,2));closeModal();break;
      case 'export-lrc':downloadLrc();break;
      case 'import':$('#library-import').click();break;
      case 'offset-minus':case 'offset-plus':state.offset=Math.round(clamp(state.offset+(action==='offset-plus'?.1:-.1),-5,5)*10)/10;if($('#offset-label'))$('#offset-label').textContent=signed(state.offset)+'s';if(player.loop){const p=state.analysis.phrases[player.loop.phraseIndex]||phrase();player.loop={...player.loop,start:p.start+state.offset,end:p.end+state.offset};}syncLyricProgress(state.time);break;
      case 'show-youtube':await revealPlayer();break;
      case 'retry-player':await retryPlayer();break;
      case 'attach-audio':$('#source-audio').click();break;
      case 'play':if(state.recording||state.micPending){toast('請先停止錄音，避免原音混入。');break;}if(!player.ready){if(state.source?.kind==='youtube')await revealPlayer();break;}if(player.duration&&state.time>=player.duration-.05)player.seek(0);await player.toggle();break;
      case 'previous':case 'next':{if(!phrase())break;const index=clamp(state.selectedPhrase+(action==='next'?1:-1),0,state.analysis.phrases.length-1);updateSelection(index,0,true);player.seek(phrase().start+state.offset);if(state.page==='practice')render();break;}
      case 'loop':toggleLoop();break;
      case 'transpose-down':transpose(-1);break;
      case 'transpose-up':transpose(1);break;
      case 'hear-word':if(state.recording)break;player.pause();await playNotes(token().notes,state.transpose,.65);avatar?.setState({speaking:true});setTimeout(()=>avatar?.setState({speaking:false}),token().notes.length*650);break;
      case 'hear-phrase':if(state.recording){toast('錄音時不播放提示音。');break;}player.pause();await playNotes(phrase().tokens.flatMap(t=>t.notes),state.transpose,.42);break;
      case 'speak':{player.pause();stopNotes();const utterance=speak(`${phrase().focus}。${phrase().instruction}`,state.analysis.language);avatar?.setState({speaking:true});utterance.onend=utterance.onerror=()=>avatar?.setState({speaking:false});break;}
      case 'record':await toggleRecording();break;
      case 'coach-take':await coachTake();break;
      case 'download-take':if(state.take)saveFile('聲嶼-我的練習-'+new Date().toISOString().slice(0,10)+'.wav',state.take.blob,'audio/wav');break;
      case 'clear-take':if(state.coaching){abortController?.abort();break;}state.take=null;state.feedback=null;if(recordUrl){URL.revokeObjectURL(recordUrl);recordUrl=null;}render();break;
    }
  }catch(e){toast(e.message||'操作失敗，請重試。',true);}
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='song-url')state.url=el.value;
  if(el.id==='lyrics-hint')state.lyrics=el.value;
  if(el.id==='seek'&&state.analysis)player.seek(Number(el.value),false);
});
document.addEventListener('change',async event=>{
  const el=event.target;
  try{
    if(el.id==='seek'&&state.analysis)player.seek(Number(el.value),true);
    if(el.id==='solo-input')state.solo=el.checked;
    if(el.id==='coach-consent')state.coachRights=el.checked;
    if(el.id==='song-language')state.language=el.value;
    if(el.id==='source-audio'){await attachSourceAudio(el.files?.[0]);el.value='';}
    if(el.id==='song-file'){state.file=el.files?.[0]||null;$('#file-title').textContent=state.file?.name||'選擇你的音訊檔';}
    if(el.id==='library-import'){await importFile(el.files?.[0]);el.value='';}
    if(el.id==='practice-phrase'){state.selectedPhrase=Number(el.value);state.selectedToken=0;state.take=null;state.feedback=null;render();}
    if(el.id==='rate-select'){try{player.setRate(Number(el.value));state.rate=Number(el.value);}catch(e){el.value=String(state.rate);throw e;}}
  }catch(e){toast(e.message,true);}
});
document.addEventListener('submit',async event=>{
  event.preventDefault();try{
    if(event.target.id==='song-form')await startAnalysis();
    if(event.target.id==='edit-form')applyEdit();
    if(event.target.id==='login-form'){await api.post('/api/session',{code:$('#access-code').value});await refreshStatus();closeModal();toast('已進入私人工作室。');}
  }catch(e){toast(e.message,true);}
});
document.addEventListener('click',event=>{
  const chart=event.target.closest('#melody-chart');if(!chart||!state.analysis)return;
  const box=chart.getBoundingClientRect(),x=(event.clientX-box.left)/box.width*700;player.seek(clamp((x-43)/637,0,1)*state.analysis.duration);
});
document.addEventListener('keydown',event=>{
  if(event.repeat||!state.analysis||state.recording||state.micPending||state.loading||$('.modal')||event.target.closest('input,textarea,select,button,[contenteditable]'))return;
  if(event.code==='Space'){event.preventDefault();$('#play-toggle')?.click();}
  if(event.code==='ArrowRight'){event.preventDefault();player.seek(player.time+2);}
  if(event.code==='ArrowLeft'){event.preventDefault();player.seek(player.time-2);}
  if(event.key.toLowerCase()==='l'){event.preventDefault();toggleLoop();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.source?.kind==='youtube')player.pause();});
window.addEventListener('beforeunload',()=>{abortController?.abort();lessonAbort?.abort();clearTimeout(lessonTimer);recorder?.dispose();player.dispose();avatar?.dispose();if(uploadUrl)URL.revokeObjectURL(uploadUrl);if(recordUrl)URL.revokeObjectURL(recordUrl);});
export function diagnostics(){return {build:BUILD,page:state.page,phase:state.phase,loading:state.loading,refining:state.refining,adaptive:state.analysis?.adaptive||null,lessonPending:state.lessonPending,error:state.error,
  source:state.source?{kind:state.source.kind,id:state.source.id||null}:null,playback:player.snapshot(),lyricTime:state.time,
  timedTokens:state.analysis?.phrases.reduce((n,p)=>n+p.tokens.filter(t=>Number.isFinite(t.start)&&Number.isFinite(t.end)).length,0)||0,unalignedLines:state.analysis?.unalignedLyrics?.length||0,
  listening:state.analysis?.listening||null,dataQuality:state.analysis?.dataQuality||null};}
Object.defineProperty(window,'voxDiagnostics',{value:diagnostics,writable:false,configurable:false});
render();refreshStatus();
