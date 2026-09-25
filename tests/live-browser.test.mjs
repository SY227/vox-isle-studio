import test from 'node:test';
import assert from 'node:assert/strict';
import {CDP,waitFor} from '../scripts/lib/live-browser.mjs';
class Socket extends EventTarget {
  sent=[];send(s){this.sent.push(JSON.parse(s));}
  respond(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
  close(){this.dispatchEvent(new Event('close'));}
}
test('live-check CDP correlates responses without raw credential storage',async()=>{
 const s=new Socket(),c=new CDP(s);const a=c.send('A'),b=c.send('B');s.respond({id:2,result:{value:'b'}});s.respond({id:1,result:{value:'a'}});assert.deepEqual(await a,{value:'a'});assert.deepEqual(await b,{value:'b'});c.close();
});
test('live-check CDP rejects protocol failures and browser exceptions',async()=>{
 const s=new Socket(),c=new CDP(s);const a=c.send('A');s.respond({id:1,error:{message:'denied'}});await assert.rejects(a,/denied/);
 const b=c.evaluate('x');s.respond({id:2,result:{exceptionDetails:{text:'bad expression'}}});await assert.rejects(b,/bad expression/);c.close();
});
test('live-check click uses two trusted browser input commands, not DOM click',async()=>{
 const s=new Socket(),c=new CDP(s);const p=c.click('#play');
 s.respond({id:1,result:{result:{value:{x:20,y:30}}}});await new Promise(r=>setImmediate(r));
 assert.equal(s.sent[1].method,'Input.dispatchMouseEvent');assert.equal(s.sent[1].params.type,'mousePressed');s.respond({id:2,result:{}});await new Promise(r=>setImmediate(r));assert.equal(s.sent[2].params.type,'mouseReleased');s.respond({id:3,result:{}});await p;c.close();
});
test('live-check rejects disabled input and pending commands on close',async()=>{
 const s=new Socket(),c=new CDP(s);const p=c.click('#disabled');s.respond({id:1,result:{result:{value:null}}});await assert.rejects(p,/操作尚不可用/);const q=c.send('Pending');s.close();await assert.rejects(q,/已關閉/);c.close();
});
test('live-check wait observes real predicate and times out without claiming pass',async()=>{
 let count=0;assert.equal(await waitFor(()=>++count>2?'ready':false,100,2),'ready');await assert.rejects(waitFor(()=>false,5,1),/逾時/);
});
