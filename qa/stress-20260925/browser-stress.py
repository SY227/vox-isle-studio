"""Controlled browser stress, real local media; NO live Google or YouTube.
First-party modules are route-fulfilled because browser navigation is blocked.
"""
import asyncio,json,os,shutil
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('SF_QA_OUT',ROOT/'test-results/browser-stress-20260925'));OUT.mkdir(parents=True,exist_ok=True)
URLS=['https://www.youtube.com/watch?v=eV9a5oUCbZQ&list=RDMMYaJ_lYFgr6c&index=2','https://www.youtube.com/watch?v=J2uD1UXLTVs&list=RDMMYaJ_lYFgr6c&index=3','https://www.youtube.com/watch?v=miBGaUagOz8&list=RDMMYaJ_lYFgr6c&index=7']
checks=[];errors=[]
async def main():
 async with async_playwright() as ap:
  browser=await ap.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  async def ok(name,value,detail=None):
   checks.append({'name':name,'passed':bool(value),'detail':detail});print('PASS' if value else 'FAIL',name,flush=True)
  async def page_new(width=1440):
   page=await browser.new_page(viewport={'width':width,'height':1000},reduced_motion='reduce');page.set_default_timeout(8000);page.on('pageerror',lambda e:errors.append(str(e)))
   async def route(r):
    u=urlparse(r.request.url);headers={'Access-Control-Allow-Origin':'*'}
    if u.path=='/api/status':return await r.fulfill(status=200,json={'configured':True,'authenticated':True,'version':'1.2.2'},headers=headers)
    if u.path=='/qa-adaptive.json':return await r.fulfill(status=200,body=(ROOT/'tests/fixtures/stability-cases.json').read_bytes(),content_type='application/json',headers=headers)
    f=ROOT/u.path[1:] if u.path.startswith('/shared/') else ROOT/'public'/u.path[1:]
    if not f.is_file():return await r.fulfill(status=404,headers=headers)
    types={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.wav':'audio/wav','.svg':'image/svg+xml','.css':'text/css'}
    return await r.fulfill(status=200,body=f.read_bytes(),content_type=types.get(f.suffix,'text/plain'),headers=headers)
   await page.route('http://localhost:3000/**',route)
   init="const sfStore=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>sfStore.get(k)||null,setItem:(k,v)=>sfStore.set(k,v),removeItem:k=>sfStore.delete(k)}});window.__qa={requests:[]};"
   native=(ROOT/'tests/fixtures/native-media-double.js').read_text()
   adaptive=(ROOT/'tests/fixtures/adaptive-browser-double.js').read_text().replace('window.__qa.streams.push(stream);','stream.raw=send;window.__qa.streams.push(stream);')
   html=(ROOT/'public/index.html').read_text().replace('<head>','<head><base href="http://localhost:3000/"><script>'+init+native+adaptive+'</script>')
   await page.set_content(html,wait_until='networkidle');return page
  async def begin(page,url):
   n=await page.evaluate('window.__qa.streams.length');await page.locator('#song-url').fill(url)
   await page.locator('#song-form button[type=submit]').click();await page.wait_for_function('(n)=>window.__qa.streams.length>n',arg=n)
  async def enter(page):
   await page.evaluate('window.__qa.stream.ready()');await page.wait_for_function('window.voxDiagnostics().page==="studio"&&window.voxDiagnostics().playback.ready')
  for url in URLS:
   page=await page_new();id=urlparse(url).query.split('&')[0].split('=')[1]
   await begin(page,url);await enter(page)
   await ok(id+': actual chosen source ID retained (simulated media)',await page.evaluate('window.voxDiagnostics().source.id')==id)
   await page.evaluate('window.__sfFrame=document.querySelector("#youtube-mount iframe")')
   await page.frame_locator('#youtube-mount iframe').locator('#native-audio').click(position={'x':20,'y':20})
   await page.wait_for_function('window.voxDiagnostics().playback.time>2')
   await ok(id+': native local-audio playback drives provisional line highlighting',await page.locator('.phrase-row.active').count()==1)
   await page.evaluate('window.__qa.stream.update()');await page.wait_for_function('document.querySelectorAll(".token.current").length>0')
   await ok(id+': actual word timing update adds current-word highlight',await page.locator('.token.current').count()==1)
   await page.locator('#play-toggle').click()
   # Stress pure UI without new analysis calls, using genuine input events.
   for i in range(36):
    await page.locator(f'[data-token="{i%8}:0"]').click()
    await page.locator('[data-filter=run]' if i%2 else '[data-filter=all]').click()
   await ok(id+': 72 rapid selection/filter gestures do not recreate the iframe',await page.evaluate('window.__sfFrame===document.querySelector("#youtube-mount iframe")&&window.__qa.nativeInstances.length===1'))
   await ok(id+': selection never issues hidden paid lesson requests',await page.evaluate('window.__qa.lessonRequests.length')==0)
   await page.evaluate('window.__qa.stream.lateError()');await page.wait_for_function('!window.voxDiagnostics().refining')
   await ok(id+': final provider error retains all eight original test lines',await page.locator('.phrase-row').count()==8 and await page.evaluate('window.voxDiagnostics().adaptive.state')=='partial')
   await page.locator('#play-toggle').click();await page.wait_for_function('window.voxDiagnostics().playback.playing')
   await ok(id+': play remains usable after provider failure',await page.evaluate('window.voxDiagnostics().playback.playing'))
   await page.locator('#play-toggle').click();await page.evaluate('scrollTo(0,0)')
   if id=='miBGaUagOz8':await page.screenshot(path=str(OUT/'desktop-after-provider-error-simulated.png'),full_page=True)
   await page.close()
  page=await page_new(390)
  for i in range(12):
   await begin(page,URLS[i%3]);await page.locator('[data-action=cancel]').click();await page.wait_for_function('window.voxDiagnostics().page==="home"&&!window.voxDiagnostics().loading')
  await ok('Twelve start/cancel cycles return to usable home',await page.locator('#song-form').is_visible())
  await ok('Cancellation cycles generate exactly twelve analysis streams, not duplicates',await page.evaluate('window.__qa.requests.length')==12)
  await begin(page,URLS[0]);await enter(page);await page.evaluate('window.__qa.stream.update()');await page.wait_for_timeout(200)
  await page.locator('[data-action=stop-refining]').click();await page.wait_for_function('!window.voxDiagnostics().refining')
  await ok('Stop refinement preserves score and cancelled state',await page.locator('.phrase-row').count()==8 and await page.evaluate('window.voxDiagnostics().adaptive.state')=='cancelled')
  await ok('Mobile has one top transport and no horizontal overflow',await page.locator('.studio-chrome #play-toggle').count()==1 and await page.evaluate('document.documentElement.scrollWidth<=innerWidth+2'))
  await page.screenshot(path=str(OUT/'mobile-after-cancel-simulated.png'),full_page=True)
  await page.close();await ok('No uncaught JavaScript exceptions in the stress flows',not errors,errors)
  await browser.close()
 report={'scope':'Controlled provider stream + actual local WAV in explicitly labelled player. Not real song playback.','checks':checks,'passed':sum(x['passed'] for x in checks),'failed':sum(not x['passed'] for x in checks),'pageErrors':errors,'rapidGestures':216,'cancelCycles':12}
 (OUT/'browser-stress.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print('TOTAL',len(checks))
asyncio.run(main())
