/* Small, shared interaction layer. Content stays visible without JavaScript. */
(()=>{
  'use strict';
  document.documentElement.classList.add('sig-ready');
  document.querySelectorAll('.admin-page .modal-backdrop, .admin-page .drawer-backdrop').forEach(el=>{el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label',el.id==='drawerBackdrop'?'Order details':'Edit workspace item');el.tabIndex=-1;});
  if(document.body.classList.contains('admin-page')){const sidebar=document.querySelector('#sidebar');document.addEventListener('click',e=>{if(innerWidth<=760&&sidebar?.classList.contains('open')&&!sidebar.contains(e.target)&&!e.target.closest('#mobileMenu'))sidebar.classList.remove('open');});}
  const fallback='/assets/image-unavailable.svg';
  document.addEventListener('error',event=>{const el=event.target;if(el instanceof HTMLImageElement&&!el.dataset.fallback){el.dataset.fallback='true';el.src=fallback;}},true);
  // Close a mobile navigation menu after choosing any destination.
  document.querySelectorAll('#mobileNav a').forEach(a=>a.addEventListener('click',()=>{
    document.querySelector('#mobileNav')?.classList.remove('open');
    document.querySelector('#mobileMenuBtn')?.setAttribute('aria-expanded','false');
  }));
  const selector='a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]';
  let dialog=null,returnFocus=null;const inertBefore=new Map();
  const allDialogs=[...document.querySelectorAll('body.store-page > .drawer, body.store-page > .modal, body.admin-page > .drawer-backdrop, body.admin-page > .modal-backdrop')];
  function syncDialogs(){
    const next=allDialogs.find(el=>el.classList.contains('open')||el.classList.contains('show'))||null;
    for(const el of allDialogs){el.setAttribute('aria-hidden',String(el!==next));el.inert=el!==next;}
    if(next===dialog)return;
    if(next){
      if(!dialog){returnFocus=document.activeElement;for(const child of document.body.children){if(!allDialogs.includes(child)&&!['backdrop','toast'].includes(child.id)&&child.tagName!=='SCRIPT'){inertBefore.set(child,child.inert);child.inert=true;}}}
      dialog=next;document.body.classList.add('overlay-open');
      const opened=next;const focusDialog=()=>{if(dialog===opened&&!opened.contains(document.activeElement))(opened.querySelector(selector)||opened).focus({preventScroll:true});};requestAnimationFrame(()=>requestAnimationFrame(focusDialog));opened.addEventListener('transitionend',focusDialog,{once:true});
    }else{
      dialog=null;document.body.classList.remove('overlay-open');
      for(const [el,wasInert] of inertBefore)el.inert=wasInert;
      inertBefore.clear();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;
    }
  }
  if(allDialogs.length){const observer=new MutationObserver(syncDialogs);allDialogs.forEach(el=>observer.observe(el,{attributes:true,attributeFilter:['class']}));syncDialogs();}
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      if(dialog){event.preventDefault();if(window.hideAllOverlays)window.hideAllOverlays();else{window.closeDrawer?.();window.closeModal?.();}}document.querySelector('#sidebar')?.classList.remove('open');
      document.querySelector('#mobileNav')?.classList.remove('open');document.querySelector('#mobileMenuBtn')?.setAttribute('aria-expanded','false');
    }
    if(event.key==='Tab'&&dialog){
      const focusable=[...dialog.querySelectorAll(selector)].filter(el=>el.getClientRects().length&&!el.closest('[hidden]'));
      if(!focusable.length){event.preventDefault();dialog.focus();return;}
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  // Link each product tab to its panel and allow arrow-key navigation.
  const tabs=[...document.querySelectorAll('.detail-tabs [data-tab]')];
  tabs.forEach((tab,index)=>{
    tab.id='product-tab-'+tab.dataset.tab;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(tab.classList.contains('active')));tab.setAttribute('aria-controls','tab-'+tab.dataset.tab);
    const panel=document.getElementById('tab-'+tab.dataset.tab);if(panel){panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);}
    tab.addEventListener('keydown',event=>{let target;if(event.key==='ArrowRight')target=(index+1)%tabs.length;if(event.key==='ArrowLeft')target=(index+tabs.length-1)%tabs.length;if(event.key==='Home')target=0;if(event.key==='End')target=tabs.length-1;if(target!==undefined){event.preventDefault();tabs[target].click();tabs[target].focus();}});
  });
})();
