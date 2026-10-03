(()=>{
  'use strict';
  const button=document.querySelector('#visualSearchButton'),dialog=document.querySelector('#visualSearchDialog');
  if(!button||!dialog)return;
  const form=dialog.querySelector('form'),input=dialog.querySelector('input[type=file]'),status=dialog.querySelector('[role=status]'),results=dialog.querySelector('.visual-results'),submit=dialog.querySelector('[type=submit]'),preview=dialog.querySelector('.visual-upload-preview');
  let image='';
  fetch('/api/visual-search/config').then(r=>r.json()).then(c=>{button.hidden=!c.enabled;}).catch(()=>{});
  button.onclick=()=>{window.hideAllOverlays?.();dialog.showModal();document.body.classList.add('visual-search-open');};
  dialog.querySelector('[data-close-visual]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{document.body.classList.remove('visual-search-open');button.focus();});
  input.onchange=()=>{
    image='';preview.hidden=true;results.replaceChildren();status.textContent='';
    const file=input.files[0];if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>3*1024*1024){status.textContent='Choose a JPEG, PNG or WebP image under 3 MB.';input.value='';return;}
    const reader=new FileReader();reader.onload=()=>{image=String(reader.result);preview.src=image;preview.hidden=false;};reader.onerror=()=>{status.textContent='That file could not be read. Try another photo.';};reader.readAsDataURL(file);
  };
  form.onsubmit=async event=>{
    event.preventDefault();if(!image){status.textContent='Choose a product photo first.';return;}
    submit.disabled=true;status.textContent='Recognizing the objects in your photo…';results.replaceChildren();
    try{
      const tokenResponse=await fetch('/api/auth/csrf');const token=tokenResponse.ok?(await tokenResponse.json()).csrfToken:null;
      const r=await fetch('/api/visual-search',{method:'POST',headers:{'content-type':'application/json',...(token?{'x-csrf-token':token}:{})},body:JSON.stringify({image,consent:form.elements.visualConsent.checked})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Image search failed.');
      status.textContent=data.message+(data.labels.length?' Recognized: '+data.labels.slice(0,5).map(x=>x.label).join(', ')+'.':'');
      for(const p of data.results){const a=document.createElement('a');a.href='/product.html?id='+encodeURIComponent(p.id);a.className='visual-result';const photo=document.createElement('img');photo.src=p.image;photo.alt='';photo.loading='lazy';const title=document.createElement('strong');title.textContent=p.title;const price=document.createElement('span');price.textContent=new Intl.NumberFormat('en',{style:'currency',currency:p.currency.trim()}).format(p.price);a.append(photo,title,price);results.append(a);}
    }catch(error){status.textContent=error.message;}finally{submit.disabled=false;}
  };
})();
