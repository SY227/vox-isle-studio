/* QA ONLY. Official-controller-shaped adapter backed by REAL HTMLAudioElement
 * media. The native iframe controls do not click or invoke any app controls.
 * Not a live YouTube or Google test. This file is never served by production.
 */
window.__qa.nativeInstances=[];
window.__qa.dropStateEvents=false;
window.YT={PlayerState:{PLAYING:1,PAUSED:2,BUFFERING:3,ENDED:0},Player:class {
  constructor(host,options){
    this.events=options.events;this.ready=false;this.dead=false;
    const frame=document.createElement('iframe');frame.title='測試播放器 · 真實本機音訊';
    frame.style.cssText='display:block;width:100%;min-height:230px;border:0';
    frame.srcdoc=`<!doctype html><html lang="zh-Hant"><head><style>body{margin:0;background:#eaf5ef;color:#275d51;font:13px system-ui;display:flex;flex-direction:column;justify-content:center;padding:22px;box-sizing:border-box;height:230px}h2{font-size:20px;margin:6px 0}p{font-size:11px;line-height:1.7;margin:4px 0 16px}audio{width:100%;height:42px}label{font-size:11px;margin-top:12px;display:flex;gap:9px;align-items:center}input{min-width:0;width:100%}</style></head><body><small>QA · REAL LOCAL AUDIO</small><h2>微光練習曲</h2><p>原生媒體控制測試 · 非 YouTube 實際串流</p><audio id="native-audio" controls preload="auto"></audio><label>位置<input id="native-seek" type="range" min="0" max="49" step=".1" value="0" aria-label="原生播放位置"></label></body></html>`;
    this.frame=frame;host.replaceWith(frame);window.__qa.nativeInstances.push(this);
    frame.addEventListener('load',async()=>{
      if(this.dead)return;const audio=frame.contentDocument.querySelector('audio');this.audio=audio;
      const ready=()=>{if(this.dead||this.ready)return;this.ready=true;this.events.onReady?.({target:this});};
      if(audio.readyState>=1)ready();else audio.addEventListener('loadedmetadata',ready,{once:true});
      for(const event of ['play','playing','pause','ended'])audio.addEventListener(event,()=>{
        if(!this.dead&&!window.__qa.dropStateEvents)this.events.onStateChange?.({target:this,data:this.getPlayerState()});
      });
      audio.addEventListener('ratechange',()=>this.events.onPlaybackRateChange?.({target:this,data:audio.playbackRate}));
      frame.contentDocument.querySelector('#native-seek').addEventListener('input',e=>audio.currentTime=Number(e.target.value));
      // Blob media is fully seekable in this offline runner (its HTTP route
      // adapter does not implement range requests). Time is still HTML media time.
      const blob=await fetch('http://localhost:3000/audio/demo.wav').then(r=>r.blob());
      if(this.dead)return;this.blobURL=URL.createObjectURL(blob);audio.src=this.blobURL;
    });
  }
  getIframe(){return this.frame;}
  getDuration(){return this.audio?.duration||0;}
  getCurrentTime(){return this.audio?.currentTime||0;}
  getPlayerState(){return !this.ready?-1:this.audio?.ended?0:this.audio?.paused?2:1;}
  getPlaybackRate(){return this.audio?.playbackRate||1;}
  getAvailablePlaybackRates(){return [.5,.75,1,1.25,1.5,2];}
  setPlaybackRate(rate){if(this.audio)this.audio.playbackRate=rate;}
  playVideo(){this.audio?.play().catch(()=>this.events.onAutoplayBlocked?.({target:this}));}
  pauseVideo(){this.audio?.pause();}
  seekTo(time){if(this.audio)this.audio.currentTime=time;}
  destroy(){this.dead=true;this.audio?.pause();this.frame.remove();if(this.blobURL)URL.revokeObjectURL(this.blobURL);}
}};
