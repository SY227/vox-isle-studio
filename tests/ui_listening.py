"""Audio-first UI integration. Synthetic model responses through real backend
assembly (fixtures/build-listening-cases.mjs), real HTMLAudioElement playback.
No live provider, singing, YouTube stream, or acoustic accuracy certification.
"""
import asyncio, json, os, shutil
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('VOX_QA_OUTPUT',ROOT/'test-results-listening'));OUT.mkdir(parents=True,exist_ok=True)
cases=json.loads((ROOT/'tests/fixtures/listening-cases.json').read_text())
checks=[];errors=[]
URL='https://www.youtube.com/watch?v=YaJ_lYFgr6c&list=RDeV9a5oUCbZQ&index=2'
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
    if u.path=='/qa-fixtures.json':return await r.fulfill(status=200,headers=headers,json=cases)
    f=ROOT/u.path[1:] if u.path.startswith('/shared/') else ROOT/'public'/u.path[1:]
    if not f.is_file():return await r.fulfill(status=404,headers=headers,body='not found')
    types={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav'}
    return await r.fulfill(status=200,headers=headers,content_type=types.get(f.suffix,'text/plain'),body=f.read_bytes())
   await page.route('http://localhost:3000/**',route)
   shim='<script>'+(ROOT/'tests/fixtures/browser-doubles.js').read_text()+'\n'+(ROOT/'tests/fixtures/native-media-double.js').read_text()+'</script>'
   html=(ROOT/'public/index.html').read_text().replace('<head>','<head><base href="http://localhost:3000/">'+shim)
   await page.set_content(html,wait_until='networkidle');return page
  async def begin(page,fixture):
   await page.evaluate('(f)=>{window.__qa.fixture=f;window.__qa.finish=null;}',fixture)
   await page.locator('#song-url').fill(URL);await page.locator('#song-form button[type=submit]').click()
   await page.wait_for_function('typeof window.__qa.finish==="function"&&window.voxDiagnostics().phase==="analyzing"')
  async def finish(page):
   await page.evaluate('window.__qa.finish()');await page.wait_for_function('window.voxDiagnostics().page==="studio"&&!window.voxDiagnostics().loading&&window.voxDiagnostics().playback.ready')
  async def seek(page,t):
   await page.frame_locator('#youtube-mount iframe').locator('audio').evaluate('(a,t)=>a.currentTime=t',t)
   await page.wait_for_function('(t)=>Math.abs(window.voxDiagnostics().lyricTime-t)<.12',arg=t)
  page=await setup()
  await ok('no external lyric sheet field or upload step in the first-tab workflow',await page.locator('#lyrics-input,[data-action=advanced]').count()==0)
  await ok('home clearly states that source audio generates lyrics and timing','不需要準備歌詞' in await page.locator('body').inner_text())
  await ok('home shows no album cover or API/model setup',await page.locator('img,[data-action=settings]').count()==0 and 'Gemini' not in await page.locator('body').inner_text())
  await page.screenshot(path=str(OUT/'recording-first-home.png'),full_page=True)
  await begin(page,'normal')
  await ok('request contains the intended single video, not radio-playlist source',await page.evaluate('window.__qa.requests.at(-1).url')=='https://www.youtube.com/watch?v=YaJ_lYFgr6c')
  await ok('no lyric sheet or rights assertion is sent by the user form',await page.evaluate('!("lyrics" in window.__qa.requests.at(-1))&&!("rights" in window.__qa.requests.at(-1))'))
  event=next(e for e in cases['phases'] if e.get('detail',{}).get('completedWindows')==1)
  await page.evaluate('(e)=>window.__qa.sendPhase(e)',event)
  await ok('real window-completion events drive the visible count','1 / 3 段' in await page.locator('#loading-count').inner_text())
  count=await page.locator('#analysis-progress').get_attribute('aria-valuenow')
  await page.wait_for_timeout(400)
  await ok('analysis bar never fabricates additional work completion on a timer',await page.locator('#analysis-progress').get_attribute('aria-valuenow')==count)
  text=await page.locator('body').inner_text()
  await ok('normal analysis view does not reveal internal retry chatter',not any(x in text for x in ['Retry 1','重試次數','重新連線 1']))
  await page.screenshot(path=str(OUT/'recording-first-loading.png'),full_page=True)
  await finish(page)
  await ok('assembled full-pipeline result retains every original sample word',await page.locator('.token').count()==cases['normal']['teachingCoverage']['total'])
  await ok('last line retains timing and teaching, not only the first window',await page.locator('#phrase-7 .token').count()>0 and '待確認' not in await page.locator('#phrase-7 .tech-mini').all_text_contents())
  await ok('timestamp origin is identified as source-listening estimate','原聲逐段聆聽 · AI 估計' in await page.locator('body').inner_text())
  await ok('UI does not falsely label AI word timestamps as verified alignment','字已對齊' not in await page.locator('body').inner_text())
  await ok('top transport remains the only app Play control',await page.locator('[data-action=play]').count()==1 and await page.locator('.studio-chrome #play-toggle').count()==1)
  await seek(page,13.7)
  await ok('source time illuminates the correct synthetic line after full pipeline assembly',await page.locator('#phrase-2 .token.current').count()>0)
  await page.frame_locator('#youtube-mount iframe').locator('audio').click(position={'x':20,'y':21})
  await page.wait_for_function('window.voxDiagnostics().playback.playing')
  await ok('native media Play works before any top Play click in the new result',await page.locator('#play-toggle').get_attribute('aria-label')=='暫停')
  await page.locator('#play-toggle').click();await page.wait_for_function('!window.voxDiagnostics().playback.playing')
  await ok('top transport pauses the same real local audio clock',await page.frame_locator('#youtube-mount iframe').locator('audio').evaluate('a=>a.paused'))
  await page.locator('[data-action=home]').first.click();await begin(page,'line');await finish(page)
  await seek(page,3)
  await ok('uncertain word boundaries retain full first-line text',await page.locator('#phrase-0 .han').all_text_contents()==list('把微光放在手心'))
  await ok('line-only timing activates the line without fake moving word highlight',await page.locator('#phrase-0.active').count()==1 and await page.locator('#phrase-0 .token.current').count()==0)
  await ok('line-only words clearly disclose their synchronization mode','樂句同步' in await page.locator('#phrase-0').inner_text())
  await ok('uncertain word timing still has full technique labels',await page.locator('#phrase-0 .tech-mini').count()==7)
  await seek(page,8)
  await ok('unknown words change to played only when the known line is finished',await page.locator('#phrase-0 .token.played').count()==7 and await page.locator('#phrase-1 .token.current').count()>0)
  await seek(page,3)
  await ok('backward seek clears played state in a line-only phrase',await page.locator('#phrase-0 .token.played').count()==0)
  await ok('diagnostics separately count actual timed words and AI-review metadata',await page.evaluate('window.voxDiagnostics().listening.lineOnly===7&&window.voxDiagnostics().listening.accuracyVerified===false&&window.voxDiagnostics().timedTokens===57'))
  await page.evaluate('window.scrollTo(0,0);document.querySelector("#toast").className=""')
  await page.screenshot(path=str(OUT/'recording-first-studio.png'),full_page=False)
  for width in [320,390,768]:
   q=await setup(width);await begin(q,'line');await finish(q);await seek(q,3)
   await ok(f'{width}px line-sync disclosure and full score have no horizontal overflow',await q.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   await ok(f'{width}px no line-only words disappear',await q.locator('.token').count()==64)
   await q.close()
  await ok('no uncaught browser errors on new listening pipeline scenarios',not errors)
  (OUT/'listening-ui-report.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'externalServices':'synthetic','audioClock':'real local HTMLAudioElement','acousticAccuracy':'not measured'},ensure_ascii=False,indent=2))
  await browser.close();print('TOTAL',len(checks))
if __name__=='__main__':asyncio.run(main())
