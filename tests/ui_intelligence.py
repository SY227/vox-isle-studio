"""Real loopback HTTP and streamed production UI; mock AI + local-audio-backed
YouTube controller. Does NOT certify external YouTube or musical accuracy."""
import asyncio,json,os,shutil,subprocess,base64,aiohttp
from urllib.parse import urlparse
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('VOX_QA_OUTPUT',ROOT/'test-results/ui-intelligence'));OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
async def main():
 server=subprocess.Popen(['node',str(ROOT/'tests/fixtures/intelligence-server.mjs')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 origin=server.stdout.readline().strip()
 session=aiohttp.ClientSession();streams={};streamid=0
 async def ok(name,condition):
  checks.append({'name':name,'passed':bool(condition)});print(('PASS ' if condition else 'FAIL ')+name,flush=True)
  assert condition,name
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
   async def setup(width=1440):
    page=await browser.new_page(viewport={'width':width,'height':1000 if width>600 else 844},reduced_motion='reduce')
    page.on('pageerror',lambda e:errors.append(str(e)))
    native=(ROOT/'tests/fixtures/native-media-double.js').read_text().replace('http://localhost:3000',origin)
    async def open_stream(body):
     nonlocal streamid
     response=await session.post(origin+'/api/analyze',data=body,headers={'Content-Type':'application/json','Origin':origin});streamid+=1;streams[str(streamid)]=response
     return {'id':str(streamid),'status':response.status}
    async def read_stream(id):
     response=streams.get(id)
     if response is None:return None
     data=await response.content.read(16384)
     if not data:response.release();streams.pop(id,None);return None
     return base64.b64encode(data).decode()
    async def close_stream(id):
     response=streams.pop(id,None)
     if response is not None:response.close()
    await page.expose_function('qaOpenStream',open_stream);await page.expose_function('qaReadStream',read_stream);await page.expose_function('qaCloseStream',close_stream)
    async def route(r):
     u=urlparse(r.request.url);headers={'Access-Control-Allow-Origin':'*'}
     if u.path=='/api/status':return await r.fulfill(json={'configured':True,'authenticated':True,'version':'1.3.0'},headers=headers)
     f=ROOT/u.path[1:] if u.path.startswith('/shared/') else ROOT/'public'/u.path[1:]
     if not f.is_file():return await r.fulfill(status=404,headers=headers)
     types={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav'}
     return await r.fulfill(body=f.read_bytes(),content_type=types.get(f.suffix,'text/plain'),headers=headers)
    await page.route(origin+'/**',route);await page.route('https://www.youtube.com/**',lambda r:r.abort())
    bridge='''window.__qa={};const nativeFetch=window.fetch.bind(window);window.fetch=async(url,opts={})=>{
      if(!String(url).includes('/api/analyze'))return nativeFetch(url,opts);
      const job=await window.qaOpenStream(opts.body);let stopped=false;
      opts.signal?.addEventListener('abort',()=>{stopped=true;window.qaCloseStream(job.id);},{once:true});
      return new Response(new ReadableStream({async pull(c){if(stopped){c.error(new DOMException('Cancelled','AbortError'));return;}const b=await window.qaReadStream(job.id);if(b===null){c.close();return;}c.enqueue(Uint8Array.from(atob(b),x=>x.charCodeAt(0)));},cancel(){return window.qaCloseStream(job.id);}}),{status:job.status,headers:{'Content-Type':'application/x-ndjson'}});
    };'''
    html=(ROOT/'public/index.html').read_text().replace('<head>','<head><base href="'+origin+'/"><script>'+bridge+native+'</script>')
    await page.set_content(html,wait_until='networkidle');await page.wait_for_selector('#song-url')
    return page
   page=await setup()
   await page.locator('#song-url').fill('https://www.youtube.com/watch?v=62VyD_SVS40&list=RD62VyD_SVS40&start_radio=1')
   await page.locator('#song-form button[type=submit]').click()
   await page.wait_for_selector('.studio')
   await ok('real HTTP stream opens studio while new optional tasks remain',await page.evaluate('window.voxDiagnostics().refining'))
   await ok('new score defaults to original listening mode',await page.locator('[data-action=view-original]').get_attribute('aria-pressed')=='true')
   await ok('pending observation is not borrowed from practice',await page.locator('[data-token="0:0"]').get_attribute('data-technique')=='unknown')
   await page.wait_for_function('window.voxDiagnostics().playback.ready')
   await page.evaluate('window.__originalFrame=document.querySelector("#youtube-mount iframe")')
   frame=page.frame_locator('#youtube-mount iframe')
   await frame.locator('audio').click(position={'x':20,'y':20})
   await page.wait_for_function('window.voxDiagnostics().playback.playing')
   await page.wait_for_timeout(2000)
   await ok('native local audio play drives actual media clock',await page.evaluate('window.voxDiagnostics().playback.time>1'))
   await page.wait_for_function('!window.voxDiagnostics().refining',timeout=25000)
   await ok('new key and voice work preserves same iframe',await page.evaluate('window.__originalFrame===document.querySelector("#youtube-mount iframe")'))
   await ok('original observation differs from recommendation by design',await page.locator('[data-token="0:0"]').get_attribute('data-technique')=='chest')
   await ok('final header updates word timing count',not ('0 字有時間估計' in await page.locator('.lyrics-panel .caption').inner_text()))
   await ok('pitch map key label updates with resolved consensus','聽辨中' not in await page.locator('#score-key-label').inner_text())
   await ok('independent original evidence visible as tooltip','原創測試' in (await page.locator('[data-token="0:0"]').get_attribute('title')))
   await ok('phrase observation summary is rendered',await page.locator('.phrase-observation').count()==8)
   await ok('all original score words still rendered',await page.locator('.token').count()>50)
   await ok('key is a multi-window result',await page.evaluate('window.voxDiagnostics().tonality.received>=3'))
   await page.locator('#key-analysis summary').click()
   await ok('key evidence windows can be inspected',await page.locator('.key-window-list>div').count()>=3)
   await page.locator('#key-analysis summary').click()
   await page.locator('#play-toggle').click();await page.wait_for_function('!window.voxDiagnostics().playback.playing')
   await page.locator('[data-action=view-practice]').click()
   await ok('practice view shows recommended mix, not original chest',await page.locator('[data-token="0:0"]').get_attribute('data-technique')=='mix')
   await ok('view toggle does not restart or replace source',await page.evaluate('window.__originalFrame===document.querySelector("#youtube-mount iframe")'))
   await page.locator('[data-action=view-original]').click()
   await ok('switch back restores independent original label',await page.locator('[data-token="0:0"]').get_attribute('data-technique')=='chest')
   for i in range(20):
    await page.locator('[data-action=view-practice]' if i%2 else '[data-action=view-original]').click()
    await page.locator('[data-filter=chest]' if i%2 else '[data-filter=all]').click()
   await ok('40 rapid mode and filter interactions preserve player',await page.evaluate('window.__originalFrame===document.querySelector("#youtube-mount iframe")'))
   await page.locator('[data-action=view-original]').click();await page.locator('[data-filter=falsetto]').click()
   await ok('original filter selects original voice, not practice label',await page.locator('.token:not(.dim)').evaluate_all("es=>es.length>0&&es.every(e=>e.dataset.technique==='falsetto')"))
   await page.locator('[data-filter=all]').click()
   await page.locator('#seek').evaluate("e=>{e.value=15;e.dispatchEvent(new Event('change',{bubbles:true}));}")
   await page.wait_for_function('Math.abs(window.voxDiagnostics().playback.time-15)<.3')
   await ok('seek remains tied to source and lyric clock',await page.evaluate('Math.abs(window.voxDiagnostics().playback.time-window.voxDiagnostics().lyricTime)<.15'))
   await ok('seeking colors earlier lyric tokens as played',await page.locator('.token.played').count()>0)
   await page.locator('#rate-select').select_option('0.75');await ok('speed controls still work',await page.locator('#rate-select').input_value()=='0.75')
   await page.locator('[data-action=offset-plus]').click();await ok('offset remains editable',await page.locator('#offset-label').inner_text()=='+0.1s')
   await page.locator('[data-action=offset-minus]').click()
   await page.locator('[data-action=roman]').click();await ok('romanization toggle remains independent',await page.locator('#lyrics-scroll').evaluate("e=>e.classList.contains('no-roman')"));await page.locator('[data-action=roman]').click()
   await page.locator('#loop-toggle').click();await ok('phrase loop remains available',await page.locator('#loop-toggle').get_attribute('aria-pressed')=='true');await page.locator('#loop-toggle').click()
   await page.locator('[data-action=next]').click();await page.locator('[data-action=previous]').click();await ok('previous and next do not create second player',await page.locator('#youtube-mount iframe').count()==1)
   await page.locator('[data-action=export]').click()
   async with page.expect_download() as d:await page.locator('[data-action=export-json]').click()
   download=await d.value;dest=OUT/'exported-original-demo.json';await download.save_as(dest)
   obj=json.loads(dest.read_text());score=obj.get('analysis',obj)
   await ok('export retains new independent evidence',bool(score.get('tonality')) and bool(score['phrases'][0].get('observedVoice')))
   await ok('only first navigation tab remains',await page.locator('.nav button').count()==1)
   await ok('only one custom play control',await page.locator('[data-action=play]').count()==1)
   await ok('no removed companion or developer setup',await page.locator('.coach-panel,[data-action=settings]').count()==0)
   for width in [1440,1024,768,390,320]:
    await page.set_viewport_size({'width':width,'height':1000 if width>600 else 844});await page.wait_for_timeout(150)
    await ok(f'{width}px has no page overflow',await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    if width in [1440,390]:
     await page.evaluate('scrollTo(0,0);document.getElementById("toast").className=""');await page.screenshot(path=str(OUT/f'studio-{width}.png'),full_page=True)
   await page.close()
   page=await setup(390)
   await page.locator('#song-url').fill('https://www.youtube.com/watch?v=qaMissing00')
   await page.locator('#song-form button[type=submit]').click();await page.wait_for_selector('.studio');await page.wait_for_function('!window.voxDiagnostics().refining',timeout=20000)
   await ok('omitted original result does not become complete',await page.evaluate('window.voxDiagnostics().adaptive.state==="partial"'))
   await ok('missing observation is visibly recoverable unfinished work','待補上' in await page.locator('[data-token="0:0"]').inner_text())
   await page.locator('[data-action=view-practice]').click();await ok('valid recommendations survive original-observation failure',await page.locator('[data-token="0:0"]').get_attribute('data-technique')=='mix')
   await ok('no uncaught browser exceptions',not errors)
   await browser.close()
 finally:
  for response in streams.values():response.close()
  await session.close()
  server.terminate()
  try:server.wait(timeout=5)
  except subprocess.TimeoutExpired:server.kill()
  (OUT/'report.json').write_text(json.dumps({'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'checks':checks,'pageErrors':errors,'mode':'Actual localhost HTTP/NDJSON bridged through a test fetch adapter because navigation is administrator-blocked. AI mocked; iframe controller backed by actual original local audio. No external YouTube or music accuracy certification.'},ensure_ascii=False,indent=2))
asyncio.run(main())
