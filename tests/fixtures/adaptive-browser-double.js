/* TEST ONLY: explicitly controlled AI stream. Production client/server are unchanged.
 * YouTube controller is a separate adapter backed by actual local WAV playback.
 */
(()=>{
 const previous=window.fetch.bind(window),encode=new TextEncoder();window.__qa.lessonRequests=[];window.__qa.streams=[];
 window.fetch=async(url,options={})=>{
  if(!['/api/analyze','/api/lesson'].includes(url))return previous(url,options);
  const body=JSON.parse(options.body);
  if(url==='/api/lesson'){
   window.__qa.lessonRequests.push(body);
   return new Response(new ReadableStream({start(c){let done=false;
    const finish=()=>{if(done)return;done=true;c.enqueue(encode.encode(JSON.stringify({type:'done',result:{focus:'本句專屬練習',instruction:'這是測試用教學，只輕聲練習。',pronunciation:'保持字音。',exercise:'慢唱一次。',caution:'不適停止。'}})+'\n'));c.close();};
    options.signal?.addEventListener('abort',()=>{if(done)return;done=true;c.error(new DOMException('Cancelled','AbortError'));});
    window.__qa.finishLesson=finish;if(window.__qa.autoLesson!==false)setTimeout(finish,180);
   }}),{headers:{'Content-Type':'application/x-ndjson'}});
  }
  window.__qa.requests.push(body);const cases=await previous('http://localhost:3000/qa-adaptive.json').then(r=>r.json());
  return new Response(new ReadableStream({start(c){let ended=false;
   const send=x=>{if(!ended)c.enqueue(encode.encode(JSON.stringify(x)+'\n'));};
   const stream={ready:()=>send({type:'ready',result:cases.ready}),update:()=>send({type:'update',result:cases.updated}),
    done:()=>{send({type:'done',result:cases.done});ended=true;c.close();},partial:()=>{send({type:'done',result:cases.partial});ended=true;c.close();},
    duplicate:()=>send({type:'update',result:cases.ready}),lateError:()=>{send({type:'error',code:'GEMINI_500',error:'模擬第8段中斷'});ended=true;c.close();},
    eof:()=>{ended=true;c.close();},break:()=>{ended=true;c.error(new Error('TEST NETWORK DISCONNECT'));}};
   window.__qa.streams.push(stream);window.__qa.stream=stream;
   options.signal?.addEventListener('abort',()=>{if(ended)return;ended=true;window.__qa.aborted=true;c.error(new DOMException('Cancelled','AbortError'));});
   send({type:'phase',phase:'analyzing',message:'正在聆聽全曲…',detail:{stage:'fast-scan'}});
  }}),{headers:{'Content-Type':'application/x-ndjson'}});
 };
})();
