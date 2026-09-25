import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('production stylesheet is self-contained and substantial',async()=>{
  const css=await readFile(path.join(ROOT,'public','styles.css'),'utf8');
  assert.ok(css.length>30000,`styles.css unexpectedly small: ${css.length}`);
  assert.ok(!/^\s*@import\b/m.test(css),'styles.css must not depend on @import');
  assert.match(css,/--bg:#f6f9f6/);
  assert.match(css,/\.hero\{/);
  assert.match(css,/\.primary\{/);
});

test('index embeds the complete production stylesheet so layout does not depend on a CSS request',async()=>{
  const html=await readFile(path.join(ROOT,'public','index.html'),'utf8');
  assert.match(html,/id="vox-production-style"/);
  assert.match(html,/\.hero\{display:grid/);
  assert.doesNotMatch(html,/rel="stylesheet"[^>]+styles\.css/);
});

test('app entry and player module URLs are versioned, not only CSS',async()=>{
 const html=await readFile(path.join(ROOT,'public/index.html'),'utf8'),app=await readFile(path.join(ROOT,'public/app.mjs'),'utf8');
 assert.match(html,/app\.mjs\?v=1\.2\.3/);assert.match(app,/player\.mjs\?v=1\.2\.3/);
});
test('rights gate removed; passive processing notice and stage progress retained',async()=>{
 const app=await readFile(path.join(ROOT,'public/app.mjs'),'utf8');assert.ok(!app.includes('rights-input'));assert.match(app,/source-disclosure/);assert.match(app,/role="progressbar"/);assert.match(app,/非音訊處理百分比/);
});

test('release metadata and all executable browser asset URLs have the same version',async()=>{
 const pkg=JSON.parse(await readFile(path.join(ROOT,'package.json'),'utf8'));
 const lock=JSON.parse(await readFile(path.join(ROOT,'package-lock.json'),'utf8'));
 assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);
 for(const file of ['public/index.html','public/app.mjs','public/modules/audio.mjs','public/workers/pitch-worker.mjs']){
  const text=await readFile(path.join(ROOT,file),'utf8');
  for(const match of text.matchAll(/\?v=(\d+\.\d+\.\d+)/g))assert.equal(match[1],pkg.version,`stale cache tag in ${file}`);
 }
});

test('Singing Fox branding is visible and legacy companion/setup UI is absent',async()=>{
 const html=await readFile(path.join(ROOT,'public','index.html'),'utf8'),app=await readFile(path.join(ROOT,'public','app.mjs'),'utf8');
 assert.match(html,/聲狐 Singing Fox/);
 assert.match(app,/SINGING FOX/);
 assert.doesNotMatch(app,/分析說明/);
 assert.doesNotMatch(app,/澄 · 你的聲音嚮導|YOUR VOCAL COMPANION|逐句陪練/);
});
