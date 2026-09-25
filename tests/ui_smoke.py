"""Visual/DOM regression checks. This environment uses in-memory file fulfillment
because Chromium policy prohibits navigation. It does not test actual Google,
YouTube playback, microphone capture, persistent-origin storage, or WebGL2.
"""
import asyncio,json,os,shutil
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('VOX_QA_OUTPUT',ROOT/'test-results'));OUT.mkdir(parents=True,exist_ok=True);checks=[];errors=[]
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  async def setup(width,height,mobile=False):
   page=await browser.new_page(viewport={'width':width,'height':height},is_mobile=mobile,has_touch=mobile)
   page.on('pageerror',lambda e:errors.append(str(e)))
   async def route(r):
    u=urlparse(r.request.url);headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,GET,OPTIONS'}
    if r.request.method=='OPTIONS':return await r.fulfill(status=204,headers=headers)
    if u.path=='/api/status':return await r.fulfill(status=200,headers=headers,json={'configured':False,'model':'gemini-3.8-flash','authenticated':True})
    if u.path.startswith('/api/'):return await r.fulfill(status=503,headers=headers,json={'error':'尚未設定 API Key。','code':'NO_API_KEY'})
    f=ROOT/u.path[1:] if u.path.startswith('/shared/') else ROOT/'public'/u.path[1:]
    if not f.is_file():return await r.fulfill(status=404,headers=headers,body='not found')
    types={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav'}
    await r.fulfill(status=200,headers=headers,content_type=types.get(f.suffix,'text/plain'),body=f.read_bytes())
   await page.route('http://localhost:3000/**',route)
   shim='<script>const store=new Map();Object.defineProperty(window,"localStorage",{value:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});</script>'
   html=(ROOT/'public/index.html').read_text().replace('<head>','<head><base href="http://localhost:3000/">'+shim)
   await page.set_content(html,wait_until='networkidle');await page.wait_for_timeout(150)
   return page
  async def ok(name,value):
   assert value,name;checks.append(name);print('PASS',name)
  page=await setup(1440,1040)
  await ok('default language is Traditional Chinese',await page.locator('html').get_attribute('lang')=='zh-Hant')
  await ok('production CSS is actually applied',await page.evaluate("getComputedStyle(document.body).backgroundColor==='rgb(246, 249, 246)' && getComputedStyle(document.querySelector('.hero h1')).fontSize!=='32px'"))
  await ok('layout skin is embedded and needs no external stylesheet request',await page.locator('#vox-production-style').count()==1 and await page.evaluate("[...document.styleSheets].every(s=>s.href===null)"))
  await ok('home has actionable YouTube field',await page.locator('#song-url').is_visible())
  await ok('home UI does not expose provider model branding','Gemini' not in await page.locator('body').inner_text() and '3.8' not in await page.locator('body').inner_text())
  await page.screenshot(path=str(OUT/'desktop-home.png'),full_page=True)
  await ok('only the first top-level tab is displayed',await page.locator('.nav button').count()==1 and await page.locator('#nav-studio').is_visible())
  await ok('practice and library tabs are hidden from user navigation',await page.locator('#nav-practice').count()==0 and await page.locator('#nav-library').count()==0)
  await page.locator('[data-action=demo]').click();await page.wait_for_timeout(300)
  await ok('demo loads original lyrics and 8 phrases',await page.locator('.phrase-row').count()==8)
  await ok('more than 50 interactive lyric tokens',await page.locator('[data-token]').count()>50)
  await ok('demo is not presented as a live AI result','原創教學示範' in await page.locator('#main').inner_text())
  await page.screenshot(path=str(OUT/'desktop-studio.png'),full_page=True)
  await page.locator('#play-toggle').click();await page.wait_for_timeout(2400)
  await ok('bundled WAV playback advances the real media clock',await page.locator('#elapsed').inner_text()!='0:00')
  await ok('bundled playback highlights a timed lyric token',await page.locator('.token.current').count()>0)
  await page.locator('#play-toggle').click()
  await page.locator('[data-token="0:2"]').click()
  await ok('word selection still works without companion panel',await page.locator('[data-token="0:2"]').evaluate("e=>e.classList.contains('selected')") and await page.locator('.coach-panel').count()==0)
  await page.locator('[data-action=roman]').click();await ok('romanization visibility toggles',await page.locator('#lyrics-scroll').evaluate("x=>x.classList.contains('no-roman')"))
  await page.locator('[data-action=roman]').click()
  await page.locator('[data-filter=run]').click();await ok('run filter selects',await page.locator('[data-filter=run]').evaluate("x=>x.classList.contains('active')"))
  await page.locator('[data-filter=all]').click()
  await page.locator('#loop-toggle').click();await ok('loop turns on',await page.locator('#loop-toggle').get_attribute('aria-pressed')=='true');await page.locator('#loop-toggle').click()
  await page.locator('[data-action=transpose-up]').click();await ok('guide-only transpose changes to +1',await page.locator('#transpose-value').inner_text()=='+1')
  await page.locator('#rate-select').select_option('0.75');await ok('playback speed retains selection',await page.locator('#rate-select').input_value()=='0.75')
  await page.locator('[data-action=edit]').click();await page.locator('[data-edit-notes="0"]').fill('C#4')
  await page.locator('#edit-form button[type=submit]').click();await ok('manual edit has explicit provenance','已手動校正' in await page.locator('#main').inner_text())
  await ok('manual note edit updates lyric display','C♯4' in await page.locator('[data-token="0:0"]').inner_text())
  await ok('library save entry point is not displayed in the focused studio',await page.locator('[data-action=save]').count()==0)
  await page.locator('[data-action=export]').click();await ok('export presents JSON and LRC actions',await page.locator('[data-action=export-json]').is_visible() and await page.locator('[data-action=export-lrc]').is_visible());await page.keyboard.press('Escape')
  await ok('Escape dismisses modal',await page.locator('.modal').count()==0)
  await ok('phrase practice entry point is not displayed in the focused studio',await page.locator('[data-action=practice]').count()==0)
  await ok('developer setup controls are completely absent from user UI',await page.locator('[data-action=settings]').count()==0 and 'npm run setup' not in await page.locator('body').inner_text())
  await ok('studio song cover art is removed',await page.locator('.song-top img').count()==0)
  for width,height in [(390,844),(768,1024)]:
   mobile=await setup(width,height,True)
   await ok(f'{width}px home has no horizontal overflow',await mobile.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   await mobile.screenshot(path=str(OUT/f'mobile-home-{width}.png'),full_page=True)
   await mobile.locator('[data-action=demo]').click();await mobile.wait_for_timeout(200)
   await ok(f'{width}px studio has no horizontal overflow',await mobile.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   await mobile.screenshot(path=str(OUT/f'mobile-studio-{width}.png'),full_page=True)
   await ok(f'{width}px shows only the focused studio tab',await mobile.locator('.nav button').count()==1)
   await mobile.close()
  await ok('no uncaught JavaScript exceptions in tested flows',not errors)
  await browser.close()
 OUT.joinpath('ui-report.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'pageErrors':errors,'mode':'in-memory DOM/render tests, API readiness mocked, localStorage test double; no real Google, YouTube, mic or WebGL'},ensure_ascii=False,indent=2))
 print('TOTAL',len(checks))
asyncio.run(main())
