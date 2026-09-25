import {readdirSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const walk=p=>readdirSync(p).flatMap(n=>{const f=path.join(p,n);return statSync(f).isDirectory()?walk(f):[f];});
const files=['server','shared','public','scripts','tests','api'].flatMap(walk).filter(p=>/\.(mjs|js)$/.test(p));let failed=0;
for(const f of files){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status){console.error(f,r.stderr);failed++;}}
console.log(`${files.length} 個 JavaScript 模組：${failed?'有 '+failed+' 個錯誤':'語法檢查通過'}`);process.exitCode=failed?1:0;
