(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveal = () => {
    document.querySelectorAll('#app .stat, #app .panel').forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      const apply = () => { el.style.transition = reduce ? 'none' : 'opacity .45s ease, transform .45s ease'; el.style.opacity='1'; el.style.transform='none'; };
      window.setTimeout(apply, Math.min(420, i * 35));
    });
  };
  const addAmbient = () => {
    if (reduce || document.querySelector('.nc-admin-ambient')) return;
    const orb = document.createElement('div'); orb.className='nc-admin-ambient';
    orb.style.cssText='position:fixed;left:-160px;top:-160px;width:320px;height:320px;border-radius:50%;pointer-events:none;z-index:-1;background:radial-gradient(circle,rgba(183,255,53,.07),transparent 68%);filter:blur(2px);transition:transform 1.2s ease;';
    document.body.appendChild(orb);
    window.addEventListener('pointermove', e => { orb.style.transform=`translate(${e.clientX*.035}px,${e.clientY*.02}px)`; }, {passive:true});
  };
  window.addEventListener('load', () => { reveal(); addAmbient(); });
})();
