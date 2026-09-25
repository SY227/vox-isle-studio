import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('production layout skin is embedded in index and not dependent on a CSS fetch', async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/id="vox-production-style"/);
  assert.match(html,/\.skip\{position:fixed/);
  assert.match(html,/\.hero\{display:grid/);
  assert.match(html,/\.input-card\{/);
  assert.doesNotMatch(html,/rel="stylesheet"[^>]+styles\.css/);
});
