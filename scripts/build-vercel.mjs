import {cp,mkdir,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const dest=path.join(root,'dist');
await rm(dest,{recursive:true,force:true});await mkdir(dest,{recursive:true});
await cp(path.join(root,'public'),dest,{recursive:true});
// These imports live outside public/ in the development server. Without this
// copy, a static deployment serves the background but app.mjs cannot execute.
await cp(path.join(root,'shared'),path.join(dest,'shared'),{recursive:true});
const html=await readFile(path.join(dest,'index.html'),'utf8');
if(!html.includes('vox-production-style'))throw new Error('Production style missing');
console.log('Singing Fox build: static app + shared imports; API handled by api/index.mjs.');
