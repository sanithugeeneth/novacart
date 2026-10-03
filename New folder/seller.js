let csrf='',sellerCurrency=null;
const $=s=>document.querySelector(s);
const sellerOrders={page:1,pages:0,request:0};
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
async function api(url,options={}){
  const headers={...options.headers};if(options.body!=null)headers['content-type']='application/json';if(csrf)headers['x-csrf-token']=csrf;
  const r=await fetch(url,{...options,headers});const j=await r.json().catch(()=>({}));return {r,j};
}
function formFeedback(message){const status=$('#sellerStatus');if(status)status.textContent=message;else alert(message);}
async function refreshSellerOverview(){
  const r=await api('/api/seller/overview');if(!r.r.ok)return;
  const x=r.j;$('#app').innerHTML=[['Visible products',x.products.count],['Orders',x.orders.count],['Recorded payouts',payoutMoney(x.payouts.available,x.currency||sellerCurrency)],['Rating',Number(x.reviews.rating).toFixed(2)]].map(([label,value])=>`<div class="panel"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join('');
}
async function boot(){
  try{
    const c=await api('/api/auth/csrf');if(c.r.ok)csrf=c.j.csrfToken;
    const me=await api('/api/seller/me');
    if(me.r.ok&&me.j.seller?.status==='approved'){
      $('#apply').style.display='none';$('#sellerWorkspace').hidden=false;
      const link=$('.workspace-hero .primary-btn');if(link){link.href='#products';link.textContent='Manage your products ↓';}
      const config=await api('/api/store-config');if(!config.r.ok)throw new Error('Currency unavailable');sellerCurrency=WorkspaceMoney.setCurrency(config.j.currency);
      setupSellerCatalog();setupSellerOrders();setupSellerPayouts();
      await Promise.all([refreshSellerOverview(),loadSellerProducts(),loadSellerOrders(),loadSellerPayouts()]);
    }else{
      $('#products').style.display='none';$('#orders').style.display='none';
      if(me.r.ok&&me.j.seller){
        $('#app').innerHTML='<div class="panel seller-notice"><small>Seller application</small><p>Your current status is <b>'+esc(me.j.seller.status)+'</b>. Contact support if you need help with your application.</p></div>';
        $('#apply').style.display='none';const link=$('.workspace-hero .primary-btn');if(link){link.href='/support.html';link.textContent='Contact support →';}
      }else if(me.r.status===401){formFeedback('Sign in to your account before submitting a seller application.');}
    }
  }catch(error){formFeedback('Could not load the seller center. Refresh the page to retry.');$('#app').innerHTML='<div class="panel seller-notice"><p role="alert">Could not load the seller center or store currency. Refresh the page to retry.</p></div>';const workspace=$('#sellerWorkspace');if(workspace)workspace.hidden=true;}
}
$('#applyForm').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('button[type=submit]');if(button)button.disabled=true;
  try{const r=await api('/api/seller/apply',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form).entries()))});formFeedback(r.r.ok?'Application submitted.':'Error: '+(r.j.error||'Could not submit'));if(r.r.ok)form.reset();}
  catch(error){formFeedback('Could not submit. Please check your connection and try again.');}finally{if(button)button.disabled=false;}
};
function setupSellerOrders(){
  $('#orderFilters').onsubmit=e=>{e.preventDefault();sellerOrders.page=1;loadSellerOrders();};
  $('#refreshOrders').onclick=()=>loadSellerOrders();
  $('#ordersPrev').onclick=()=>{if(sellerOrders.page>1){sellerOrders.page--;loadSellerOrders();}};
  $('#ordersNext').onclick=()=>{if(sellerOrders.page<sellerOrders.pages){sellerOrders.page++;loadSellerOrders();}};
}
async function loadSellerOrders(){
  const token=++sellerOrders.request,query=new URLSearchParams(new FormData($('#orderFilters')));query.set('page',sellerOrders.page);query.set('limit','12');$('#ordersNotice').textContent='Loading orders…';
  try{
    const r=await api('/api/seller/orders?'+query);if(!r.r.ok)throw new Error(r.j.error||'Could not load orders.');if(token!==sellerOrders.request)return;
    sellerOrders.pages=r.j.pagination.pages;
    if(sellerOrders.page>Math.max(1,sellerOrders.pages)){sellerOrders.page=Math.max(1,sellerOrders.pages);return loadSellerOrders();}
    renderSellerOrders(r.j.orders);$('#ordersPage').textContent=`Page ${sellerOrders.pages?sellerOrders.page:0} of ${sellerOrders.pages} · ${r.j.pagination.total} orders`;
    $('#ordersPrev').disabled=sellerOrders.page<=1;$('#ordersNext').disabled=sellerOrders.page>=sellerOrders.pages;$('#ordersNotice').textContent='';
  }catch(error){if(token===sellerOrders.request)$('#ordersNotice').textContent=error.message||'Could not load orders. Use Refresh orders to retry.';}
}
function renderSellerOrders(orders){
  const stages=['processing','packed','shipped'],rank={placed:0,paid:0,processing:1,packed:2,shipped:3};
  $('#ordersList').innerHTML=orders.map(o=>{
    const confirmed=o.payment_status==='paid'&&Boolean(o.paid_at);
    const payable=o.payment_method==='stripe'?confirmed:o.payment_method==='cod'&&(o.payment_status==='cod'||confirmed);
    const canEdit=payable&&!o.inventory_released&&!o.refund_held&&['placed','paid','processing','packed','shipped'].includes(o.order_status)&&Object.hasOwn(rank,o.status);
    const address=o.shipping_address||{},addressText=[address.fullName,address.line1,address.line2,[address.city,address.state,address.postalCode].filter(Boolean).join(', '),address.country].filter(Boolean).map(esc).join('<br>');
    return `<article class="card seller-shipment-card"><div class="seller-order-heading"><h3>${esc(o.order_id)}</h3><span class="shipment-status">${esc(o.status.replaceAll('_',' '))}</span></div><p class="seller-tracking-note">${esc(o.customer_name)} · ${esc(o.customer_email)}<br>Payment: ${esc(o.payment_status.replaceAll('_',' '))} · ${esc(o.payment_method==='cod'?'Cash on delivery':'Card')}</p>
      <ul class="seller-order-items">${(o.items||[]).map(i=>`<li><span>${i.qty} × ${esc(i.title)}</span><b>${esc(payoutMoney(i.qty*i.unit_price,o.currency))}</b></li>`).join('')}</ul>
      <details class="seller-address"><summary>Delivery address &amp; contact</summary><address>${addressText||'No address recorded.'}</address><p>${esc(o.customer_phone||'No phone recorded.')}</p></details>
      <p class="seller-tracking-note">Courier: ${esc(o.courier||'Not set')} · Tracking: ${esc(o.tracking_number||'Not set')}</p>
      ${canEdit?`<form class="seller-tracking-form" data-seller-tracking="${esc(o.order_id)}"><label>Shipment status<select name="status">${stages.filter(v=>rank[v]>=rank[o.status]).map(v=>`<option value="${v}" ${v===o.status?'selected':''}>${v.charAt(0).toUpperCase()+v.slice(1)}</option>`).join('')}</select></label><label>Courier<input name="courier" maxlength="100" value="${esc(o.courier)}" placeholder="Courier name"></label><label>Tracking number<input name="trackingNumber" maxlength="120" value="${esc(o.tracking_number)}" placeholder="Tracking number"></label><button class="primary-btn" type="submit">Save shipment</button><p role="status" aria-live="polite"></p></form>`:`<p class="seller-tracking-note seller-locked">${o.refund_held?'Shipment updates are paused while this order has a refund.':'Shipment updates are unavailable until payment is confirmed or while the order is closed. Cash on delivery is supported.'}</p>`}</article>`;
  }).join('')||'<div class="seller-empty"><h3>No orders found</h3><p>New orders will appear here. Try changing the filters.</p></div>';
  document.querySelectorAll('[data-seller-tracking]').forEach(form=>form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button'),status=form.querySelector('[role=status]');button.disabled=true;status.textContent='Saving…';
    try{
      const body=Object.fromEntries(new FormData(form).entries());
      const result=await api('/api/seller/orders/'+encodeURIComponent(form.dataset.sellerTracking),{method:'PATCH',body:JSON.stringify(body)});
      if(!result.r.ok)throw new Error(result.j.error||'Could not save shipment.');
      await loadSellerOrders();const saved=document.querySelector(`[data-seller-tracking="${CSS.escape(form.dataset.sellerTracking)}"]`);
      if(saved)saved.querySelector('[role=status]').textContent='Saved. The customer can now see these shipment details.';
      else $('#ordersNotice').textContent='Saved. The order may now be outside your selected status filter.';
    }catch(error){status.textContent=error.message||'Could not save shipment. Please try again.';}finally{button.disabled=false;}
  });
}
function payoutMoney(value,currency){return WorkspaceMoney.format(value,currency);}
async function loadSellerPayouts(refresh=false){
  const panel=$('#sellerPayouts');if(!panel)return;panel.hidden=false;
  const notice=$('#payoutNotice');
  try{
    if(refresh){const r=await api('/api/seller/payouts/reconcile',{method:'POST',body:'{}'});if(!r.r.ok)throw new Error(r.j.error||'Could not refresh refund balance.');}
    const r=await api('/api/seller/payouts');if(!r.r.ok)throw new Error(r.j.error||'Could not load payouts.');
    const b=r.j.balance,m=v=>payoutMoney(v,b.currency);
    const overview=$('#app .panel:nth-child(3) strong');if(overview)overview.textContent=m(r.j.payouts.filter(p=>p.ledger_version===1&&['available','pending'].includes(p.status)&&WorkspaceMoney.code(p.currency)===WorkspaceMoney.code(b.currency)).reduce((n,p)=>n+p.netAmount,0));
    $('#payoutBalance').innerHTML=[['Refunds to recover',b.totalDebits],['Recovered',b.recovered],['Reserved in payouts',b.reserved],['Carried forward',b.carryForward]].map(([label,value])=>`<div><small>${esc(label)}</small><strong>${esc(m(value))}</strong></div>`).join('');
    $('#sellerPayoutList').innerHTML=r.j.payouts.map(p=>`<article class="payout-card"><b>${esc(String(p.period_start).slice(0,10))} → ${esc(String(p.period_end).slice(0,10))}</b><span>${esc(p.status==='settled'?'Settled by refund offsets':p.status)}</span>${p.reconciliation_note?`<small>Needs review: ${esc(p.reconciliation_note)}</small>`:''}<dl><div><dt>Earnings after commission</dt><dd>${esc(payoutMoney(Number(p.netAmount)+Number(p.refundAmount),p.currency))}</dd></div><div><dt>Refund deduction</dt><dd>${esc(payoutMoney(p.refundAmount,p.currency))}</dd></div><div><dt>Net transfer</dt><dd>${esc(payoutMoney(p.netAmount,p.currency))}</dd></div></dl></article>`).join('')||'<p>No payouts generated yet.</p>';
    $('#sellerRefundAdjustments').innerHTML=b.adjustments.map(a=>`<article class="payout-card"><b>${esc(a.orderId)}</b><span>Refund recovery: ${esc(m(a.debit))}</span><span>Recovered: ${esc(m(a.recovered))} · Reserved: ${esc(m(a.reserved))} · Remaining: ${esc(m(a.remaining))}</span></article>`).join('')||'<p>No recorded refund adjustments.</p>';
    if(refresh)notice.textContent='Refund balance updated. Generate or reconcile an unpaid payout to apply it.';
  }catch(e){notice.textContent=e.message||'Could not load payouts.';}
}
function setupSellerPayouts(){
  const form=$('#generatePayout');if(!form)return;const today=new Date().toISOString().slice(0,10);
  form.elements.periodStart.value=today.slice(0,8)+'01';form.elements.periodEnd.value=today;
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button'),notice=$('#payoutNotice');button.disabled=true;notice.textContent='Requesting payout…';
    try{const r=await api('/api/seller/payouts/generate',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form).entries()))});if(!r.r.ok)throw new Error(r.j.error||'Could not generate payout.');await loadSellerPayouts();notice.textContent=r.j.payoutId?`Payout request ${r.j.duplicate?'updated':'recorded for admin review'}. Net transfer: ${payoutMoney(r.j.net,r.j.currency)}. Refund deduction: ${payoutMoney(r.j.refundDeduction,r.j.currency)}.`:r.j.message;}catch(e){notice.textContent=e.message||'Could not generate payout.';}finally{button.disabled=false;}
  };
  $('#refreshPayouts').onclick=async event=>{event.currentTarget.disabled=true;await loadSellerPayouts(true);$('#refreshPayouts').disabled=false;};
}
boot();
