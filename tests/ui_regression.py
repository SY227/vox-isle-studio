"""In-memory browser interaction regressions; explicit AI/YouTube test doubles.
Production network integration is intentionally NOT claimed by this suite.
Run scripts/verify-live.mjs on a network-enabled machine for the real supplied URL.
"""
import asyncio,json,os,shutil
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('VOX_QA_OUTPUT',ROOT/'test-results-v109'));OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
URL='https://www.youtube.com/watch?v=4ULVNHHqbew&list=RD4ULVNHHqbew&start_radio=1'
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  async def setup(width=1440,height=1000):
   page=await browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
   page.on('pageerror',lambda e:errors.append(str(e)))
   async def route(r):
    u=urlparse(r.request.url);headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,GET,OPTIONS'}
    if r.request.method=='OPTIONS':return await r.fulfill(status=204,headers=headers)
    if u.path=='/api/status':return await r.fulfill(status=200,headers=headers,json={'configured':True,'authenticated':True,'version':'1.2.1'})
    if u.path=='/qa-fixtures.json':return await r.fulfill(status=200,headers=headers,content_type='application/json',body=(ROOT/'tests/fixtures/recovery-cases.json').read_bytes())
    f=ROOT/u.path[1:] if u.path.startswith('/shared/') else ROOT/'public'/u.path[1:]
    if not f.is_file():return await r.fulfill(status=404,headers=headers,body='not found')
    types={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav'}
    await r.fulfill(status=200,headers=headers,content_type=types.get(f.suffix,'text/plain'),body=f.read_bytes())
   await page.route('http://localhost:3000/**',route)
   await page.route('https://www.youtube.com/embed/**',lambda r:r.fulfill(status=200,content_type='text/html',body='<body style="font:16px system-ui;background:#eff7f3;color:#326059;padding:28px">QA 模擬影片介面<br><small>這不是 YouTube 實際播放</small></body>'))
   shim='<script>'+(ROOT/'tests/fixtures/browser-doubles.js').read_text()+'</script>'
   html=(ROOT/'public/index.html').read_text().replace('<head>','<head><base href="http://localhost:3000/">'+shim)
   await page.set_content(html,wait_until='networkidle');await page.wait_for_timeout(150)
   return page
  async def ok(name,value):
   assert value,name;checks.append(name);print('PASS',name,flush=True)
  async def begin(page,fixture='normal'):
   await page.evaluate('(f)=>{window.__qa.fixture=f;window.__qa.failAnalysis=false}',fixture)
   await page.locator('#song-url').fill(URL);await page.locator('#song-form button[type=submit]').click()
   await page.wait_for_function('window.voxDiagnostics().loading&&window.voxDiagnostics().phase==="analyzing"')
  async def finish(page):
   await page.evaluate('window.__qa.finish()');await page.wait_for_function('window.voxDiagnostics().page==="studio"&&!window.voxDiagnostics().loading')
  async def ready(page):await page.wait_for_function('window.voxDiagnostics().playback.ready')
  page=await setup()
  await ok('song rights checkbox absent',await page.locator('#rights-input').count()==0)
  await ok('passive processing notice visible',await page.locator('.source-disclosure').is_visible())
  await ok('build identifier is exact and no model branding is visible',(await page.evaluate('window.voxDiagnostics().build'))=='1.2.1' and 'Gemini' not in await page.locator('body').inner_text())
  await begin(page,'partial')
  await ok('loading bar is visible with accessible workflow semantics',await page.locator('#analysis-progress').get_attribute('aria-valuemax')=='4')
  await ok('no fabricated inference completion percentage',await page.locator('#analysis-progress').get_attribute('aria-valuenow')=='1')
  await page.wait_for_timeout(1200)
  await ok('elapsed time visibly advances during provider wait',await page.locator('#loading-elapsed').inner_text()!='已經過 0:00')
  await ok('progress never creeps to completion while waiting',await page.locator('#analysis-progress').get_attribute('aria-valuenow')=='1')
  await page.screenshot(path=str(OUT/'loading-stage.png'),full_page=True)
  await ok('exact user link canonicalized without radio playlist',await page.evaluate('window.__qa.requests[0].url')=='https://www.youtube.com/watch?v=4ULVNHHqbew')
  await ok('no fabricated rights confirmation sent',not await page.evaluate('"rights" in window.__qa.requests[0]'))
  await finish(page)
  await ok('partial recovered score opens rather than generic validation error',await page.locator('.phrase-row').count()==8)
  await ok('uncertain values disclosed in expandable quality panel',await page.locator('.quality-notice.needs-review').count()==1)
  await page.locator('.quality-notice summary').click()
  await ok('untimed lyric retained in the full transcript',await page.locator('.lyrics-unaligned').is_visible())
  await ok('invalid pitch displayed unknown instead of clamped fake note','—' in await page.locator('[data-token="0:0"]').inner_text())
  await ready(page)
  await ok('selected lyric remains visibly marked before playback',await page.locator('.token.selected').evaluate('e=>getComputedStyle(e).backgroundColor!=="rgba(0, 0, 0, 0)"'))
  await ok('technique annotations remain legible under playback-state styling',await page.locator('.t-mix .tech-mini').first.evaluate('e=>parseFloat(getComputedStyle(e).opacity)>=.7'))
  await ok('YouTube iframe is visible at player construction',await page.evaluate('window.__qa.instances[0].visibleAtConstruction'))
  layout=await page.evaluate('''()=>{const l=document.querySelector('.lyrics-panel').getBoundingClientRect(),v=document.querySelector('#youtube-sidecar').getBoundingClientRect(),s=document.querySelector('#lyrics-scroll');const cs=getComputedStyle(s);return {lyricsLeft:l.left,lyricsRight:l.right,videoLeft:v.left,videoTop:v.top,lyricsTop:l.top,overflowY:cs.overflowY,maxHeight:cs.maxHeight,scrollHeight:s.scrollHeight,clientHeight:s.clientHeight}}''')
  await ok('full transcript uses normal page flow rather than an internal lyric scroller',layout['overflowY'] not in ('auto','scroll') and layout['maxHeight']=='none')
  await ok('YouTube source is docked to the right of the lyrics on desktop',layout['videoLeft']>=layout['lyricsRight']-3 and abs(layout['videoTop']-layout['lyricsTop'])<90)
  await ok('native player is large enough for its controls',await page.locator('#youtube-mount iframe').evaluate('e=>e.clientWidth>=200&&e.clientHeight>=200'))
  await ok('play is enabled after the ready event',not await page.locator('#play-toggle').is_disabled())
  await ok('the one working transport is at the top and enabled',await page.locator('.studio-chrome #play-toggle').is_visible() and not await page.locator('#play-toggle').is_disabled() and await page.locator('#top-play-toggle').count()==0)
  await ok('bottom player has no external thumbnail that can break',await page.locator('.player-track img').count()==0)
  await page.locator('#play-toggle').click();await page.wait_for_timeout(3400)
  await ok('simulated external player drives transport state and time',await page.evaluate('window.voxDiagnostics().playback.playing&&window.voxDiagnostics().playback.time>2'))
  await page.wait_for_function('document.querySelectorAll(".token.current").length>0')
  await ok('simulated external time highlights lyrics',await page.locator('.token.current').count()>0)
  await ok('actual player time colors already-played lyrics separately',await page.locator('.token.played').count()>0)
  await ok('future lyrics remain a distinct unplayed state',await page.locator('.token.upcoming').count()>0)
  await ok('top transport time follows the same external media clock',await page.locator('#elapsed').inner_text()!='0:00')
  await page.locator('#play-toggle').click()
  await ok('pause updates the sole transport label',await page.locator('#play-toggle').get_attribute('aria-label')=='播放' and await page.locator('#play-toggle').get_attribute('aria-label')=='播放')
  await page.screenshot(path=str(OUT/'source-and-score-simulated.png'),full_page=True)
  await page.evaluate('window.__qa.behavior="blocked"');await page.locator('#play-toggle').click()
  await ok('autoplay denial gives native-player action, not fake playing',await page.evaluate('window.voxDiagnostics().playback.status==="needs-gesture"&&!window.voxDiagnostics().playback.playing'))
  await ok('native failure offers a clean reconnect action',await page.locator('#play-toggle').get_attribute('aria-label') in ('重新連線','播放'))
  await page.locator('#play-toggle').click()
  await ok('native action reveals the actual iframe',await page.locator('#youtube-mount iframe').is_visible())
  await page.evaluate('window.__qa.instances.at(-1).error(153)')
  await ok('153 error is presented without developer jargon','原片' in await page.locator('#media-message').inner_text())
  await ok('failed synchronization disables timeline scrubbing',await page.locator('#seek').is_disabled())
  await page.evaluate('window.__qa.behavior="normal"');await page.locator('#youtube-sidecar [data-action=retry-player]').click();await ready(page)
  await ok('retry rebuilds player and restores controls',await page.locator('#play-toggle').get_attribute('aria-label')=='播放')
  await ok('source panel remains visible beside the full transcript while practicing',await page.locator('#youtube-sidecar').is_visible() and await page.locator('#youtube-mount iframe').is_visible())
  # On a short score, the media itself can continue beyond the analysis horizon.
  await page.evaluate('window.__qa.instances.at(-1).position=300')
  await page.locator('#play-toggle').click();await page.wait_for_timeout(200)
  await ok('media is not truncated to the AI-estimated analysis duration',await page.evaluate('window.voxDiagnostics().playback.playing'))
  await page.locator('#play-toggle').click()
  await page.locator('[data-action=home]').first.click()
  await ok('home navigation pauses media and parks the player outside the studio',await page.locator('#youtube-sidecar').count()==0 and await page.locator('#youtube-parking #youtube-mount').count()==1 and not await page.evaluate('window.voxDiagnostics().playback.playing'))
  await begin(page);await page.locator('[data-action=cancel]').click();await page.wait_for_timeout(150)
  await ok('cancel returns home with pasted URL preserved',await page.locator('#song-url').input_value()==URL)
  await page.evaluate('window.__qa.finish()');await page.wait_for_timeout(300)
  await ok('late cancelled response cannot overwrite the screen',await page.evaluate('window.voxDiagnostics().page==="home"'))
  await begin(page);await page.evaluate('window.__qa.failAnalysis=true;window.__qa.finish()');await page.wait_for_function('!window.voxDiagnostics().loading')
  await ok('provider failure is shown without fabricated demo success','配額' in await page.locator('.error-banner').inner_text())
  await begin(page,'untimed');await finish(page);await ready(page)
  await ok('all-untimed response stays readable with usable media',await page.locator('.lyrics-unaligned').is_visible() and not await page.locator('#play-toggle').is_disabled())
  await ok('no invented melody map for untimed response','音高仍待確認' in await page.locator('#pitch-map').inner_text())
  await page.locator('[data-action=edit]').click()
  await ok('editing unavailable timing fails safely without an exception',await page.locator('.modal').count()==0)
  await ok('secondary practice/library tabs remain hidden while their code stays packaged',await page.locator('#nav-practice').count()==0 and await page.locator('#nav-library').count()==0 and await page.locator('[data-action=practice]').count()==0)
  await page.locator('[data-action=home]').first.click();await begin(page);await finish(page);await ready(page)
  # Attach local audio to the SAME score; no new API request is allowed.
  request_count=await page.evaluate('window.__qa.requests.length')
  await page.locator('#source-audio').set_input_files(str(ROOT/'public/audio/demo.wav'));await page.wait_for_function('window.voxDiagnostics().source.kind==="upload"&&window.voxDiagnostics().playback.ready')
  await ok('attach local audio retains score without rerunning AI',await page.locator('.phrase-row').count()==8 and await page.evaluate('window.__qa.requests.length')==request_count)
  await page.locator('#play-toggle').click();await page.wait_for_timeout(2200)
  await ok('attached local WAV genuinely advances browser media clock',await page.evaluate('window.voxDiagnostics().playback.time>2'))
  await page.locator('#play-toggle').click()
  await ok('focused studio hides library save entry point',await page.locator('[data-action=save]').count()==0)
  for _ in range(6):
   await page.locator('[data-action=roman]').click();await page.locator('[data-filter=run]').click();await page.locator('[data-filter=all]').click();await page.locator('[data-token="0:2"]').click()
  await ok('24 rapid lyric/notation interactions leave the page responsive',await page.locator('#coach-detail').is_visible())
  for width in (320,390,768):
   mobile=await setup(width,844 if width<700 else 1024);await begin(mobile)
   await ok(f'{width}px loading bar and cancel remain within viewport',await mobile.evaluate('document.documentElement.scrollWidth<=innerWidth') and await mobile.locator('[data-action=cancel]').is_visible())
   if width==390:await mobile.screenshot(path=str(OUT/'loading-mobile-390.png'),full_page=True)
   await finish(mobile);await ready(mobile)
   if not await mobile.evaluate('document.documentElement.scrollWidth<=innerWidth'):
    print('OVERFLOW',width,await mobile.evaluate('''[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cl:e.className,id:e.id,l:e.getBoundingClientRect().left,r:e.getBoundingClientRect().right,w:e.getBoundingClientRect().width})).filter(e=>e.r>innerWidth+1||e.l<0).slice(0,30)'''),flush=True)
    await mobile.screenshot(path=str(OUT/f'overflow-{width}.png'),full_page=True)
   await ok(f'{width}px source+score no horizontal overflow',await mobile.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   await ok(f'{width}px iframe retains >=200px viewport',await mobile.locator('#youtube-mount iframe').evaluate('e=>e.clientWidth>=200&&e.clientHeight>=200'))
   await mobile.screenshot(path=str(OUT/f'source-mobile-{width}-simulated.png'),full_page=True);await mobile.close()
  await ok('no uncaught JS exceptions across all regression scenarios',not errors)
  await browser.close()
 OUT.joinpath('ui-regression-report.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'pageErrors':errors,'scope':'In-memory rendering; synthetic AI/YouTube API adapters. Local WAV playback is real; live Google/YouTube is NOT verified.','videoUrlUnderTest':URL},ensure_ascii=False,indent=2))
 print('TOTAL',len(checks))
asyncio.run(main())
