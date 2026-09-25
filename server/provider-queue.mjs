/** One app-wide cap, shared by enrichment and user-requested lessons. */
export class ProviderQueue {
  constructor(limit=3){this.limit=Math.max(1,Math.min(3,Math.floor(limit)||3));this.active=0;this.waiters=[];}
  async run(task,signal){
    if(signal?.aborted)throw signal.reason||new DOMException('Cancelled','AbortError');
    await new Promise((resolve,reject)=>{
      const entry={start:()=>{signal?.removeEventListener('abort',abort);this.active++;resolve();}};
      const abort=()=>{const i=this.waiters.indexOf(entry);if(i>=0)this.waiters.splice(i,1);reject(signal.reason||new DOMException('Cancelled','AbortError'));};
      signal?.addEventListener('abort',abort,{once:true});
      if(this.active<this.limit)entry.start();else this.waiters.push(entry);
    });
    try{if(signal?.aborted)throw signal.reason||new DOMException('Cancelled','AbortError');return await task();}
    finally{this.active--;this.waiters.shift()?.start();}
  }
}
