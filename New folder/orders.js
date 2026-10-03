(() => {
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={pending_payment:'Awaiting payment',placed:'Order placed',paid:'Ready for dispatch',processing:'Preparing your order',packed:'Packed',partially_shipped:'Partially shipped',shipped:'Shipped',delivered:'Delivered',cancelled:'Cancelled',refunded:'Refunded',payment_failed:'Payment failed',payment_expired:'Payment expired',cod:'Pay on delivery',unpaid:'Unpaid',partially_refunded:'Partially refunded'};
  const label=v=>labels[v]||String(v||'Awaiting update').replaceAll('_',' ');
  const when=value=>value&&!Number.isNaN(new Date(value).getTime())?new Date(value).toLocaleString():'Update time unavailable';
  async function api(url,options={}){
    const response=await fetch(url,{cache:'no-store',...options});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(data.error||'Could not load this information. Please try again.'),{status:response.status});
    return data;
  }
  async function csrf(){return (await api('/api/auth/csrf')).csrfToken;}
  function shipmentHTML(shipment){
    return `<section class="shipment-card"><div class="shipment-heading"><div><span class="kicker">${shipment.type==='seller'?'SELLER SHIPMENT':'STORE SHIPMENT'}</span><h4>${esc(shipment.sellerName)}</h4></div><span class="shipment-status">${esc(label(shipment.status))}</span></div>
      <ul class="shipment-items">${shipment.items.map(i=>`<li>${esc(i.qty)} × ${esc(i.title)}</li>`).join('')}</ul>
      <dl class="shipment-details"><div><dt>Courier</dt><dd>${esc(shipment.courier||'Not provided yet')}</dd></div><div><dt>Tracking number</dt><dd class="tracking-number">${esc(shipment.trackingNumber||'Not provided yet')}</dd></div></dl>
      <p class="muted shipment-updated">Last updated: ${esc(when(shipment.updatedAt))}</p></section>`;
  }
  async function tracking(button){
    const id=button.dataset.track,article=button.closest('[data-order]'),panel=document.getElementById('track-'+id);
    panel.hidden=false;button.setAttribute('aria-expanded','true');button.disabled=true;
    panel.setAttribute('aria-busy','true');panel.textContent='Loading shipment details…';
    try{
      const data=await api('/api/orders/'+encodeURIComponent(id)+'/shipment');
      article.querySelector('[data-delivery-status]').textContent=label(data.fulfillmentStatus);
      article.querySelector('[data-payment-status]').textContent=data.order.payment_status==='paid'?'Paid':label(data.order.payment_status);
      article.querySelector('[data-cancel]').hidden=!data.canCancel;
      article.querySelector('[data-return]').hidden=data.order.status!=='delivered';
      panel.innerHTML=`<div class="shipment-intro"><h3>Your shipments</h3><button class="text-link" data-hide-tracking>Hide details ↑</button></div>
        <div class="shipment-grid">${data.shipments.map(shipmentHTML).join('')}</div>
        ${data.events?.length?`<section class="shipment-events"><h4>Order updates</h4>${data.events.map(e=>`<div class="address"><b>${esc(label(e.status))}</b><span>${esc(when(e.occurred_at))}${e.location?' · '+esc(e.location):''}<br>${esc(e.note)}</span></div>`).join('')}</section>`:''}
        <p class="muted shipment-hint">Updates are provided by the store or seller. Use “Refresh tracking” to check for changes.</p>`;
      panel.querySelector('[data-hide-tracking]').onclick=()=>{panel.hidden=true;button.setAttribute('aria-expanded','false');button.textContent='Tracking';button.focus();};
    }catch(error){
      if(error.status===401){location.href='/login.html';return;}
      panel.textContent=error.message;
    }finally{button.disabled=false;button.textContent='Refresh tracking';panel.setAttribute('aria-busy','false');}
  }
  async function load(){
    try{
      const me=await api('/api/auth/me');$('#hello').textContent=`${me.user.name.split(' ')[0]}'s orders`;
      const data=await api('/api/orders');
      $('#orders').innerHTML=data.orders?.length?data.orders.map(o=>`<article class="card customer-order" data-order="${esc(o.id)}">
        <div class="customer-order-heading"><div><h3>${esc(o.id)}</h3><p class="muted">${esc(when(o.created_at))} · ${o.items.length} item(s)</p></div><strong>${Number(o.total).toFixed(2)} ${esc(o.currency)}</strong></div>
        <div class="order-state"><span>Delivery: <b data-delivery-status>${esc(label(o.fulfillmentStatus||o.status))}</b></span><span>Payment: <b data-payment-status>${esc(o.payment_status==='paid'?'Paid':label(o.payment_status))}</b></span></div>
        <p class="muted shipment-count">${o.shipments.length} shipment${o.shipments.length===1?'':'s'} · ${o.shipments.map(s=>esc(s.sellerName)).join(' / ')}</p>
        <div class="order-actions"><a class="btn" href="/api/orders/${encodeURIComponent(o.id)}/invoice" target="_blank" rel="noopener">Invoice</a><button class="btn danger" data-cancel="${esc(o.id)}" ${o.canCancel?'':'hidden'}>Cancel order</button><button class="btn" data-return="${esc(o.id)}" ${o.status==='delivered'?'':'hidden'}>Request return</button><button class="btn" data-track="${esc(o.id)}" aria-expanded="false" aria-controls="track-${esc(o.id)}">Tracking</button></div>
        <div id="track-${esc(o.id)}" class="tracking-panel" hidden role="region" aria-label="Shipment details for ${esc(o.id)}" aria-live="polite"></div></article>`).join(''):'<p class="muted">No orders yet. Your first order will appear here.</p>';
      document.querySelectorAll('[data-track]').forEach(b=>b.onclick=()=>tracking(b));
      document.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=async()=>{
        if(!confirm('Cancel this order?'))return;
        try{await api('/api/orders/'+encodeURIComponent(b.dataset.cancel)+'/cancel',{method:'POST',headers:{'x-csrf-token':await csrf()}});await load();}catch(e){alert(e.message);}
      });
      document.querySelectorAll('[data-return]').forEach(b=>b.onclick=async()=>{
        const reason=prompt('Return reason');if(!reason)return;
        try{await api('/api/orders/'+encodeURIComponent(b.dataset.return)+'/return-request',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':await csrf()},body:JSON.stringify({reason,note:''})});alert('Return request submitted.');}catch(e){alert(e.message);}
      });
      const selected=new URLSearchParams(location.search).get('order');
      const button=[...document.querySelectorAll('[data-track]')].find(b=>b.dataset.track===selected);
      if(button){await tracking(button);button.closest('[data-order]').scrollIntoView({block:'start'});}
    }catch(error){
      if(error.status===401){location.href='/login.html';return;}
      $('#orders').textContent=error.message;
      const retry=document.createElement('button');retry.className='btn';retry.textContent='Try again';retry.onclick=load;$('#orders').append(retry);
    }
  }
  load();
})();
