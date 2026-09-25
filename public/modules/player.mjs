/**
 * One media source, one clock, regardless of which Play button was pressed.
 * Official IFrame events plus state polling cover native controls and missed
 * callbacks. The fallback only consumes actual iframe messages: no fake clock.
 */
let apiPromise;

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function loadApiAttempt(timeout=6500){
  if(globalThis.window?.YT?.Player)return window.YT;
  return new Promise((resolve,reject)=>{
    let settled=false,poll,timer;
    const previous=window.onYouTubeIframeAPIReady;
    const script=document.createElement('script');
    const finish=(error)=>{
      if(settled)return;settled=true;clearTimeout(timer);clearInterval(poll);
      if(window.onYouTubeIframeAPIReady===ready)window.onYouTubeIframeAPIReady=previous;
      if(error){script.remove?.();reject(error);}else resolve(window.YT);
    };
    const ready=()=>{try{previous?.();}catch{}if(window.YT?.Player)finish();};
    window.onYouTubeIframeAPIReady=ready;
    timer=setTimeout(()=>finish(new Error('iframe api timeout')),timeout);
    poll=setInterval(()=>{if(window.YT?.Player)finish();},80);
    script.dataset.voxYoutubeApi='1';
    script.src='https://www.youtube.com/iframe_api';script.async=true;
    script.onerror=()=>finish(new Error('iframe api blocked'));
    document.head.append(script);
  });
}

export function loadYouTubeApi(timeout=6500){
  if(globalThis.window?.YT?.Player)return Promise.resolve(window.YT);
  if(apiPromise)return apiPromise;
  apiPromise=(async()=>{
    let last;
    for(let attempt=0;attempt<3;attempt++){
      try{return await loadApiAttempt(timeout);}catch(e){last=e;if(attempt<2)await sleep(220*(attempt+1));}
    }
    throw last||new Error('YouTube control unavailable');
  })().catch(error=>{apiPromise=null;throw error;});
  return apiPromise;
}

export function youtubeError(code){
  return ({2:'這支影片的播放資料無效。',5:'這個瀏覽器暫時無法播放這支影片。',
    100:'這支影片目前無法在這裡播放。',101:'這支影片不允許在頁面內播放。',
    150:'這支影片不允許在頁面內播放。',153:'原片暫時無法建立頁內播放連線。'})[code]||`原片播放發生錯誤（${Number(code)||'未知'}）。`;
}

export class DirectYouTubeBridge {
  constructor(iframe, {onReady=()=>{}, onState=()=>{}, onError=()=>{}, onTime=()=>{}}={}) {
    Object.assign(this, {iframe, onReady, onState, onError, onTime});
    this.position=0; this.duration=0; this.playerState=-1; this.rate=1;
    this.availableRates=[1]; this.connected=false; this.destroyed=false;
    this._message=this._message.bind(this);
    this.readyPromise=new Promise(resolve=>{this._resolveReady=resolve;});
    if(typeof window!=='undefined'&&iframe?.contentWindow) {
      window.addEventListener('message', this._message);
      this._listen=()=>this.send({event:'listening',id:iframe.id||'vox-player',channel:'widget'});
      iframe.addEventListener?.('load',this._listen);
      this._pulse=setInterval(this._listen,350); this._listen();
    }
  }
  send(payload) {
    if(this.destroyed)return;
    const origin=this.iframe?.src?.includes('youtube-nocookie.com')?'https://www.youtube-nocookie.com':'https://www.youtube.com';
    try{this.iframe?.contentWindow?.postMessage(JSON.stringify(payload),origin);}catch{}
  }
  command(func,args=[]) {this.send({event:'command',func,args,id:this.iframe?.id||'vox-player',channel:'widget'});}
  _markReady() {
    if(this.connected)return;
    this.connected=true; clearInterval(this._pulse);
    this.command('addEventListener',['onStateChange']);
    this.command('addEventListener',['onPlaybackRateChange']);
    this._resolveReady?.(this); this.onReady(this);
  }
  _message(event) {
    if(this.destroyed||event.source!==this.iframe?.contentWindow)return;
    if(!/^https:\/\/(?:www\.)?(?:youtube\.com|youtube-nocookie\.com)$/.test(event.origin||''))return;
    let data=event.data;
    try{if(typeof data==='string')data=JSON.parse(data);}catch{return;}
    if(!data||typeof data!=='object')return;
    const info=data.info&&typeof data.info==='object'?data.info:null;
    let nextState;
    if(info) {
      if(Number.isFinite(info.currentTime)&&info.currentTime>=0)this.position=info.currentTime;
      if(Number.isFinite(info.duration)&&info.duration>0)this.duration=info.duration;
      if(Number.isFinite(info.playbackRate)&&info.playbackRate>0)this.rate=info.playbackRate;
      if(Array.isArray(info.availablePlaybackRates))this.availableRates=info.availablePlaybackRates.filter(n=>Number.isFinite(n)&&n>0);
      if(Number.isFinite(info.playerState))nextState=info.playerState;
    }
    if(data.event==='onStateChange'&&Number.isFinite(data.info))nextState=data.info;
    if(data.event==='onPlaybackRateChange'&&Number.isFinite(data.info))this.rate=data.info;
    if(Number.isFinite(nextState))this.playerState=nextState;
    // Late readiness after the initial timeout remains connected, even when the
    // first interaction was with YouTube's own controls rather than our button.
    if(['initialDelivery','onReady','infoDelivery','onStateChange'].includes(data.event))this._markReady();
    if(Number.isFinite(nextState))this.onState(nextState,this);
    if(info&&Number.isFinite(info.currentTime))this.onTime(this);
    if(data.event==='onError')this.onError(Number(data.info)||0,this);
  }
  getDuration(){return this.duration;}
  getCurrentTime(){return this.position;}
  getPlayerState(){return this.playerState;}
  getPlaybackRate(){return this.rate;}
  getAvailablePlaybackRates(){return this.availableRates.length?this.availableRates:[1];}
  playVideo(){this.command('playVideo');}
  pauseVideo(){this.command('pauseVideo');}
  seekTo(t,allow=true){this.command('seekTo',[t,allow]);} // Wait for real position acknowledgement.
  setPlaybackRate(rate){this.command('setPlaybackRate',[rate]);}
  destroy(){
    this.destroyed=true; clearInterval(this._pulse);
    if(typeof window!=='undefined')window.removeEventListener('message',this._message);
    this.iframe?.removeEventListener?.('load',this._listen);
    this._resolveReady?.(null);
  }
}

export class Player {
  constructor(onTick=()=>{},onState=()=>{},onError=()=>{},options={}) {
    Object.assign(this,{onTick,onState,onError});
    this.options={apiLoader:loadYouTubeApi,readyTimeout:12000,playTimeout:10000,bridgeTimeout:5000,...options};
    this.loop=null; this.rate=1; this.duration=0; this.generation=0; this.status='idle';
    this.playing=false; this.ready=false; this.loading=false; this.pendingSeek=null; this.message='';
    this.timer=setInterval(()=>this.tick(),80);
  }
  snapshot(){return {status:this.status,ready:this.ready,loading:this.loading,playing:this.playing,time:this.time,
    duration:this.duration,rate:this.rate,message:this.message,errorCode:this.errorCode??null,transport:this.transport||null};}
  notify(status,message='') {
    this.status=status; this.message=message; this.loading=status==='loading'; this.playing=status==='playing';
    this.onState(this.playing,this.snapshot());
  }
  _duration(target=this.yt) {
    try{const value=target?.getDuration?.();if(Number.isFinite(value)&&value>0)this.duration=value;}catch{}
  }
  _mapState(code,generation,target=this.yt) {
    if(generation!==this.generation||this.errorCode!=null||![-1,0,1,2,3,5].includes(code))return;
    this._duration(target); this.ready=true; this._lastYTState=code;
    const next={1:'playing',2:'paused',3:'buffering',0:'ended',5:'ready','-1':'ready'}[code];
    if(code!==3){clearTimeout(this.playTimer);this.playRequested=false;}
    if(this.status!==next)this.notify(next,next==='buffering'?'影片正在緩衝…':'');
    // Source-initiated events also drive the first highlight immediately.
    this.onTick(this.time,this.duration);
  }
  _acceptController(target,transport,generation) {
    if(generation!==this.generation||this.errorCode!=null)return;
    this.yt=target; this.transport=transport; this.ready=true; this._duration(target);
    if(transport==='iframe-api'&&this.bridge){this.bridge.destroy();this.bridge=null;}
    let code;
    try{code=target.getPlayerState?.();}catch{}
    if(!Number.isFinite(code))code=this._lastYTState;
    if(Number.isFinite(code))this._mapState(code,generation,target);
    else this.notify('ready','可以播放');
    this.onTick(this.time,this.duration);
  }
  _failure(code,generation) {
    if(generation!==this.generation)return;
    clearTimeout(this.playTimer);this.playRequested=false;this.ready=false;this.errorCode=Number(code)||0;
    this.notify('error',youtubeError(code));this.onError(this.message);
  }
  _createIframe(source,mount,generation) {
    const frame=document.createElement('iframe');frame.id=`vox-youtube-${generation}`;frame.title='YouTube 原始影片播放器';
    frame.width='480';frame.height='270';frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;
    frame.referrerPolicy='strict-origin-when-cross-origin';
    const params=new URLSearchParams({enablejsapi:'1',origin:globalThis.location?.origin||'http://localhost',playsinline:'1',controls:'1',rel:'0'});
    frame.src=`https://www.youtube.com/embed/${encodeURIComponent(source.id)}?${params}`;
    mount.replaceChildren(frame);this.iframe=frame;return frame;
  }
  async load(source,mount) {
    this.release();const generation=this.generation;this.source=source;this.mount=mount;
    this.notify('loading',source.kind==='youtube'?'正在準備原片…':'正在讀取音訊…');
    const current=()=>generation===this.generation;
    if(source.kind==='youtube') {
      if(!mount)throw new Error('播放器容器不存在。');
      mount.replaceChildren();let YT;
      try{YT=await this.options.apiLoader(this.options.readyTimeout);}catch{}
      if(!current())return;
      const session={active:true};this.officialSession=session;
      const officialCurrent=()=>current()&&session.active;
      if(YT?.Player) {
        const host=document.createElement('div');host.id=`vox-youtube-host-${generation}`;mount.replaceChildren(host);
        await new Promise(resolve=>{
          let settled=false;
          const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);if(this.cancelLoad===finish)this.cancelLoad=null;resolve();};
          const timer=setTimeout(finish,this.options.readyTimeout);this.cancelLoad=finish;
          try{
            const controller=new YT.Player(host,{
              width:'100%',height:'100%',videoId:source.id,
              playerVars:{playsinline:1,controls:1,rel:0,origin:globalThis.location?.origin||'http://localhost'},
              events:{
                onReady:e=>{if(!officialCurrent())return;this.official=e.target||this.official;this._acceptController(this.official,'iframe-api',generation);finish();},
                onStateChange:e=>{
                  if(!officialCurrent()||this.errorCode!=null)return;
                  if(e.target&&this.yt!==e.target)this._acceptController(e.target,'iframe-api',generation);
                  this._mapState(e.data,generation,e.target||this.yt);
                },
                onPlaybackRateChange:e=>{if(!officialCurrent())return;this.rate=Number(e.data)||this.rate;this.onState(this.playing,this.snapshot());},
                onAutoplayBlocked:()=>{if(!officialCurrent())return;clearTimeout(this.playTimer);this.playRequested=false;this.notify('needs-gesture','請在影片內按一次播放。');},
                onError:e=>{if(!officialCurrent())return;this._failure(e.data,generation);finish();}
              }
            });
            this.official=controller;this.yt=controller;
          }catch{session.active=false;finish();}
        });
        if(!current()||this.ready||this.errorCode!=null)return;
      }
      // Preserve the actual iframe if only its ready callback was late. Do not
      // connect a stale official wrapper to a newly replaced native iframe.
      let frame;
      try{frame=this.official?.getIframe?.()||mount.querySelector?.('iframe');}catch{}
      if(!frame||frame.isConnected===false){
        session.active=false;try{this.official?.destroy?.();}catch{}this.official=null;
        frame=this._createIframe(source,mount,generation);
      }else this.iframe=frame;
      let bridge;
      if(typeof window!=='undefined'&&frame?.contentWindow) {
        bridge=new DirectYouTubeBridge(frame,{
          onReady:b=>{if(current()&&this.bridge===b&&this.errorCode==null)this._acceptController(b,'postmessage',generation);},
          onState:(code,b)=>{if(current()&&this.yt===b)this._mapState(code,generation,b);},
          onTime:b=>{if(current()&&this.yt===b&&this.ready)this.tick();},
          onError:(code,b)=>{if(current()&&this.yt===b)this._failure(code,generation);}
        });
        this.bridge=bridge;this.yt=bridge;
        await new Promise(resolve=>{
          let settled=false;
          const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);if(this.cancelLoad===finish)this.cancelLoad=null;resolve();};
          const timer=setTimeout(finish,this.options.bridgeTimeout);this.cancelLoad=finish;
          bridge.readyPromise.then(finish);
        });
      }
      if(!current()||this.ready||this.errorCode!=null)return;
      this.notify('native','可先在原片內播放；取得播放時間後，歌詞會自動跟上。');
    } else if(source.audioUrl) {
      const audio=new Audio();this.audio=audio;audio.preload='auto';audio.playbackRate=this.rate;this.transport='html-audio';
      for(const [event,status] of [['play','playing'],['playing','playing'],['pause','paused'],['waiting','buffering'],['ended','ended']]) {
        audio.addEventListener(event,()=>{if(current()&&(status!=='paused'||this.ready)){this.notify(status,status==='buffering'?'音訊正在緩衝…':'');this.onTick(this.time,this.duration);}});
      }
      audio.addEventListener('seeked',()=>{if(current())this.tick();});
      audio.addEventListener('ratechange',()=>{if(current()){this.rate=audio.playbackRate;this.onState(this.playing,this.snapshot());}});
      await new Promise(resolve=>{
        let settled=false;
        const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);if(this.cancelLoad===finish)this.cancelLoad=null;resolve();};
        const timer=setTimeout(()=>{if(current()){this.ready=false;this.notify('error','音訊準備逾時，請重新連線。');}finish();},this.options.readyTimeout);this.cancelLoad=finish;
        audio.addEventListener('loadedmetadata',()=>{if(!current())return;this.duration=Number.isFinite(audio.duration)?audio.duration:0;this.ready=true;this.notify('ready','可以播放');finish();},{once:true});
        audio.addEventListener('error',()=>{if(!current())return;this.ready=false;this.notify('error','無法播放此音訊，請重新選擇。');this.onError(this.message);finish();});
        audio.src=source.audioUrl;audio.load();
      });
    }else {this.ready=false;this.notify('missing','請重新連結這首歌的音訊來源。');}
  }
  get time(){try{const t=this.yt?.getCurrentTime?.()??this.audio?.currentTime??0;return Number.isFinite(t)&&t>=0?t:0;}catch{return 0;}}
  seek(seconds,allowSeekAhead=true) {
    if(!Number.isFinite(seconds))return;
    const t=Math.max(0,Math.min(seconds,this.duration>0?Math.max(0,this.duration-.01):seconds));
    if(!this.ready){this.pendingSeek=t;return;}
    if(this.yt?.seekTo)this.yt.seekTo(t,allowSeekAhead);
    else if(this.audio)this.audio.currentTime=t;
    this.tick(); // Read the source, never claim an unacknowledged seek succeeded.
  }
  async play() {
    if(!this.ready)return false;
    if(this.pendingSeek!==null){const t=this.pendingSeek;this.pendingSeek=null;this.seek(t);}
    if(this.status==='ended')this.seek(0);
    if(this.yt) {
      this.playRequested=true;this.notify('buffering','正在開始播放…');
      try{this.yt.playVideo();this.watchForPlayback(this.generation);}catch{this.notify('needs-gesture','請在影片內按一次播放。');return false;}
    }else if(this.audio) {
      try{await this.audio.play();}catch{this.notify('needs-gesture','瀏覽器需要再按一次播放。');return false;}
    }
    return true;
  }
  watchForPlayback(generation) {
    clearTimeout(this.playTimer);
    if(!this.playing&&this.status!=='needs-gesture')this.playTimer=setTimeout(()=>{
      if(generation===this.generation&&!this.playing&&this.ready)this.notify('needs-gesture','請直接在影片內按一次播放。');
    },this.options.playTimeout);
  }
  pause(){clearTimeout(this.playTimer);this.playRequested=false;try{this.yt?.pauseVideo?.();this.audio?.pause();}catch{}if(this.ready)this.notify('paused');}
  async toggle(){if(this.playing||this.status==='buffering'){this.pause();return true;}return this.play();}
  setRate(rate) {
    if(!this.ready)throw new Error('播放器準備好後才能調整速度。');
    if(this.yt){const available=this.yt.getAvailablePlaybackRates?.()||[1];if(available.length&&!available.includes(rate))throw new Error('此影片不支援這個速度。');this.yt.setPlaybackRate(rate);}
    if(this.audio)this.audio.playbackRate=rate;this.rate=rate;
  }
  tick() {
    if(this.errorCode!=null)return;
    // Poll actual state even while paused/not ready, so a native click or native
    // seek is never dependent on having pressed the app's button first.
    if(this.yt) {
      try{
        const code=this.yt.getPlayerState?.();
        if([-1,0,1,2,3,5].includes(code)&&(this.ready||[0,1,2,3,5].includes(code))&&
          (code!==this._lastYTState||!this.ready))this._mapState(code,this.generation,this.yt);
        const rate=this.yt.getPlaybackRate?.();
        if(Number.isFinite(rate)&&rate>0&&this.rate!==rate){this.rate=rate;this.onState(this.playing,this.snapshot());}
      }catch{}
      this._duration();
    }
    if(!this.ready)return;
    const time=this.time;
    if(this.playing&&this.loop&&time>=this.loop.end) {
      // Guard asynchronous seek acknowledgements from creating a request storm.
      const now=Date.now();
      if(!this.lastLoopSeek||now-this.lastLoopSeek>1000){this.lastLoopSeek=now;this.seek(this.loop.start);}
      return;
    }
    this.lastLoopSeek=0;this.onTick(time,this.duration);
  }
  release() {
    this.generation++;clearTimeout(this.playTimer);this.cancelLoad?.();this.cancelLoad=null;
    if(this.officialSession)this.officialSession.active=false;
    for(const obj of new Set([this.yt,this.official,this.bridge]))try{obj?.destroy?.();}catch{}
    this.yt=null;this.official=null;this.bridge=null;
    if(this.audio){try{this.audio.pause();this.audio.removeAttribute('src');this.audio.load();}catch{}this.audio=null;}
    this.iframe?.remove?.();this.iframe=null;
    this.ready=false;this.loading=false;this.loop=null;this.playing=false;this.duration=0;this.pendingSeek=null;
    this.errorCode=null;this.source=null;this.status='idle';this.message='';this.transport=null;
    this._lastYTState=undefined;this.playRequested=false;this.lastLoopSeek=0;
  }
  dispose(){this.release();clearInterval(this.timer);}
}
