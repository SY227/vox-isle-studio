export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={
  play:'<path d="m8 5 11 7-11 7z"/>',pause:'<path d="M8 5v14M16 5v14"/>',next:'<path d="m5 5 10 7-10 7zM19 5v14"/>',prev:'<path d="m19 5-10 7 10 7zM5 5v14"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',upRight:'<path d="M6 18 18 6M6 6h12v12"/>',link:'<path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',mic:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  wave:'<path d="M3 10v4m4-8v12m5-16v20m5-17v14m4-9v4"/>',spark:'<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z"/>',
  headphones:'<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
  music:'<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M10 3h4l1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3z"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',check:'<path d="m5 12 4 4L19 6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  loop:'<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',save:'<path d="M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',edit:'<path d="m15 4 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1z"/>',
  history:'<path d="M3 11a9 9 0 1 1 3 8M3 4v7h7m2-4v6l4 2"/>',trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  volume:'<path d="M3 9h4l5-5v16l-5-5H3zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  island:'<path d="m2 17 6-8 4 5 3-3 7 6M2 21h20"/><circle cx="17" cy="5" r="2"/>'
};
export function icon(name,size=20){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.spark}</svg>`;}
export const button=(label,action,iconName,cls='')=>`<button class="${cls}" data-action="${action}">${iconName?icon(iconName):''}${esc(label)}</button>`;
export function toast(text,error=false){const el=document.querySelector('#toast');el.textContent=text;el.className='show'+(error?' error':'');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.className='',5000);}
let previousFocus;
export function modal(title,body,wide=false){
  previousFocus=document.activeElement;
  document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="關閉">${icon('close')}</button></div>${body}</section></div>`;
  document.body.classList.add('modal-open');document.querySelector('.modal button,.modal input')?.focus();
}
export function closeModal(){document.querySelector('#modal-root').innerHTML='';document.body.classList.remove('modal-open');previousFocus?.focus?.();}
export function saveFile(name,data,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
export function debounce(fn,wait=200){let timer;return (...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),wait);};}
document.addEventListener('keydown',e=>{
  const dialog=document.querySelector('.modal');if(!dialog)return;
  if(e.key==='Escape'){closeModal();return;}
  if(e.key==='Tab'){
    const els=[...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(x=>!x.disabled&&x.offsetParent!==null);const first=els[0],last=els.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
});
