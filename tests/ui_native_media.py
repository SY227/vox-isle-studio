"""v1.2.3 acceptance: actual local audio inside an iframe; AI/YouTube transport
adapters are test doubles. No fabricated advancing time and no live certification.
Uses in-memory page fulfillment because this runner blocks browser navigation.
"""
import asyncio, json, os, shutil, copy
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('VOX_QA_OUTPUT',ROOT/'test-results-native'));OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
URL='https://www.youtube.com/watch?v=4ULVNHHqbew&list=RD4ULVNHHqbew&start_radio=1'
demo=json.loads((ROOT/'public/demo.json').read_text())
def make_long():
 d=copy.deepcopy(demo);d['duration']=350;d['title']='全曲覆蓋測試 · 50 段';d['phrases']=[]
 text='微光陪我走過漫漫長夜'
 for pi in range(50):
  phrase={'start':pi*7,'end':pi*7+6.8,'section':'尾段' if pi==49 else '主歌','focus':'輕聲銜接','instruction':'可以輕輕唱。','pronunciation':'保持字音。','exercise':'慢唱一次。','caution':'不適停止。','tokens':[]}
  for ti,c in enumerate(text):
   phrase['tokens'].append({'text':c,'romanization':'','start':pi*7+ti*.65,'end':pi*7+ti*.65+.6,'notes':[60+ti],'technique':['chest','mix','head','falsetto'][pi%4],'ornaments':['run'] if ti==3 else [],'confidence':'medium','annotationStatus':'reviewed'})
  d['phrases'].append(phrase)
 return d
fixtures={'normal':demo,'long':make_long()}
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  async def ok(name,value):
   assert value,name;checks.append(name);print('PASS',name,flush=True)
  async def setup(width=1440,height=1000):
   page=await browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
   page.on('pageerror',lambda e:errors.append(str(e)))
   async def route(r):
    u=urlparse(r.request.url);headers={'Access-Control-Allow-Origin':'*'}
    if u.path=='/api/status':return await r.fulfill(status=200,headers=headers,json={'configured':True,'authenticated':True,'version':'1.2.3'})
    if u.path=='/qa-fixtures.json':return await r.fulfill(status=200,headers=headers,json=fixtures)
    f=ROOT/u.path[1:] if u.path.startswith('/shared/') else ROOT/'public'/u.path[1:]
    if not f.is_file():return await r.fulfill(status=404,headers=headers,body='not found')
    types={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav'}
    return await r.fulfill(status=200,headers=headers,content_type=types.get(f.suffix,'text/plain'),body=f.read_bytes())
   await page.route('http://localhost:3000/**',route)
   shim='<script>'+(ROOT/'tests/fixtures/browser-doubles.js').read_text()+'\n'+(ROOT/'tests/fixtures/native-media-double.js').read_text()+'</script>'
   html=(ROOT/'public/index.html').read_text().replace('<head>','<head><base href="http://localhost:3000/">'+shim)
   await page.set_content(html,wait_until='networkidle');await page.wait_for_timeout(150)
   return page
  async def song(page,fixture='normal'):
   await page.evaluate('(f)=>{window.__qa.fixture=f;window.__qa.finish=null;}',fixture)
   await page.locator('#song-url').fill(URL);await page.locator('#song-form button[type=submit]').click()
   await page.wait_for_function('typeof window.__qa.finish==="function"');await page.evaluate('window.__qa.finish()')
   await page.wait_for_function('window.voxDiagnostics().page==="studio"&&!window.voxDiagnostics().loading&&window.voxDiagnostics().playback.ready')
  async def native_toggle(page):
   # Trusted click on Chromium's native audio Play/Pause control, INSIDE iframe.
   audio=page.frame_locator('#youtube-mount iframe').locator('#native-audio')
   await audio.click(position={'x':20,'y':21})
  async def native_seek(page,time):
   await page.frame_locator('#youtube-mount iframe').locator('#native-seek').evaluate('(el,t)=>{el.value=t;el.dispatchEvent(new Event("input",{bubbles:true}));}',time)
   await page.wait_for_timeout(180)
  async def playing(page,expected=True):
   await page.wait_for_function('(v)=>window.voxDiagnostics().playback.playing===v',arg=expected)
  page=await setup();await song(page)
  await ok('exactly one app Play/Pause control; no old top duplicate',await page.locator('[data-action=play]').count()==1 and await page.locator('#top-play-toggle').count()==0)
  await ok('working transport lives above the song heading',await page.evaluate('document.querySelector("#player-dock").getBoundingClientRect().bottom <= document.querySelector(".song-top").getBoundingClientRect().top'))
  await ok('the former bottom bar is no longer fixed to the viewport bottom',await page.locator('#player-dock').evaluate('e=>getComputedStyle(e).position!=="fixed"&&e.parentElement.classList.contains("studio-chrome")'))
  await ok('no song cover or developer setup in focused studio',await page.locator('.song-top img,#player-dock img,[data-action=settings],#nav-practice,#nav-library').count()==0)
  await ok('all original demo lyric tokens are in the DOM',await page.locator('.token').count()==sum(len(x['tokens']) for x in demo['phrases']))
  await ok('each final-verse word already has a visible technique before playback',await page.locator('#phrase-7 .tech-mini').count()==len(demo['phrases'][7]['tokens']))
  colors=await page.locator('#phrase-7 .tech-mini').evaluate_all('els=>els.map(e=>getComputedStyle(e).color)')
  await native_toggle(page);await playing(page);await page.wait_for_timeout(2800)
  await ok('first-ever native iframe Play starts synchronization with no app Play click',await page.evaluate('window.voxDiagnostics().playback.playing&&window.voxDiagnostics().playback.time>2'))
  await ok('native Play updates the single top button to Pause',await page.locator('#play-toggle').get_attribute('aria-label')=='暫停')
  await page.wait_for_function('document.querySelectorAll(".token.current").length>0')
  await ok('real iframe audio clock illuminates a current lyric token',await page.locator('.token.current').count()>0)
  await page.wait_for_function('document.querySelectorAll(".token.played").length>0&&document.querySelectorAll(".token.upcoming").length>0',timeout=6000)
  await ok('real audio yields both played and upcoming lyric states',await page.locator('.token.played').count()>0 and await page.locator('.token.upcoming').count()>0)
  await native_toggle(page);await playing(page,False)
  t=await page.evaluate('window.voxDiagnostics().playback.time');await page.wait_for_timeout(400)
  await ok('native Pause freezes source time and updates top control',abs(await page.evaluate('window.voxDiagnostics().playback.time')-t)<.04 and await page.locator('#play-toggle').get_attribute('aria-label')=='播放')
  await native_seek(page,43.3)
  await ok('native seek while paused highlights the last verse',await page.locator('#phrase-7 .token.current').count()>0)
  await ok('late-song technique colors remain unchanged by playback progress',await page.locator('#phrase-7 .tech-mini').evaluate_all('els=>els.map(e=>getComputedStyle(e).color)')==colors)
  await ok('late-song notes and ornaments are retained',await page.locator('#phrase-7 .note').count()==len(demo['phrases'][7]['tokens']) and await page.locator('.has-run').count()>0)
  await native_seek(page,2.2)
  await ok('backward native seek restores upcoming state to later verses',await page.locator('#phrase-7 .token.upcoming').count()==len(demo['phrases'][7]['tokens']))
  await page.locator('#play-toggle').click();await playing(page);await page.wait_for_timeout(500)
  await ok('single top transport controls the same real iframe audio',await page.frame_locator('#youtube-mount iframe').locator('audio').evaluate('a=>!a.paused'))
  await page.locator('#play-toggle').click();await playing(page,False)
  await page.evaluate('window.__qa.dropStateEvents=true')
  await native_toggle(page);await playing(page)
  await ok('polling recovers a dropped native Play callback',await page.locator('#play-toggle').get_attribute('aria-label')=='暫停')
  await native_toggle(page);await playing(page,False)
  await ok('polling recovers a dropped native Pause callback',await page.locator('#play-toggle').get_attribute('aria-label')=='播放')
  await page.evaluate('window.__qa.dropStateEvents=false')
  await page.frame_locator('#youtube-mount iframe').locator('audio').evaluate('a=>a.playbackRate=2')
  await page.wait_for_timeout(150)
  await ok('native rate changes are reflected in the top speed selector',await page.locator('#rate-select').input_value()=='2')
  await page.locator('#rate-select').select_option('0.75');await page.wait_for_timeout(120)
  await ok('app speed selector changes the actual native audio playback rate',await page.frame_locator('#youtube-mount iframe').locator('audio').evaluate('a=>a.playbackRate===.75'))
  await native_seek(page,14.0)
  before=await page.locator('.token.current').get_attribute('data-token')
  count=await page.evaluate('window.__qa.nativeInstances.length')
  await page.locator('[data-filter=run]').click();await page.locator('[data-filter=all]').click()
  await ok('filter changes preserve current lyric highlighting while paused',await page.locator('.token.current').get_attribute('data-token')==before)
  await page.locator('[data-action=roman]').click();await page.locator('[data-action=roman]').click()
  await ok('changing filters/romanization never reconstructs the source iframe',await page.evaluate('window.__qa.nativeInstances.length')==count)
  await page.locator('#seek').evaluate('el=>{el.value=31.3;el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}')
  await page.wait_for_timeout(180)
  await ok('top seek bar drives actual source time and the correct phrase',abs(await page.frame_locator('#youtube-mount iframe').locator('audio').evaluate('a=>a.currentTime')-31.3)<.1 and await page.locator('#phrase-5 .token.current').count()>0)
  await page.locator('[data-action=offset-plus]').click();await page.locator('[data-action=offset-minus]').click()
  await ok('timing correction preserves original source position',abs(await page.frame_locator('#youtube-mount iframe').locator('audio').evaluate('a=>a.currentTime')-31.3)<.1)
  await page.locator('#loop-toggle').click();await page.locator('#play-toggle').click();await playing(page)
  await native_seek(page,40)
  await page.wait_for_function('window.voxDiagnostics().playback.time<36',timeout=3000)
  await ok('phrase loop reacts to actual source time',await page.evaluate('window.voxDiagnostics().playback.time<36'))
  await page.locator('#play-toggle').click();await playing(page,False);await page.locator('#loop-toggle').click()
  await native_seek(page,14.0);await page.evaluate('document.querySelector("#toast").className="";window.scrollTo(0,0)');await page.screenshot(path=str(OUT/'desktop-native-media.png'),full_page=False)
  await page.locator('[data-action=home]').first.click();await song(page,'long')
  await ok('long score renders all 50 phrases and all 500 annotated tokens',await page.locator('.phrase-row').count()==50 and await page.locator('.token').count()==500)
  await ok('final repeated chorus has explicit technique labels, not a first-section-only overlay',await page.locator('#phrase-49 .tech-mini').count()==10 and not await page.locator('#phrase-49 .tech-mini').filter(has_text='待確認').count())
  await ok('coverage counter matches the entire long score','500 / 500' in await page.locator('.tech-coverage').inner_text())
  await page.locator('#phrase-49').scroll_into_view_if_needed();await page.wait_for_timeout(120)
  await ok('single top transport remains visible at the end of a long song',await page.locator('#play-toggle').evaluate('e=>{let r=e.getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight}'))
  await ok('technique legend remains below top controls rather than scrolling away',await page.locator('.legend').evaluate('e=>{let r=e.getBoundingClientRect(),c=document.querySelector(".studio-chrome").getBoundingClientRect();return r.top>=c.bottom-2&&r.top<c.bottom+8}'))
  await ok('top transport does not cover the sticky technique legend',await page.evaluate('document.querySelector(".legend").getBoundingClientRect().top>=document.querySelector("#player-dock").getBoundingClientRect().bottom-1'))
  await page.locator('[data-filter=head]').click()
  await ok('filters operate on distant verses as well as the first verse',await page.locator('#phrase-2 .token.dim').count()==0 and await page.locator('#phrase-49 .token.dim').count()==10)
  await page.locator('[data-filter=all]').click()
  await ok('show-all restores full-song labels without clipping',await page.locator('.token.dim').count()==0 and await page.locator('.tech-mini').count()==500)
  for width in [320,390,768,1024]:
   q=await setup(width,900);await song(q)
   await ok(f'{width}px transport and studio have no horizontal overflow',await q.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   await ok(f'{width}px exactly one app Play control at top',await q.locator('[data-action=play]').count()==1 and await q.locator('.studio-chrome #play-toggle').is_visible())
   await ok(f'{width}px top seek and speed controls are usable',await q.locator('#seek').is_visible() and not await q.locator('#rate-select').is_disabled())
   await ok(f'{width}px no clipped or hidden final-verse lyric tokens',await q.locator('#phrase-7 .token').count()==len(demo['phrases'][7]['tokens']))
   if width==390:
    await q.evaluate('document.querySelector("#toast").className=""')
    await q.screenshot(path=str(OUT/'mobile-top-transport.png'),full_page=False)
   await q.close()
  await ok('no uncaught application or iframe exceptions in native-media scenarios',not errors)
  await browser.close()
 OUT.joinpath('native-media-report.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'pageErrors':errors,'scope':'Native HTML audio inside an iframe; actual playback clocks; AI and official YouTube API transport are controlled test adapters. Not live YouTube or Google.'},ensure_ascii=False,indent=2))
 print('TOTAL',len(checks))
asyncio.run(main())
