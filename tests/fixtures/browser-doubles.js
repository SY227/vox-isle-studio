/* Explicit TEST DOUBLES. These are not Google/YouTube integration results. */
const store=new Map();
Object.defineProperty(window,'localStorage',{value:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});
window.__qa={fixture:'normal',readyDelay:180,instances:[],requests:[],behavior:'normal',failAnalysis:false};
const realFetch=window.fetch.bind(window),encoder=new TextEncoder();
window.fetch=async(url,options={})=>{
 if(url!=='/api/analyze')return realFetch(url,options);
 window.__qa.requests.push(JSON.parse(options.body));
 const cases=await realFetch('http://localhost:3000/qa-fixtures.json').then(r=>r.json());
 return new Response(new ReadableStream({start(controller){
   let ended=false;
   const send=obj=>{if(!ended)controller.enqueue(encoder.encode(JSON.stringify(obj)+'\n'));};
   const finish=()=>{if(ended)return;
    send({type:'phase',phase:'normalizing',message:'已收到分析，正在整理歌詞時間與檢查音符…'});
    setTimeout(()=>{if(ended)return;
     if(window.__qa.failAnalysis)send({type:'error',code:'QUOTA',error:'AI 服務配額已到，請稍後重試。'});
     else {send({type:'phase',phase:'validated',message:'已完成資料整理'});send({type:'done',result:cases[window.__qa.fixture]});}
     ended=true;controller.close();
    },180);
   };
   options.signal?.addEventListener('abort',()=>{if(ended)return;ended=true;controller.error(new DOMException('Cancelled','AbortError'));});
   setTimeout(()=>send({type:'phase',phase:'accepted',message:'已確認來源格式'}),20);
   setTimeout(()=>send({type:'phase',phase:'analyzing',message:'AI 正在轉錄歌詞與建立唱法建議'}),65);
   window.__qa.finish=finish;window.__qa.sendPhase=packet=>send({type:"phase",...packet});
 }}),{headers:{'Content-Type':'application/x-ndjson'}});
};
window.YT={PlayerState:{PLAYING:1,PAUSED:2,BUFFERING:3,ENDED:0},Player:class {
 constructor(frame,options){
  this.host=frame;this.events=options.events;this.position=0;this.started=null;this.rate=1;this.playerState=-1;
  this.visibleAtConstruction=frame.getBoundingClientRect().width>=200&&frame.getBoundingClientRect().height>=200;
  const iframe=document.createElement('iframe');iframe.title='QA simulated YouTube player';iframe.src='about:blank';
  iframe.style.width='100%';iframe.style.aspectRatio='16 / 9';iframe.style.minHeight='210px';
  frame.replaceWith(iframe);this.frame=iframe;
  window.__qa.instances.push(this);
  setTimeout(()=>{if(!this.dead)this.events.onReady({target:this});},window.__qa.readyDelay);
 }
 getIframe(){return this.frame;}getPlayerState(){return this.playerState;}getPlaybackRate(){return this.rate;}getDuration(){return 305;}getCurrentTime(){return this.position+(this.started===null?0:(performance.now()-this.started)/1000*this.rate);}
 getAvailablePlaybackRates(){return [.5,.75,1,1.25];}setPlaybackRate(r){this.position=this.getCurrentTime();this.started=this.started===null?null:performance.now();this.rate=r;}
 playVideo(){if(window.__qa.behavior==='blocked'){this.events.onAutoplayBlocked({target:this});return;}this.playerState=1;this.started=performance.now();this.events.onStateChange({target:this,data:1});}
 pauseVideo(){this.position=this.getCurrentTime();this.started=null;this.playerState=2;this.events.onStateChange({target:this,data:2});}
 seekTo(t){this.position=t;if(this.started!==null)this.started=performance.now();}
 destroy(){this.dead=true;this.started=null;}
 error(code){this.events.onError({target:this,data:code});}
}};
