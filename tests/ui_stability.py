"""Line-first, deployment-shaped static files and native local-audio QA.
No real Google API / YouTube stream is replaced by a false live pass.
"""
import asyncio,json,os,shutil
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('VOX_QA_OUTPUT',ROOT/'test-results-v121/ui_stability'));OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  async def ok(name,value):
   assert value,name;checks.append(name);print('PASS',name,flush=True)
  async def setup(width=1440,broken=False):
   page=await browser.new_page(viewport={'width':width,'height':1000},reduced_motion='reduce');page.set_default_timeout(10000)
   page.on('pageerror',lambda e:errors.append(str(e)))
   async def route(r):
    u=urlparse(r.request.url);headers={'Access-Control-Allow-Origin':'*'}
    if u.path=='/api/status':return await r.fulfill(status=200,headers=headers,json={'configured':True,'authenticated':True,'version':'1.2.2'})
    if u.path=='/qa-adaptive.json':return await r.fulfill(status=200,headers=headers,body=(ROOT/'tests/fixtures/stability-cases.json').read_bytes(),content_type='application/json')
    f=ROOT/'dist'/u.path[1:]
    if not f.is_file() or (broken and u.path=='/shared/music.mjs'):return await r.fulfill(status=404,headers=headers,body='Deliberate missing import')
    types={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav'}
    return await r.fulfill(status=200,headers=headers,content_type=types.get(f.suffix,'text/plain'),body=f.read_bytes())
   await page.route('http://localhost:3000/**',route)
   scripts='\n'.join((ROOT/'tests/fixtures'/name).read_text() for name in ['browser-doubles.js','native-media-double.js','adaptive-browser-double.js'])
   html=(ROOT/'dist/index.html').read_text().replace('<head>','<head><base href="http://localhost:3000/"><script>'+scripts+'</script>')
   await page.set_content(html,wait_until='networkidle');return page
  for width in [1440,390]:
   page=await setup(width)
   await ok(f'{width}: deployed static module graph boots nonblank app',await page.locator('#song-form').is_visible())
   await page.locator('#song-url').fill('https://www.youtube.com/watch?v=J2uD1UXLTVs')
   await page.locator('#song-form button[type=submit]').click();await page.wait_for_function('window.__qa.streams.length===1')
   await page.evaluate('window.__qa.stream.ready()');await page.wait_for_function('window.voxDiagnostics().playback.ready')
   await ok(f'{width}: compact first scan displays every line',await page.locator('.phrase-row').count()==8)
   await ok(f'{width}: compact ready result has no invented word boundaries',await page.evaluate('window.voxDiagnostics().timedTokens')==0)
   await ok(f'{width}: future detailed labels remain pending',await page.locator('.tech-mini').filter(has_text='分析中').count()>30)
   await ok(f'{width}: requested exact video ID retained',await page.evaluate('window.voxDiagnostics().source.id')=='J2uD1UXLTVs')
   await page.evaluate('window.__keptFrame=document.querySelector("#youtube-mount iframe")')
   await page.frame_locator('#youtube-mount iframe').locator('#native-audio').click(position={'x':20,'y':20})
   await page.wait_for_function('window.voxDiagnostics().playback.time>2&&document.querySelectorAll(".phrase-row.active").length===1')
   await ok(f'{width}: native source playback drives line highlight before word detail',await page.locator('.phrase-row.active').count()==1)
   await ok(f'{width}: no fabricated karaoke sweep on line-only text',await page.locator('.token.current').count()==0)
   before=await page.evaluate('window.voxDiagnostics().playback.time')
   await page.evaluate('window.__qa.stream.update()');await page.wait_for_timeout(250)
   await ok(f'{width}: progressive timing does not recreate iframe',await page.evaluate('window.__keptFrame===document.querySelector("#youtube-mount iframe")'))
   await ok(f'{width}: media clock advances across word-detail patch',await page.evaluate('window.voxDiagnostics().playback.time')>before)
   await page.wait_for_function('document.querySelectorAll(".token.current").length===1')
   await ok(f'{width}: returned word timings now drive word highlight',await page.locator('.token.current').count()==1)
   await page.locator('#play-toggle').click()
   await ok(f'{width}: the one app transport pauses native source',not await page.evaluate('window.voxDiagnostics().playback.playing'))
   await page.evaluate('window.__qa.stream.lateError()');await page.wait_for_function('!window.voxDiagnostics().refining')
   await ok(f'{width}: provider failure keeps compact transcript and enrichment',await page.locator('.phrase-row').count()==8 and await page.evaluate('window.voxDiagnostics().adaptive.state')=='partial')
   await ok(f'{width}: layout does not overflow',await page.evaluate('document.documentElement.scrollWidth<=innerWidth+2'))
   await page.evaluate('scrollTo(0,0)');await page.screenshot(path=str(OUT/f'studio-{width}.png'),full_page=True)
   await page.close()
  await ok('normal operation has no uncaught JavaScript exceptions',not errors)
  # Negative deployment: missing required JS must present a recovery path, not a blank gradient.
  page=await setup(broken=True)
  await page.wait_for_selector('#reload-page',timeout=16000)
  await ok('missing static import displays recoverable startup notice',await page.locator('#reload-page').is_visible() and '頁面載入未完成' in await page.locator('body').inner_text())
  await page.close();await browser.close()
 (OUT/'report.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'scope':'Static deployment files; simulated provider, real local audio inside iframe. No live YouTube/Gemini.'},ensure_ascii=False,indent=2))
 print('TOTAL',len(checks))
asyncio.run(main())
