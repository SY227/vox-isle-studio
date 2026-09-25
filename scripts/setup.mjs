import {existsSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeGeminiApiKey,isPlausibleGeminiApiKey,envAssignment} from '../shared/credentials.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(Number(process.versions.node.split('.')[0])<22){console.error('請先安裝 Node.js 22 或更新版本。');process.exit(1);}
console.log('\n聲嶼 · Gemini 3.8 Flash 設定\n金鑰只寫入本機 .env，不進入前端、不加入 Git。\n支援目前 Google AI Studio 的 AQ. Auth Key 與舊版 AIza API Key。');
if(!process.stdin.isTTY){console.error('請在互動式終端機執行 npm run setup。亦可複製 .env.example 至 .env 後編輯。');process.exit(1);}
const rawKey=await new Promise(resolve=>{
  let value='';process.stdin.setRawMode(true);
  process.stdout.write('貼上 Gemini API Key（隱藏輸入；保留目前設定請直接 Enter）：');
  process.stdin.resume();process.stdin.setEncoding('utf8');
  const handler=chunk=>{for(const ch of chunk){
    if(ch==='\u0003'){process.stdin.setRawMode(false);console.log('\n已取消。');process.exit(130);}
    if(ch==='\r'||ch==='\n'){process.stdin.off('data',handler);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');resolve(value);return;}
    if(ch==='\u007f'||ch==='\b')value=value.slice(0,-1);else if(ch>=' ')value+=ch;
  }};process.stdin.on('data',handler);
});
const key=normalizeGeminiApiKey(rawKey);
const envPath=path.join(root,'.env');let env=existsSync(envPath)?readFileSync(envPath,'utf8'):readFileSync(path.join(root,'.env.example'),'utf8');
if(key){
  if(!isPlausibleGeminiApiKey(key)){console.error('金鑰格式看起來不完整，設定未更動。請直接從 Google AI Studio 複製完整 API Key；AQ. 與 AIza 格式均支援。');process.exit(1);}
  const line=envAssignment('GEMINI_API_KEY',key);
  env=/^GEMINI_API_KEY=.*$/m.test(env)?env.replace(/^GEMINI_API_KEY=.*$/m,line):env+`\n${line}\n`;
}
if(!/^GEMINI_MODEL=/m.test(env))env+='\nGEMINI_MODEL=gemini-3.8-flash\n';
writeFileSync(envPath,env,{mode:0o600});chmodSync(envPath,0o600);
console.log('設定已儲存。接著：\n  npm run check:api\n  npm run dev\n\n瀏覽器開啟 http://localhost:3000\n');
