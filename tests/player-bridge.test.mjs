import test from 'node:test';
import assert from 'node:assert/strict';
import {Player,DirectYouTubeBridge} from '../public/modules/player.mjs';
const source={kind:'youtube',id:'4ULVNHHqbew',url:'https://www.youtube.com/watch?v=4ULVNHHqbew'};
function setup(t){
 const listeners=new Set(),sent=[];
 globalThis.location={origin:'http://localhost:3000'};
 globalThis.window={addEventListener:(n,f)=>{if(n==='message')listeners.add(f);},removeEventListener:(n,f)=>listeners.delete(f)};
 const make=()=>({id:'native-frame',src:'https://www.youtube.com/embed/'+source.id,contentWindow:{postMessage:(v,target)=>sent.push({v:JSON.parse(v),target})},addEventListener(){},removeEventListener(){},remove(){}});
 globalThis.document={createElement:()=>make()};
 const mount={replaceChildren(f){this.frame=f;}};
 const player=new Player(()=>{},()=>{},()=>{},{apiLoader:async()=>{throw new Error('blocked');},readyTimeout:10,bridgeTimeout:5});
 t.after(()=>player.dispose());
 const message=(data,frame=mount.frame,origin='https://www.youtube.com')=>{for(const listener of [...listeners])listener({source:frame.contentWindow,origin,data:JSON.stringify(data)});};
 return {player,mount,sent,message,listeners,make};
}
test('late real iframe message adopts the fallback after the loading deadline',async t=>{
 const {player,mount,message}=setup(t);await player.load(source,mount);assert.equal(player.status,'native');
 message({event:'infoDelivery',info:{currentTime:13.4,duration:305,playerState:1}});
 assert.equal(player.transport,'postmessage');assert.equal(player.ready,true);assert.equal(player.playing,true);assert.equal(player.time,13.4);
});
test('fallback native pause/seek update immediately without calling app play()',async t=>{
 const {player,mount,message}=setup(t);await player.load(source,mount);let last;player.onTick=t=>last=t;
 message({event:'infoDelivery',info:{currentTime:21,duration:305,playerState:1}});
 message({event:'infoDelivery',info:{currentTime:7,duration:305,playerState:2}});
 assert.equal(player.playing,false);assert.equal(last,7);
});
test('fallback does not invent time while awaiting more iframe information',async t=>{
 const {player,mount,message}=setup(t);await player.load(source,mount);
 message({event:'infoDelivery',info:{currentTime:9,duration:305,playerState:1}});
 await new Promise(r=>setTimeout(r,100));assert.equal(player.time,9);
});
test('bridge ignores messages from a different window even at YouTube origin',async t=>{
 const {player,mount,message,make}=setup(t);await player.load(source,mount);
 message({event:'infoDelivery',info:{currentTime:9,playerState:1}},make());assert.equal(player.ready,false);
});
test('bridge ignores invalid or lookalike message origins',async t=>{
 const {player,mount,message}=setup(t);await player.load(source,mount);
 for(const origin of ['','null','http://www.youtube.com','https://youtube.com.evil.example','https://evil.example'])message({event:'infoDelivery',info:{currentTime:9,playerState:1}},mount.frame,origin);
 assert.equal(player.ready,false);
});
test('outgoing bridge commands have a specific YouTube origin rather than wildcard',async t=>{
 const {player,mount,message,sent}=setup(t);await player.load(source,mount);message({event:'onReady'});await player.play();
 assert.ok(sent.length);assert.ok(sent.every(s=>s.target==='https://www.youtube.com'));
});
test('unacknowledged fallback seek does not pretend the source has already moved',async t=>{
 const {player,mount,message,sent}=setup(t);await player.load(source,mount);message({event:'infoDelivery',info:{currentTime:9,duration:305,playerState:2}});
 player.seek(33);assert.equal(player.time,9);assert.ok(sent.some(s=>s.v.func==='seekTo'&&s.v.args[0]===33));
 message({event:'infoDelivery',info:{currentTime:33,duration:305,playerState:2}});assert.equal(player.time,33);
});
test('fallback release removes message listeners and ignores late media activity',async t=>{
 const {player,mount,message,listeners}=setup(t);await player.load(source,mount);message({event:'onReady'});assert.equal(listeners.size,1);player.release();assert.equal(listeners.size,0);message({event:'onStateChange',info:1});assert.equal(player.playing,false);
});
test('fallback playback error remains fatal until reconnect, not erased by infoDelivery',async t=>{
 const {player,mount,message}=setup(t);await player.load(source,mount);message({event:'onReady'});message({event:'onError',info:150});message({event:'infoDelivery',info:{currentTime:9,duration:305,playerState:1}});assert.equal(player.status,'error');assert.equal(player.ready,false);
});
