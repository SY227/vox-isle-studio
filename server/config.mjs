import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const ROOT=fileURLToPath(new URL('../',import.meta.url));
if(existsSync(ROOT+'.env'))process.loadEnvFile(ROOT+'.env');
const milliseconds=(name,fallback,min=500,max=900000)=>{const n=Number(process.env[name]);return Number.isFinite(n)&&n>=min&&n<=max?n:fallback;};
export function getConfig(){
  const vercel=process.env.VERCEL==='1';
  const origin=process.env.APP_ORIGIN||(vercel&&process.env.VERCEL_PROJECT_PRODUCTION_URL?`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`:'');
  const allowedOrigins=[origin,...(vercel?[process.env.VERCEL_URL,process.env.VERCEL_BRANCH_URL].filter(Boolean).map(h=>`https://${h}`):[])].filter(Boolean);
  return {apiKey:process.env.GEMINI_API_KEY||'',model:process.env.GEMINI_MODEL||'gemini-3.8-flash',port:Number(process.env.PORT||3000),
    host:process.env.HOST||'127.0.0.1',origin,allowedOrigins,accessCode:process.env.APP_ACCESS_CODE||'',production:process.env.NODE_ENV==='production',vercel,
    // End cleanly before the configured 300s platform maximum, preserving any ready result.
    timeout:Math.min(milliseconds('VOX_JOB_TIMEOUT_MS',vercel?260000:420000),vercel?260000:900000),
    attemptTimeoutMs:milliseconds('VOX_ATTEMPT_TIMEOUT_MS',undefined),passBudgetMs:milliseconds('VOX_PASS_BUDGET_MS',undefined),
    maxBodyBytes:vercel?4_000_000:17_000_000};
}
