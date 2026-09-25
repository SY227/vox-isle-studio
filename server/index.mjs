import {newProviderRuntime} from './provider-client.mjs';
import {ProviderQueue} from './provider-queue.mjs';
import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {ROOT,getConfig} from './config.mjs';
import {validateInput,validateLesson,AppError} from './validation.mjs';
import {generate,checkModel} from './gemini.mjs';
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.wav':'audio/wav','.txt':'text/plain; charset=utf-8'};
const hash=s=>createHash('sha256').update(s).digest();
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req,limit=17_000_000){
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new AppError('請使用 JSON 格式。',415);
  if(Number(req.headers['content-length']||0)>limit)throw new AppError('請求內容太大。',413);
  let platformBody;try{platformBody=req.body;}catch{throw new AppError('JSON 格式不正確。');}
  if(platformBody!==undefined){try{const raw=typeof platformBody==='string'||Buffer.isBuffer(platformBody)?platformBody:JSON.stringify(platformBody);if(Buffer.byteLength(raw)>limit)throw new AppError('請求內容太大。',413);return typeof platformBody==='object'&&!Buffer.isBuffer(platformBody)?platformBody:JSON.parse(raw);}catch(e){if(e instanceof AppError)throw e;throw new AppError('JSON 格式不正確。');}}
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw new AppError('請求內容太大。',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError('JSON 格式不正確。');}
}
export function createApp(config=getConfig(),dependencies={}){
  config={...config,providerQueue:config.providerQueue||new ProviderQueue(3),providerRuntime:config.providerRuntime||newProviderRuntime()};
  const sessions=new Map(),buckets=new Map();let inflight=0;
  const runner=dependencies.generate||generate;
  const origins=[...new Set([config.origin,...(config.allowedOrigins||[])].filter(Boolean))];
  const allowedHosts=new Set(origins.map(o=>new URL(o).host));
  const cleanup=setInterval(()=>{const now=Date.now();for(const [k,v] of sessions)if(v<now)sessions.delete(k);for(const [k,v] of buckets)if(v.until<now)buckets.delete(k);},60000);cleanup.unref();
  function limited(req,name,max,windowMs){const key=`${req.socket.remoteAddress}:${name}`;const now=Date.now();let b=buckets.get(key);if(!b||b.until<now){b={n:0,until:now+windowMs};buckets.set(key,b);}b.n++;if(b.n>max)throw new AppError('操作次數已達保護上限，請稍後再試。',429,'RATE_LIMIT');}
  function authenticated(req){if(!config.accessCode)return true;const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('vox_session='));return cookie&&sessions.get(cookie.slice(12))>Date.now();}
  const handler=async(req,res)=>{
    const requestId=randomBytes(8).toString('hex');
    res.setHeader('X-Request-Id',requestId);
    res.setHeader('X-Vox-Build','1.3.0');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','microphone=(self), camera=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com; media-src 'self' blob:; connect-src 'self' https://www.youtube.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    try {
      const host=req.headers.host||'';
      if(!(allowedHosts.size?allowedHosts.has(host):!config.production&&/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)))throw new AppError('主機名稱不在允許清單。請設定 APP_ORIGIN。',403,'HOST');
      const url=new URL(req.url,`http://${host}`);const route=url.pathname;
      if(req.method==='POST'){
        const origin=req.headers.origin;
        if(origin && origin!==(origins.find(o=>new URL(o).host===host)||`http://${host}`))throw new AppError('拒絕跨網站請求。',403,'ORIGIN');
        if(req.headers['sec-fetch-site']==='cross-site')throw new AppError('拒絕跨網站請求。',403,'ORIGIN');
      }
      if(route==='/api/status'&&req.method==='GET')return json(res,200,{configured:Boolean(config.apiKey),model:config.model,authenticated:Boolean(authenticated(req)),requiresAccessCode:Boolean(config.accessCode),language:'zh-Hant',maxDuration:900,maxRequestBytes:config.maxBodyBytes||17000000,version:'1.3.0'});
      if(route==='/api/session'&&req.method==='POST'){
        limited(req,'login',10,900000);const input=await body(req,2048);
        if(typeof input.code!=='string'||!timingSafeEqual(hash(input.code),hash(config.accessCode)))throw new AppError('存取碼不正確。',401,'AUTH');
        const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+8*3600000);
        res.setHeader('Set-Cookie',`vox_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${config.origin.startsWith('https:')?'; Secure':''}`);return json(res,200,{ok:true});
      }
      if(route.startsWith('/api/')&&req.method==='POST'){
        if(!authenticated(req))throw new AppError('請先輸入這個私人工作室的存取碼。',401,'AUTH');
        if(route==='/api/model-check'){limited(req,'model',8,3600000);return json(res,200,await checkModel(config));}
        if(!['/api/analyze','/api/coach','/api/lesson'].includes(route))throw new AppError('找不到這個 API。',404);
        limited(req,route==='/api/lesson'?'lesson':'ai',route==='/api/lesson'?120:20,3600000);
        if(!config.apiKey)throw new AppError('分析服務目前未就緒，請稍後再試。',503,'NO_API_KEY');
        if(inflight>=3)throw new AppError('工作室正在處理其他請求，請稍後再試。',429,'BUSY');
        inflight++;
        try{
        const kind=route==='/api/coach'?'coach':route==='/api/lesson'?'lesson':'analyze';
        const raw=await body(req,config.maxBodyBytes||17000000);const input=kind==='lesson'?validateLesson(raw):validateInput(raw,kind);
        const controller=new AbortController();
        res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        req.on('error',()=>controller.abort());
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
        const emit=data=>{if(!res.destroyed)res.write(JSON.stringify({...data,requestId})+'\n');};
        emit({type:'phase',phase:'accepted',message:'已確認來源格式'});
        let lastUsable=null;
        const heartbeat=setInterval(()=>emit({type:'heartbeat'}),15000);heartbeat.unref();
        try{
          emit({type:'phase',phase:'analyzing',message:route==='/api/coach'?'AI 正在聆聽你的錄音':'AI 正在轉錄歌詞與建立唱法建議'});
          const requestConfig={...config,deadline:Date.now()+(config.timeout||420000),onDiagnostic:event=>{
            config.onDiagnostic?.({...event,requestId});
            if(process.env.VOX_DIAGNOSTICS==='1')console.info(JSON.stringify({scope:'vox-provider',requestId,...event}));
          }};
          const result=await runner(input,kind,requestConfig,controller.signal,undefined,packet=>{
            if(['ready','update'].includes(packet.type)&&packet.result)lastUsable=packet.result;
            emit({...packet,type:packet.type||'phase'});
          });
          emit({type:'phase',phase:'validated',message:'歌詞結構已整理，正在展開樂譜'});
          emit({type:'done',result});
        }catch(e){
          console.warn(JSON.stringify({scope:'vox-analysis',requestId,code:e.code||'SERVER',status:e.status||500,stage:lastUsable?'refinement':'first-result'}));
          // Once the studio is open, a later timeout/auth/task failure must not erase it.
          if(lastUsable){
            const result={...lastUsable,adaptive:{...lastUsable.adaptive,state:controller.signal.aborted?'cancelled':'partial',revision:(lastUsable.adaptive?.revision||0)+1}};
            emit({type:'done',result});
          }else emit({type:'error',error:e instanceof AppError?e.message:'分析失敗，請重試。',code:e.code||'SERVER'});
        }
        finally{clearInterval(heartbeat);res.end();}
        return;
        }finally{inflight--;}
      }
      if(!['GET','HEAD'].includes(req.method))throw new AppError('不支援的操作。',405);
      if(route.startsWith('/api/'))throw new AppError('找不到這個 API。',404);
      let decoded;try{decoded=decodeURIComponent(route);}catch{throw new AppError('路徑不正確。');}
      const isShared=decoded.startsWith('/shared/');const base=path.join(ROOT,isShared?'shared':'public');
      const relative=isShared?decoded.slice('/shared/'.length):decoded==='/'?'index.html':decoded.slice(1);
      if(relative.split('/').some(s=>s.startsWith('.')||s==='..')||relative.includes('\0'))throw new AppError('拒絕存取。',403);
      const target=path.resolve(base,relative);if(!target.startsWith(base+path.sep))throw new AppError('拒絕存取。',403);
      let info;try{info=await stat(target);}catch{throw new AppError('檔案不存在。',404);}
      if(!info.isFile())throw new AppError('檔案不存在。',404);
      res.setHeader('Content-Type',TYPES[path.extname(target)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
      if(path.extname(target)==='.wav')res.setHeader('Accept-Ranges','bytes');
      let start=0,end=info.size-1,status=200;
      if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match)throw new AppError('範圍無效。',416);
        if(match[1]===''){const suffix=Number(match[2]);start=Math.max(0,info.size-suffix);}else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;}
        if(start>end||start>=info.size)throw new AppError('範圍無效。',416);status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);
      }
      res.setHeader('Content-Length',end-start+1);res.writeHead(status);if(req.method==='HEAD')res.end();else createReadStream(target,{start,end}).on('error',()=>res.destroy()).pipe(res);
    }catch(e){
      if(res.headersSent){res.end();return;}
      const status=e instanceof AppError?e.status:500;
      if(status===429)res.setHeader('Retry-After','5');
      json(res,status,{error:e instanceof AppError?e.message:'伺服器發生錯誤，請稍後重試。',code:e.code||'SERVER',requestId});
    }
  };
  const server=http.createServer(handler);
  server.handle=handler;
  server.requestTimeout=930000;server.headersTimeout=30000;
  server.on('close',()=>clearInterval(cleanup));return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const config=getConfig();
  if((config.production||config.host==='0.0.0.0')&&(!config.origin||config.accessCode.length<16)){
    console.error('公開部署前，請設定 APP_ORIGIN 與至少 16 字元 APP_ACCESS_CODE。');process.exit(1);
  }
  if(config.production&&!config.origin.startsWith('https://')){console.error('正式部署必須透過 HTTPS 的 APP_ORIGIN。');process.exit(1);}
  createApp(config).listen(config.port,config.host,()=>{console.log(`\n  聲狐 Singing Fox\n  http://localhost:${config.port}\n  模型：${config.model}\n  API Key：${config.apiKey?'已設定（不顯示）':'未設定 — 可先體驗原創示範'}\n`);}).on('error',e=>{console.error(e.code==='EADDRINUSE'?`連接埠 ${config.port} 已使用。可執行 PORT=3001 npm start。`:e.message);process.exit(1);});
}
