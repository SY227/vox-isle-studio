/** Separate module so a broken app import cannot leave an empty gradient. */
const app=document.getElementById('app');
const timer=setTimeout(()=>{
  if(document.getElementById('main'))return;
  app.innerHTML='<main class="app-main"><section class="panel" style="margin-top:70px;padding:30px"><h1>聲嶼</h1><p>頁面載入未完成，請重新整理再試。</p><button class="primary" id="reload-page">重新整理</button></section></main>';
  document.getElementById('reload-page').addEventListener('click',()=>location.reload());
},12000);
const observer=new MutationObserver(()=>{if(document.getElementById('main')){clearTimeout(timer);observer.disconnect();}});
observer.observe(app,{childList:true,subtree:true});
