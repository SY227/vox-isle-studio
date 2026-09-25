/** Small Chrome DevTools transport; Node 22+ WebSocket, no npm dependency. */
export class CDP {
  constructor(socket) {
    this.socket=socket;this.id=0;this.pending=new Map();this.listeners=new Map();
    socket.addEventListener('message',e=>{
      let m;try{m=JSON.parse(String(e.data));}catch{return;}
      if(m.id){const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}
      else for(const f of this.listeners.get(m.method)||[])f(m.params);
    });
    socket.addEventListener('close',()=>this.rejectPending());
  }
  static async connect(url) {
    const ws=new WebSocket(url);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{ws.close();reject(new Error('Chrome 偵錯連線逾時'));},10000);
      ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Chrome 偵錯連線失敗'));},{once:true});
    });
    return new CDP(ws);
  }
  on(method,fn){if(!this.listeners.has(method))this.listeners.set(method,[]);this.listeners.get(method).push(fn);}
  send(method,params={}) {
    const id=++this.id;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} 逾時`));},20000);
      this.pending.set(id,{resolve,reject,timer});
      try{this.socket.send(JSON.stringify({id,method,params}));}catch(e){this.pending.delete(id);clearTimeout(timer);reject(e);}
    });
  }
  async evaluate(expression){const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text||'瀏覽器執行錯誤');return r.result?.value;}
  async click(selector){
    const pos=await this.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    if(!pos)throw new Error(`操作尚不可用：${selector}`);
    await this.send('Input.dispatchMouseEvent',{type:'mousePressed',...pos,button:'left',clickCount:1});
    await this.send('Input.dispatchMouseEvent',{type:'mouseReleased',...pos,button:'left',clickCount:1});
  }
  rejectPending(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Chrome 連線已關閉'));}this.pending.clear();}
  close(){this.rejectPending();this.socket.close();}
}
export async function waitFor(fn,timeout=15000,interval=200) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,interval));}
  throw new Error('等待實際狀態逾時');
}
