/* Forma Motion: native browser APIs; visible content is the fallback. */
(()=>{
 'use strict';
 const root=document.documentElement,reduced=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(hover: hover) and (pointer: fine)'),coarse=matchMedia('(pointer: coarse)');
 const ease='cubic-bezier(.16,1,.3,1)',running=new Set(),perElement=new WeakMap(),seen=new WeakSet(),pending=new Set(),revealedProducts=new Set();
 let preference='on',enabled=false,frame=0,pointerFrame=0,mutationFrame=0,lastCard=null,mouseSeen=false;
 const pointerEnabled=()=>innerWidth>700&&!coarse.matches&&(fine.matches||mouseSeen);
 try{preference=localStorage.getItem('nc_motion')||'on';}catch{}
 function animate(el,frames,options={}){
  if(!enabled||document.hidden||!el?.animate||!el.isConnected)return null;
  perElement.get(el)?.cancel();const a=el.animate(frames,{duration:650,easing:ease,...options});perElement.set(el,a);running.add(a);
  const clean=()=>{running.delete(a);if(perElement.get(el)===a)perElement.delete(el);};a.addEventListener('finish',clean,{once:true});a.addEventListener('cancel',clean,{once:true});return a;
 }
 const pop=el=>animate(el,[{transform:'scale(1)'},{transform:'scale(1.22)',offset:.42},{transform:'scale(1)'}],{duration:460});
 const control=document.createElement('button');control.type='button';control.className='motion-toggle';control.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5"/></svg><span></span>';
 const footer=document.querySelector('.footer-bottom,.simple-footer');if(footer)footer.append(control);else{const holder=document.createElement('div');holder.className='motion-preferences';holder.append(control);document.body.append(holder);}
 const progress=document.createElement('div');progress.className='motion-progress';progress.setAttribute('aria-hidden','true');document.body.append(progress);
 function resetPointer(el){for(const key of ['--card-rx','--card-ry','--scene-x','--scene-y'])el.style.removeProperty(key);}
 function stop(){for(const a of [...running])a.cancel();document.querySelectorAll('.motion-flyer,.motion-ripple').forEach(el=>el.remove());cancelAnimationFrame(pointerFrame);document.querySelectorAll('[data-motion-pointer]').forEach(resetPointer);}
 function setMode(){
  enabled=!reduced.matches&&preference!=='off';root.classList.toggle('nc-motion',enabled);root.classList.toggle('nc-motion-off',!enabled);root.classList.toggle('nc-pointer',pointerEnabled());
  control.setAttribute('aria-pressed',String(enabled));control.setAttribute('aria-label','Page animations');control.setAttribute('aria-disabled',String(reduced.matches));
  control.querySelector('span').textContent=reduced.matches?'Reduced motion':enabled?'Animations on':'Animations off';control.title=reduced.matches?'Animations follow your device’s reduced motion setting.':'Turn page animations on or off';if(!enabled)stop();scheduleScroll();
 }
 control.addEventListener('click',()=>{if(reduced.matches)return;preference=enabled?'off':'on';try{localStorage.setItem('nc_motion',preference);}catch{}setMode();});reduced.addEventListener('change',setMode);
 addEventListener('storage',e=>{if(e.key==='nc_motion'){preference=e.newValue||'on';setMode();}});document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else scheduleScroll();});
 function scroll(){
  frame=0;root.classList.toggle('nc-scrolled',scrollY>20);if(!enabled||document.hidden)return;root.classList.toggle('nc-pointer',pointerEnabled());
  const height=root.scrollHeight-innerHeight;progress.style.transform=`scaleX(${height>0?Math.min(1,Math.max(0,scrollY/height)):0})`;
  const symbol=document.querySelector('.story-symbol svg');if(symbol&&pointerEnabled()){const r=symbol.parentElement.getBoundingClientRect();if(r.top<innerHeight&&r.bottom>0)symbol.style.transform=`rotate(${Math.max(-15,Math.min(65,(innerHeight-r.top)/innerHeight*65))}deg)`;}
 }
 function scheduleScroll(){if(!frame)frame=requestAnimationFrame(scroll);}addEventListener('scroll',scheduleScroll,{passive:true});addEventListener('resize',scheduleScroll,{passive:true});setMode();
 const revealSelector='.section-title,.collection-card,.product-card,.promo-card,.deal-card,.promise-bar>div,.story-inner>div,.story-symbol,.newsletter>div,.newsletter>form,.footer-grid>div,.forma-footer-wordmark,.workspace-hero,.stat-card,.workspace-page .panel,.info-content,.auth-panel,.auth-visual,.login-wrap,.related-card,.review-headline,.review-card,.sticky-side-card,.product-gallery-area,.product-buy-area,.admin-page .stat,.admin-page .section-panel';
 const observer='IntersectionObserver' in window?new IntersectionObserver(entries=>{
  let n=0;for(const entry of entries){if(!entry.isIntersecting)continue;const el=entry.target;observer.unobserve(el);pending.delete(el);
   if(el.matches('.product-card[data-id]')){if(revealedProducts.has(el.dataset.id))continue;revealedProducts.add(el.dataset.id);}
   if(!enabled||document.hidden||el.closest('.drawer,.modal,dialog'))continue;
   const card=el.matches('.product-card,.collection-card,.related-card');animate(el,[{opacity:0,transform:el.matches('.forma-footer-wordmark')?'translateY(35px)':`translateY(${card?24:20}px)${card?' scale(.98)':''}`},{opacity:1,transform:'none'}],{duration:card?700:850,delay:Math.min(n++*55,220),fill:'backwards'});
  }
 },{threshold:.08}):null;
 function discover(scope){if(!(scope instanceof Element))return;for(const el of [...(scope.matches(revealSelector)?[scope]:[]),...scope.querySelectorAll(revealSelector)]){if(seen.has(el)||el.closest('.drawer,.modal,dialog'))continue;seen.add(el);if(observer){pending.add(el);observer.observe(el);}}}
 discover(document.body);const additions=new Set();new MutationObserver(records=>{
  for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&!node.matches('.motion-flyer,.motion-ripple'))additions.add(node);
  if(mutationFrame||(!additions.size&&!pending.size))return;mutationFrame=requestAnimationFrame(()=>{mutationFrame=0;for(const node of additions)if(node.isConnected)discover(node);additions.clear();for(const el of pending)if(!el.isConnected){observer?.unobserve(el);pending.delete(el);}scheduleScroll();});
 }).observe(document.body,{subtree:true,childList:true});
 document.querySelectorAll('.motion-line>*').forEach((el,i)=>animate(el,[{transform:'translateY(112%) rotate(3deg)',opacity:.3},{transform:'translateY(0) rotate(0)',opacity:1}],{duration:1100,delay:100+i*110,fill:'backwards'}));
 document.querySelectorAll('.hero-copy>.forma-label,.hero-copy>p,.hero-buttons,.hero-footnote').forEach((el,i)=>animate(el,[{transform:'translateY(16px)',opacity:0},{transform:'none',opacity:1}],{duration:850,delay:100+i*110,fill:'backwards'}));
 animate(document.querySelector('.hero-scene'),[{opacity:0,clipPath:'inset(6% 0 6% 0 round 32px)',transform:'translateY(20px)'},{opacity:1,clipPath:'inset(0% 0 0% 0 round 24px)',transform:'none'}],{duration:1200,delay:90,fill:'backwards'});
 animate(document.querySelector('.scene-caption'),[{opacity:0,transform:'translateY(24px)'},{opacity:1,transform:'none'}],{duration:900,delay:550,fill:'backwards'});
 document.addEventListener('pointermove',event=>{
  // A real mouse event also identifies remote desktops reporting no primary pointer.
  if(event.pointerType==='mouse'&&!coarse.matches){mouseSeen=true;root.classList.toggle('nc-pointer',pointerEnabled());}
  if(!enabled||!pointerEnabled()||event.pointerType==='touch'||document.hidden)return;const el=event.target.closest('.product-card,.hero-scene');if(lastCard&&lastCard!==el)resetPointer(lastCard);lastCard=el;cancelAnimationFrame(pointerFrame);if(!el)return;const x=event.clientX,y=event.clientY;
  pointerFrame=requestAnimationFrame(()=>{const r=el.getBoundingClientRect();if(!r.width||!r.height)return;const dx=Math.max(-.5,Math.min(.5,(x-r.left)/r.width-.5)),dy=Math.max(-.5,Math.min(.5,(y-r.top)/r.height-.5));el.dataset.motionPointer='true';if(el.classList.contains('hero-scene')){el.style.setProperty('--scene-x',`${dx*12}px`);el.style.setProperty('--scene-y',`${dy*10}px`);}else{el.style.setProperty('--card-rx',`${-dy*3}deg`);el.style.setProperty('--card-ry',`${dx*3}deg`);}});
 },{passive:true});
 document.addEventListener('pointerout',event=>{if(!event.relatedTarget&&lastCard){cancelAnimationFrame(pointerFrame);resetPointer(lastCard);lastCard=null;}},{passive:true});
 function pointerModeChanged(){cancelAnimationFrame(pointerFrame);if(lastCard)resetPointer(lastCard);mouseSeen=false;root.classList.toggle('nc-pointer',pointerEnabled());}fine.addEventListener('change',pointerModeChanged);coarse.addEventListener('change',pointerModeChanged);
 function temporary(el,frames,options,finish){document.body.append(el);const a=animate(el,frames,options);if(a){a.addEventListener('finish',()=>{el.remove();finish?.();},{once:true});a.addEventListener('cancel',()=>el.remove(),{once:true});}else el.remove();}
 document.addEventListener('click',event=>{const el=event.target.closest('button,.primary-btn,.ghost-btn,.load-more');if(!enabled||!el||el.disabled||el.getAttribute('aria-disabled')==='true'||el===control||document.querySelectorAll('.motion-ripple').length>=8)return;const r=el.getBoundingClientRect();if(!r.width||!r.height)return;
  const ring=document.createElement('span');ring.className='motion-ripple';ring.setAttribute('aria-hidden','true');ring.style.left=`${(event.detail?event.clientX:r.left+r.width/2)-20}px`;ring.style.top=`${(event.detail?event.clientY:r.top+r.height/2)-20}px`;temporary(ring,[{opacity:.65,transform:'scale(.3)'},{opacity:0,transform:'scale(1.8)'}],{duration:450});
 },true);
 // Events follow a successful state update, never an optimistic purchase request.
 document.addEventListener('novacart:cart-added',event=>{
  if(!enabled)return;const target=document.querySelector('#cartOpen,.header-bag'),source=event.detail?.source;pop(document.querySelector('#cartCount')||target);pop(source);if(!target||!source||!pointerEnabled()||document.querySelectorAll('.motion-flyer').length>=3)return;
  const from=source.getBoundingClientRect(),to=target.getBoundingClientRect();if(from.top<0||from.bottom>innerHeight||to.bottom<0||to.top>innerHeight)return;
  const original=source.closest('.product-card,.deal-card,.cart-line')?.querySelector('img')||document.querySelector('#mainProductImage');if(!original?.complete||!original.naturalWidth)return;
  const flyer=document.createElement('img');flyer.className='motion-flyer';flyer.alt='';flyer.setAttribute('aria-hidden','true');flyer.src=original.currentSrc||original.src;const x=from.left+from.width/2-32,y=from.top+from.height/2-32,dx=to.left+to.width/2-32-x,dy=to.top+to.height/2-32-y;flyer.style.left=`${x}px`;flyer.style.top=`${y}px`;
  temporary(flyer,[{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${dx*.35}px,${dy*.6-60}px) scale(.8)`,opacity:.95,offset:.45},{transform:`translate(${dx}px,${dy}px) scale(.12)`,opacity:0}],{duration:780,easing:'cubic-bezier(.45,0,.25,1)'},()=>pop(target));
 });
 document.addEventListener('novacart:wishlist-changed',event=>{if(event.detail?.added){pop(event.detail.source);pop(document.querySelector('#wishlistCount'));}});
 const mainImage=document.getElementById('mainProductImage');let previousImage=mainImage?.getAttribute('src');mainImage?.addEventListener('load',()=>{const current=mainImage.getAttribute('src');if(current!==previousImage){previousImage=current;animate(mainImage,[{opacity:.4,transform:'scale(.97)'},{opacity:1,transform:'none'}],{duration:450});}});
 document.addEventListener('focusin',event=>{for(let el=event.target;el;el=el.parentElement)perElement.get(el)?.cancel();});addEventListener('pagehide',()=>{stop();cancelAnimationFrame(frame);frame=0;});addEventListener('pageshow',scheduleScroll);
})();
