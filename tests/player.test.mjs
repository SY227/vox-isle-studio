import test from 'node:test';
import assert from 'node:assert/strict';
import {Player,youtubeError} from '../public/modules/player.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
globalThis.location={origin:'http://localhost:3000'};
globalThis.document={createElement:tag=>({tag,remove(){this.removed=true;}})};
const source={kind:'youtube',id:'4ULVNHHqbew',url:'https://www.youtube.com/watch?v=4ULVNHHqbew'};
function setup(t,{ready=true,delay=0,loaderFails=false,play='normal'}={}){
 const states=[],instances=[],mount={replaceChildren(child){this.child=child;}};
 class Video{
  constructor(frame,options){this.frame=frame;this.events=options.events;this.position=0;this.playerState=-1;this.iframe={isConnected:true};instances.push(this);if(ready)setTimeout(()=>this.events.onReady({target:this}),delay);}
  getIframe(){return this.iframe;}getPlayerState(){return this.playerState;}getDuration(){return 305;}getCurrentTime(){return this.position;}getAvailablePlaybackRates(){return [.5,1];}setPlaybackRate(r){this.rate=r;}
  playVideo(){if(play==='blocked')this.events.onAutoplayBlocked({target:this});else if(play==='normal'){this.playerState=1;this.events.onStateChange({target:this,data:1});}}
  pauseVideo(){this.playerState=2;this.events.onStateChange({target:this,data:2});}seekTo(t){this.position=t;}destroy(){this.destroyed=true;}
 }
 const player=new Player(()=>{},(_playing,s)=>states.push(s),()=>{},
  {apiLoader:async()=>{if(loaderFails)throw new Error('script blocked');return {Player:Video};},readyTimeout:35,playTimeout:20});
 t.after(()=>player.dispose());return {player,instances,mount,states};
}
test('official IFrame API is the primary synchronized YouTube controller',async t=>{
 const {player,mount,instances}=setup(t);const task=player.load(source,mount);
 assert.equal(player.ready,false);await task;assert.equal(player.ready,true);assert.equal(player.transport,'iframe-api');
 assert.equal(instances.length,1);assert.equal(instances[0].frame.tag,'div');
});
test('play and clock only report playing after actual player state event',async t=>{
 const {player,mount,instances}=setup(t);await player.load(source,mount);await player.play();assert.equal(player.playing,true);instances[0].position=3;assert.equal(player.time,3);player.pause();assert.equal(player.playing,false);
});
test('autoplay block becomes actionable native-player state, not fake playback',async t=>{
 const {player,mount}=setup(t,{play:'blocked'});await player.load(source,mount);await player.play();assert.equal(player.status,'needs-gesture');assert.equal(player.playing,false);
});
test('no play callback triggers watchdog instead of an endless false pause button',async t=>{
 const {player,mount}=setup(t,{play:'silent'});await player.load(source,mount);await player.play();await wait(30);assert.equal(player.status,'needs-gesture');assert.equal(player.playing,false);
});
test('script failure preserves native iframe and clears loading state',async t=>{
 const {player,mount}=setup(t,{loaderFails:true});await player.load(source,mount);assert.equal(player.status,'native');assert.equal(player.loading,false);assert.ok(mount.child.src.includes(source.id));assert.equal(await player.play(),false);
});
test('onReady timeout is recoverable and a later genuine onReady connects',async t=>{
 const {player,mount,instances}=setup(t,{ready:false});await player.load(source,mount);assert.equal(player.status,'native');instances[0].events.onReady({target:instances[0]});assert.equal(player.status,'ready');assert.equal(player.ready,true);
});
test('rapid source replacement resolves old load, and ignores old ready/state callbacks',async t=>{
 const {player,mount,instances}=setup(t,{ready:false});const old=player.load(source,mount);await wait(1);const second=player.load({...source,id:'dQw4w9WgXcQ'},mount);await old;await wait(1);
 instances[0].events.onReady({target:instances[0]});instances[0].events.onStateChange({target:instances[0],data:1});assert.equal(player.ready,false);assert.equal(player.playing,false);
 instances[1].events.onReady({target:instances[1]});await second;assert.equal(player.ready,true);assert.equal(instances[0].destroyed,true);
});
test('153 is identified correctly and later unrelated states cannot erase fatal error',async t=>{
 const {player,mount,instances}=setup(t);await player.load(source,mount);instances[0].events.onError({target:instances[0],data:153});assert.equal(player.status,'error');assert.equal(player.ready,false);assert.match(player.message,/原片/);
 instances[0].events.onStateChange({target:instances[0],data:5});assert.equal(player.status,'error');
});
test('all documented common embed errors have actionable messages',()=>{
 for(const code of [2,5,100,101,150,153])assert.ok(youtubeError(code).length>10);assert.match(youtubeError(1234),/1234/);
});
test('saved audio-less score has a missing-source action, not a pretend ready player',async t=>{
 const {player,mount}=setup(t);await player.load({kind:'upload'},mount);assert.equal(player.status,'missing');assert.equal(player.ready,false);assert.equal(await player.play(),false);
});
test('seek while connecting is queued and applied on explicit play',async t=>{
 const {player,mount,instances}=setup(t);const task=player.load(source,mount);player.seek(15);await task;assert.equal(instances[0].position,0);await player.play();assert.equal(instances[0].position,15);
});
test('seek clamps to media duration, ignores NaN, and speed errors are readable',async t=>{
 const {player,mount,instances}=setup(t);await player.load(source,mount);player.seek(999);assert.equal(instances[0].position,304.99);player.seek(NaN);assert.equal(instances[0].position,304.99);assert.throws(()=>player.setRate(.75));player.setRate(.5);assert.equal(player.rate,.5);
});
test('loop follows media clock and releases cleanly on new source',async t=>{
 const {player,mount,instances}=setup(t);await player.load(source,mount);player.loop={start:2,end:5};await player.play();instances[0].position=6;player.tick();assert.equal(instances[0].position,2);player.release();assert.equal(player.loop,null);assert.equal(player.status,'idle');
});
test('cached audio metadata fires safely because handlers exist before src/load',async t=>{
 const old=globalThis.Audio;
 class Audio extends EventTarget{
  constructor(){super();this.duration=32;this.currentTime=0;}
  load(){if(this.src)this.dispatchEvent(new Event('loadedmetadata'));}removeAttribute(){this.src='';}pause(){this.dispatchEvent(new Event('pause'));}async play(){this.dispatchEvent(new Event('play'));}
 }
 globalThis.Audio=Audio;t.after(()=>{globalThis.Audio=old;});const {player,mount}=setup(t);await player.load({kind:'demo',audioUrl:'/audio/demo.wav'},mount);assert.equal(player.ready,true);assert.equal(player.duration,32);await player.play();assert.equal(player.playing,true);
});
test('asynchronous buffering cannot erase the playback timeout safeguard',async t=>{
 const {player,mount,instances}=setup(t,{play:'silent'});await player.load(source,mount);await player.play();
 instances[0].playerState=3;instances[0].events.onStateChange({target:instances[0],data:3});await wait(90);
 assert.equal(player.status,'needs-gesture');assert.equal(player.playing,false);
});

test('native YouTube Play starts the clock before the app play button was ever used',async t=>{
 const {player,mount,instances}=setup(t);let last;player.onTick=time=>last=time;await player.load(source,mount);
 const yt=instances[0];yt.position=17.25;yt.playerState=1;yt.events.onStateChange({target:yt,data:1});
 assert.equal(player.playing,true);assert.equal(last,17.25);
});
test('native pause and native seek recolor from the true paused position',async t=>{
 const {player,mount,instances}=setup(t);await player.load(source,mount);const yt=instances[0];let time;player.onTick=t=>time=t;
 yt.position=20;yt.playerState=2;yt.events.onStateChange({target:yt,data:2});assert.equal(player.playing,false);assert.equal(time,20);
 yt.position=3;player.tick();assert.equal(time,3);assert.equal(player.status,'paused');
});
test('state polling recovers a missed native Play event without an app click',async t=>{
 const {player,mount,instances}=setup(t);await player.load(source,mount);const yt=instances[0];yt.playerState=1;yt.position=9;
 player.tick();assert.equal(player.playing,true);assert.equal(player.time,9);
});
test('polling recovers a missed native Pause without an artificial continuing clock',async t=>{
 const {player,mount,instances}=setup(t);await player.load(source,mount);const yt=instances[0];await player.play();yt.position=11;yt.playerState=2;
 player.tick();assert.equal(player.status,'paused');assert.equal(player.time,11);
});
test('a native play state arriving before onReady is adopted and not reset',async t=>{
 const {player,mount,instances}=setup(t,{ready:false});const loading=player.load(source,mount);await wait(1);const yt=instances[0];
 yt.playerState=1;yt.position=12;yt.events.onStateChange({target:yt,data:1});yt.events.onReady({target:yt});await loading;
 assert.equal(player.ready,true);assert.equal(player.playing,true);assert.equal(player.time,12);
});
test('native rate change is included in transport state',async t=>{
 const {player,mount,instances}=setup(t);await player.load(source,mount);
 instances[0].events.onPlaybackRateChange({target:instances[0],data:1.25});assert.equal(player.snapshot().rate,1.25);
});
test('buffering freezes on the real clock, with no synthetic interpolation',async t=>{
 const {player,mount,instances}=setup(t);await player.load(source,mount);const yt=instances[0];yt.position=8;yt.playerState=3;yt.events.onStateChange({target:yt,data:3});
 await wait(100);assert.equal(player.time,8);assert.equal(player.playing,false);assert.equal(player.status,'buffering');
});
test('native ended state leaves the last real lyric position, and next play restarts',async t=>{
 const {player,mount,instances}=setup(t);await player.load(source,mount);const yt=instances[0];yt.position=305;yt.playerState=0;yt.events.onStateChange({target:yt,data:0});
 assert.equal(player.status,'ended');await player.play();assert.equal(yt.position,0);assert.equal(player.status,'playing');
});
test('a detached late official onReady cannot replace a new native source',async t=>{
 const {player,mount,instances}=setup(t,{ready:false});const loading=player.load(source,mount);await wait(1);const yt=instances[0];yt.iframe.isConnected=false;await loading;
 assert.equal(yt.destroyed,true);yt.events.onReady({target:yt});assert.equal(player.ready,false);assert.equal(player.status,'native');
});
