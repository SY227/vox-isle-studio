import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const ROOT=fileURLToPath(new URL('../',import.meta.url));
if(existsSync(ROOT+'.env'))process.loadEnvFile(ROOT+'.env');
export function getConfig(){return {apiKey:process.env.GEMINI_API_KEY||'',model:process.env.GEMINI_MODEL||'gemini-3.8-flash',port:Number(process.env.PORT||3000),host:process.env.HOST||'127.0.0.1',origin:process.env.APP_ORIGIN||'',accessCode:process.env.APP_ACCESS_CODE||'',production:process.env.NODE_ENV==='production',timeout:900000};}
