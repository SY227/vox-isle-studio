"""Progressive UX acceptance: actual app/modules and real local audio time.
AI responses and the YouTube controller are explicitly test-only adapters.
The supplied URLs exercise canonicalization, not live-provider availability.
"""
import asyncio,json,os,shutil
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('VOX_QA_OUTPUT',ROOT/'test-results-adaptive'));OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
URLS=['https://www.youtube.com/watch?v=YaJ_lYFgr6c&list=RDeV9a5oUCbZQ&index=2','https://www.youtube.com/watch?v=4ULVNHHqbew&list=RD4ULVNHHqbew&start_radio=1']
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  async def ok(name,value):
   assert value,name;checks.append(name);print('PASS',name,flush=True)
  async def setup(width=1440):
   page=await browser.new_page(viewport={'width':width,'height':1000},reduced_motion='reduce')
   page.on('pageerror',lambda e:errors.append(str(e)))
   async def route(r):
    u=urlparse(r.request.url);headers={'Access-Control-Allow-Origin':'*'}
    if u.path=='/api/status':return await r.fulfill(status=200,headers=headers,json={'configured':True,'authenticated':True,'version':'1.2.0'})
    if u.path=='/qa-adaptive.json':return await r.fulfill(status=200,headers=headers,json=json.loads((ROOT/'tests/fixtures/adaptive-cases.json').read_text()))
    f=ROOT/u.path[1:] if u.path.startswith('/shared/') else ROOT/'public'/u.path[1:]
    if u.path.endswith('.css'):return await r.fulfill(status=404,headers=headers,body='Deliberate CSS failure')
    if not f.is_file():return await r.fulfill(status=404,headers=headers,body='not found')
    types={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav'}
    return await r.fulfill(status=200,headers=headers,content_type=types.get(f.suffix,'text/plain'),body=f.read_bytes())
   await page.route('http://localhost:3000/**',route)
   scripts='\n'.join((ROOT/'tests/fixtures'/name).read_text() for name in ['browser-doubles.js','native-media-double.js','adaptive-browser-double.js'])
   html=(ROOT/'public/index.html').read_text().replace('<head>','<head><base href="http://localhost:3000/"><script>'+scripts+'</script>')
   await page.set_content(html,wait_until='networkidle');return page
  async def start(page,url=URLS[0]):
   count=await page.evaluate('window.__qa.streams.length');await page.locator('#song-url').fill(url);await page.locator('#song-form button[type=submit]').click();await page.wait_for_function('(n)=>window.__qa.streams.length>n',arg=count,timeout=15000)
  async def enter(page):
   await page.evaluate('window.__qa.stream.ready()');await page.wait_for_function('window.voxDiagnostics().page==="studio"&&!window.voxDiagnostics().loading');await page.wait_for_function('window.voxDiagnostics().playback.ready')
  async def update(page):
   await page.evaluate('window.__qa.stream.update()');await page.wait_for_function('window.voxDiagnostics().adaptive.revision===5')
  page=await setup()
  await ok('embedded production CSS survives all stylesheet requests failing',await page.locator('.hero').evaluate('e=>getComputedStyle(e).display==="grid"'))
  await start(page)
  await ok('first scan has real loading workflow, not mandatory segment reviews','精修' in await page.locator('.loading-page').inner_text())
  await page.screenshot(path=str(OUT/'loading-first-scan.png'),full_page=True)
  await enter(page)
  await ok('studio opens on ready while analysis stream is still unfinished',await page.evaluate('window.voxDiagnostics().refining&&window.voxDiagnostics().adaptive.state==="refining"'))
  await ok('all first-pass lines are visible before teaching completes',await page.locator('.phrase-row').count()==8)
  await ok('future pending labels are explicit, not invented techniques',await page.locator('.tech-mini').filter(has_text='分析中').count()>20)
  await ok('only first tab and no developer setup or cover UI',await page.locator('.nav button').count()==1 and await page.locator('.api-status,.song-id img,.player-track img').count()==0)
  await ok('one working app transport remains at top',await page.locator('.studio-chrome #play-toggle').count()==1 and await page.locator('[data-action=play]').count()==1)
  await ok('playable does not falsely claim confidence as accuracy','准确率' not in await page.locator('.refinement-banner').inner_text())
  await ok('no deep lessons generated automatically on opening',await page.evaluate('window.__qa.lessonRequests.length')==0)
  await ok('exact Canon QA video selected, radio playlist removed',await page.evaluate('window.__qa.requests[0].url')=='https://www.youtube.com/watch?v=YaJ_lYFgr6c')
  await page.evaluate('window.__keptIframe=document.querySelector("#youtube-mount iframe");window.__keptMount=document.querySelector("#youtube-mount")')
  native=page.frame_locator('#youtube-mount iframe').locator('#native-audio')
  await native.click(position={'x':20,'y':20})
  await page.wait_for_function('window.voxDiagnostics().playback.playing&&window.voxDiagnostics().playback.time>2')
  await page.wait_for_function('document.querySelectorAll(".token.current").length>0')
  await ok('native media-first playback starts lyric highlight before enrichment completes',await page.locator('.token.current').count()>0)
  before=await page.evaluate('window.voxDiagnostics().playback.time')
  await update(page)
  await page.wait_for_timeout(500)
  await ok('progressive update does not move, replace, or restart the player',await page.evaluate('window.__keptIframe===document.querySelector("#youtube-mount iframe")&&window.__qa.nativeInstances.length===1'))
  await ok('actual media clock keeps advancing through annotation patch',await page.evaluate('window.voxDiagnostics().playback.time')>before)
  await ok('completed first-half labels appear while later labels still pending',await page.locator('#phrase-0 .tech-mini').filter(has_text='分析中').count()==0 and await page.locator('#phrase-7 .tech-mini').filter(has_text='分析中').count()>0)
  await ok('progress reports processed tasks only',await page.locator('.refinement-meter').get_attribute('aria-valuenow')=='4')
  await ok('playback-driven selection does not issue paid lesson requests',await page.evaluate('window.__qa.lessonRequests.length')==0)
  # Stop playback to inspect stable UI; a deliberate word click must not pause it.
  await page.locator('#play-toggle').click();await page.locator('[data-token="0:2"]').click()
  await page.wait_for_function('window.__qa.lessonRequests.length===1')
  await page.wait_for_function('window.voxDiagnostics().lessonPending===-1')
  await ok('manual word click requests exactly one on-demand lesson',await page.evaluate('window.__qa.lessonRequests.length')==1)
  await ok('on-demand lesson displays its response','本句專屬練習' in await page.locator('#coach-detail').inner_text())
  await page.locator('[data-token="0:3"]').click();await page.wait_for_timeout(500)
  await ok('same phrase lesson is cached across different words',await page.evaluate('window.__qa.lessonRequests.length')==1)
  await page.evaluate('window.__qa.stream.duplicate()');await page.wait_for_timeout(200)
  await ok('out-of-order snapshot cannot undo newer labels',await page.evaluate('window.voxDiagnostics().adaptive.revision')==5)
  # Keep source iframe mounted through edit and later server snapshots.
  await page.locator('[data-action=edit]').click();await page.locator('[data-edit-technique="0"]').select_option('falsetto');await page.locator('#edit-form button[type=submit]').click()
  await ok('manual correction has visible user-edited provenance','已手動校正' in await page.locator('.song-meta').inner_text())
  await page.evaluate('window.__qa.stream.done()');await page.wait_for_function('!window.voxDiagnostics().refining&&window.voxDiagnostics().adaptive.state==="complete"')
  await ok('manual provenance survives final background snapshot','已手動校正' in await page.locator('.song-meta').inner_text())
  await ok('manual correction survives final background snapshot',await page.locator('[data-token="0:0"]').get_attribute('data-technique')=='falsetto')
  await ok('cached lesson survives final background snapshot','本句專屬練習' in await page.locator('#coach-detail').inner_text())
  await ok('last verse obtains annotations, never cut off by readiness',await page.locator('#phrase-7 .tech-mini').filter(has_text='分析中').count()==0)
  await ok('finalization leaves same playable iframe intact',await page.evaluate('window.__keptIframe===document.querySelector("#youtube-mount iframe")'))
  await page.evaluate('window.scrollTo(0,0)');await page.screenshot(path=str(OUT/'desktop-complete.png'),full_page=True)
  await page.close()
  # Later failure/connection loss/cancellation scenarios.
  for method in ['partial','lateError','eof','break']:
   page=await setup();await start(page,URLS[1]);await enter(page);await update(page)
   await page.evaluate('window.__keptIframe=document.querySelector("#youtube-mount iframe")')
   await page.evaluate(f'window.__qa.stream.{method}()')
   await page.wait_for_function('!window.voxDiagnostics().refining')
   await ok(f'{method}: late failure retains all lines in the studio',await page.locator('.phrase-row').count()==8 and await page.evaluate('window.voxDiagnostics().page')=='studio')
   await ok(f'{method}: stopped work is not mislabeled as still analyzing',await page.locator('.tech-mini').filter(has_text='分析中').count()==0)
   await ok(f'{method}: failure is partial, not success or reset to home',await page.evaluate('window.voxDiagnostics().adaptive.state')=='partial')
   await ok(f'{method}: completed labels and player are retained',await page.locator('#phrase-0 .tech-mini').filter(has_text='分析中').count()==0 and await page.evaluate('window.__keptIframe===document.querySelector("#youtube-mount iframe")'))
   await page.locator('#play-toggle').click();await page.wait_for_function('window.voxDiagnostics().playback.playing')
   await ok(f'{method}: playback still works after failure',await page.evaluate('window.voxDiagnostics().playback.playing'))
   await page.close()
  page=await setup();await start(page);await enter(page)
  await page.locator('[data-action=stop-refining]').click();await page.wait_for_function('window.__qa.aborted')
  await ok('Stop refinement cancels network but preserves usable studio',await page.locator('.phrase-row').count()==8 and await page.evaluate('window.voxDiagnostics().adaptive.state')=='cancelled')
  await page.locator('#play-toggle').click();await page.wait_for_function('window.voxDiagnostics().playback.playing')
  await ok('cancelled labels no longer say analyzing',await page.locator('.tech-mini').filter(has_text='分析中').count()==0)
  await ok('Stop refinement does not stop or disable the player',await page.evaluate('window.voxDiagnostics().playback.playing'))
  await page.close()
  page=await setup();await start(page);await enter(page);await page.locator('[data-action=home]').last.click();await page.wait_for_function('window.voxDiagnostics().page==="home"')
  await ok('new-song navigation cancels optional old work without waiting',await page.evaluate('window.__qa.aborted===true'))
  await start(page,URLS[1]);await enter(page);await ok('second supplied QA link uses its own exact video ID',await page.evaluate('window.voxDiagnostics().source.id')=='4ULVNHHqbew')
  await page.evaluate('window.__qa.streams[0].update()');await page.wait_for_timeout(150)
  await ok('late old stream cannot replace new source or revision',await page.evaluate('window.voxDiagnostics().source.id==="4ULVNHHqbew"&&window.voxDiagnostics().adaptive.revision===1'))
  await page.close()
  # Responsive access to the progressive studio and intact CSS while offline.
  for width in [320,390,768,1024,1440]:
   page=await setup(width);await start(page);await enter(page)
   await ok(f'{width}px ready studio has no horizontal overflow',await page.evaluate('document.documentElement.scrollWidth<=innerWidth+2'))
   await ok(f'{width}px single top transport remains usable',await page.locator('.studio-chrome #play-toggle').is_visible() and not await page.locator('#play-toggle').is_disabled())
   await ok(f'{width}px all later lines stay visible',await page.locator('#phrase-7').count()==1)
   await update(page)
   await ok(f'{width}px progress patch does not overflow',await page.evaluate('document.documentElement.scrollWidth<=innerWidth+2'))
   if width==1440:
    await ok('desktop retains video beside lyrics',await page.evaluate('document.querySelector("#youtube-sidecar").getBoundingClientRect().left>=document.querySelector(".lyrics-panel").getBoundingClientRect().right-2'))
    await page.evaluate('window.scrollTo(0,0)');await page.screenshot(path=str(OUT/'desktop-refining.png'),full_page=True)
   if width==390:await page.screenshot(path=str(OUT/'mobile-refining.png'),full_page=True)
   await page.close()
  await ok('no uncaught app or media exceptions in all adaptive scenarios',not errors)
  await browser.close()
 (OUT/'report.json').write_text(json.dumps({'checks':checks,'total':len(checks),'errors':errors,'externalServices':'explicit test adapters, not live YouTube/Gemini'},ensure_ascii=False,indent=2))
 print('TOTAL',len(checks))
asyncio.run(main())
