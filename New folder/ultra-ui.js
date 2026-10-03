(() => {
  'use strict';
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const add = (tag, cls) => { const e=document.createElement(tag); e.className=cls; document.body.appendChild(e); return e; };
  function progress(){
    const bar=add('div','nc-progress');
    const update=()=>{const d=document.documentElement.scrollHeight-innerHeight; bar.style.width=`${d>0?(scrollY/d)*100:0}%`;};
    addEventListener('scroll',update,{passive:true}); update();
  }
  function ambience(){ if(reduce) return; const n=add('div','nc-noise'); n.setAttribute('aria-hidden','true'); }
  function tilt(){
    if(reduce || innerWidth<900 || navigator.maxTouchPoints>0) return;
    document.querySelectorAll('.product-card,.deal-card,.promo-card,.stat,.why-grid article').forEach(el=>{
      el.addEventListener('pointermove',e=>{const r=el.getBoundingClientRect();const x=(e.clientX-r.left)/r.width-.5;const y=(e.clientY-r.top)/r.height-.5;el.style.transform=`perspective(900px) rotateX(${y*-2.6}deg) rotateY(${x*3.2}deg) translateY(-5px)`;});
      el.addEventListener('pointerleave',()=>el.style.transform='');
    });
  }
  function magnetic(){
    if(reduce || innerWidth<900 || navigator.maxTouchPoints>0) return;
    document.querySelectorAll('.primary-btn,.ghost-btn,.add-btn,.buy-now,.secondary-cart-btn').forEach(el=>{
      el.classList.add('nc-magnetic');
      el.addEventListener('pointermove',e=>{const r=el.getBoundingClientRect();const x=(e.clientX-r.left-r.width/2)/r.width;const y=(e.clientY-r.top-r.height/2)/r.height;el.style.transform=`translate(${x*5}px,${y*5}px)`;});
      el.addEventListener('pointerleave',()=>el.style.transform='');
    });
  }
  function start(){progress();ambience();tilt();magnetic();}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();

// NovaCart v18 signature interactions: pointer-aware light + subtle depth.
(() => {
  'use strict';
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce || navigator.maxTouchPoints > 0) return;
  const surfaces = '.product-card,.deal-card,.promo-card,.why-grid article,.floating-card,.newsletter,.hero-feature,.auth-card';
  document.addEventListener('pointermove', e => {
    const el = e.target.closest?.(surfaces);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    el.style.setProperty('--mx', `${x}%`);
    el.style.setProperty('--my', `${y}%`);
  }, {passive:true});
})();
