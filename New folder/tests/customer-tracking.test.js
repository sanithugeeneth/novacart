import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {sellerFixture} from './seller-fixture.js';

let f;
before(async()=>{f=await sellerFixture();});
after(async()=>f?.close());
async function order(items=[{id:'alpha-product',qty:1}],method='cod'){
  const r=await f.checkout(items,method);assert.equal(r.status,200,JSON.stringify(r.data));
  return r.data.orderId||r.data.id;
}
async function update(id,name='alpha',body={status:'shipped',trackingNumber:'ALPHA-123',courier:'Alpha Courier'}){
  const r=await f.api('/api/seller/orders/'+id,{method:'PATCH',account:f.accounts[name],body});
  assert.equal(r.status,200,JSON.stringify(r.data));return r;
}
async function tracking(id){const r=await f.api('/api/orders/'+id+'/shipment',{account:f.accounts.buyer});assert.equal(r.status,200);return r.data;}

test('seller tracking and status reach both customer shipment and order-list APIs',async()=>{
  const id=await order();await update(id);
  const detail=await tracking(id),ship=detail.shipments[0];
  assert.equal(detail.fulfillmentStatus,'shipped');assert.equal(detail.canCancel,false);
  assert.equal(ship.trackingNumber,'ALPHA-123');assert.equal(ship.courier,'Alpha Courier');
  assert.equal(ship.status,'shipped');assert.equal(ship.sellerName,'alpha Store');
  assert.deepEqual(ship.items.map(i=>i.productId),['alpha-product']);
  const listed=(await f.api('/api/orders',{account:f.accounts.buyer})).data.orders.find(o=>o.id===id);
  assert.equal(listed.fulfillmentStatus,'shipped');assert.deepEqual(listed.shipments,detail.shipments);
  assert.equal(listed.payment_status,'cod');assert.equal(listed.paid_at,null);
});

test('multi-seller shipments retain distinct tracking and report partial dispatch',async()=>{
  const id=await order([{id:'alpha-product',qty:1},{id:'beta-product',qty:2}]);
  await update(id);let detail=await tracking(id);
  assert.equal(detail.fulfillmentStatus,'partially_shipped');assert.equal(detail.shipments.length,2);
  const beta=detail.shipments.find(s=>s.sellerName==='beta Store');
  assert.equal(beta.status,'placed');assert.equal(beta.trackingNumber,'');
  assert.deepEqual(beta.items,[{productId:'beta-product',variantId:null,title:'beta-product',qty:2}]);
  await update(id,'beta',{status:'shipped',courier:'Beta Courier',trackingNumber:'BETA-456'});
  detail=await tracking(id);assert.equal(detail.fulfillmentStatus,'shipped');
  assert.deepEqual(new Set(detail.shipments.map(s=>s.trackingNumber)),new Set(['ALPHA-123','BETA-456']));
  const parent=(await f.pool.query('select status,tracking_number,courier from orders where id=$1',[id])).rows[0];
  assert.deepEqual(parent,{status:'placed',tracking_number:'',courier:''});
});

test('mixed store and seller items keep store tracking separate and never claim premature complete dispatch',async()=>{
  const id=await order([{id:'alpha-product',qty:1},{id:'platform-product',qty:1}]);
  await update(id);let detail=await tracking(id);
  assert.equal(detail.fulfillmentStatus,'partially_shipped');
  const store=detail.shipments.find(s=>s.type==='store');assert.deepEqual(store.items.map(i=>i.productId),['platform-product']);
  assert.equal(store.trackingNumber,'');assert.equal(store.status,'placed');
  await f.pool.query("update orders set status='shipped',tracking_number='STORE-789',courier='Store Courier' where id=$1",[id]);
  detail=await tracking(id);assert.equal(detail.fulfillmentStatus,'shipped');
  assert.equal(detail.shipments.find(s=>s.type==='store').trackingNumber,'STORE-789');
  assert.equal(detail.shipments.find(s=>s.type==='seller').trackingNumber,'ALPHA-123');
});

test('existing seller tracking is visible without rewriting historical rows or generating fake events',async()=>{
  const id=await order();
  await f.pool.query("update seller_orders set status='shipped',tracking_number='LEGACY-123',courier='Legacy Courier' where order_id=$1",[id]);
  const before=(await f.pool.query('select * from seller_orders where order_id=$1',[id])).rows;
  const detail=await tracking(id);assert.equal(detail.shipments[0].trackingNumber,'LEGACY-123');
  assert.equal(detail.events.length,0);assert.deepEqual((await f.pool.query('select * from seller_orders where order_id=$1',[id])).rows,before);
});

test('store-only tracking and existing administrator shipment events remain available',async()=>{
  const id=await order([{id:'platform-product',qty:1}]);
  await f.pool.query("update orders set status='shipped',tracking_number='STORE-ONLY',courier='Postal Service' where id=$1",[id]);
  await f.pool.query("insert into shipment_events(order_id,status,location,note) values($1,'shipped','Colombo','Collected by courier')",[id]);
  const detail=await tracking(id);assert.equal(detail.shipments.length,1);
  assert.equal(detail.shipments[0].type,'store');assert.equal(detail.shipments[0].trackingNumber,'STORE-ONLY');
  assert.equal(detail.events[0].note,'Collected by courier');assert.equal(detail.fulfillmentStatus,'shipped');
});

test('omitted tracking fields are preserved and explicit corrections are returned on the next read',async()=>{
  const id=await order();await update(id,'alpha',{status:'processing',trackingNumber:'ORIGINAL',courier:'Courier'});
  await update(id,'alpha',{status:'packed'});let detail=await tracking(id);
  assert.equal(detail.shipments[0].trackingNumber,'ORIGINAL');assert.equal(detail.shipments[0].courier,'Courier');
  await update(id,'alpha',{status:'shipped',trackingNumber:'CORRECTED',courier:'New Courier'});
  detail=await tracking(id);assert.equal(detail.shipments[0].trackingNumber,'CORRECTED');
  const audit=(await f.pool.query("select details from audit_logs where entity_id=$1 and action='seller_order_update' order by id desc limit 1",[id])).rows[0];
  assert.equal(audit.details.trackingNumber,'CORRECTED');
});

test('customer shipment data requires the order owner and excludes seller financial/private records',async()=>{
  const id=await order();const path='/api/orders/'+id+'/shipment';
  assert.equal((await f.api(path)).status,401);
  for(const name of ['alpha','beta','orphan'])assert.equal((await f.api(path,{account:f.accounts[name]})).status,404);
  assert.equal((await f.api('/api/orders/nonexistent/shipment',{account:f.accounts.buyer})).status,404);
  const detail=await tracking(id);
  for(const shipment of detail.shipments)for(const key of ['commission','seller_net','business_email','user_id','shipping_address'])assert.equal(key in shipment,false);
  assert.equal((await f.api('/api/orders',{account:f.accounts.beta})).data.orders.length,0);
  const response=await fetch(f.base+path,{headers:{cookie:f.accounts.buyer.cookie}});
  assert.match(response.headers.get('cache-control'),/no-store/);
});

test('unpaid shipping stays blocked and customer reads cannot turn it into paid or shipped',async()=>{
  const id=await order(undefined,'stripe');
  assert.equal((await f.api('/api/seller/orders/'+id,{method:'PATCH',account:f.accounts.alpha,body:{status:'shipped',trackingNumber:'FAKE'}})).status,409);
  const detail=await tracking(id);assert.equal(detail.order.payment_status,'unpaid');
  assert.equal(detail.fulfillmentStatus,'pending_payment');assert.equal(detail.shipments[0].trackingNumber,'');
  assert.equal((await f.pay(id)).status,200);await update(id);assert.equal((await tracking(id)).fulfillmentStatus,'shipped');
});

test('partially dispatched COD orders cannot be cancelled and restocked by the customer',async()=>{
  const id=await order([{id:'alpha-product',qty:1},{id:'beta-product',qty:1}]);await update(id);
  const before=(await f.pool.query('select id,stock from products order by id')).rows;
  const r=await f.api('/api/orders/'+id+'/cancel',{method:'POST',account:f.accounts.buyer});
  assert.equal(r.status,409);assert.match(r.data.error,/shipment/i);
  assert.deepEqual((await f.pool.query('select id,stock from products order by id')).rows,before);
  assert.equal((await f.pool.query('select status from orders where id=$1',[id])).rows[0].status,'placed');
  const cancellable=await order();assert.equal((await tracking(cancellable)).canCancel,true);
  assert.equal((await f.api('/api/orders/'+cancellable+'/cancel',{method:'POST',account:f.accounts.buyer})).status,200);
  const detail=await tracking(cancellable);assert.equal(detail.fulfillmentStatus,'cancelled');assert.equal(detail.canCancel,false);
});

test('terminal administrative status remains authoritative over historical shipment progress',async()=>{
  const id=await order();await update(id);
  for(const state of ['refunded','cancelled','delivered']){
    await f.pool.query('update orders set status=$2 where id=$1',[id,state]);
    const detail=await tracking(id);assert.equal(detail.fulfillmentStatus,state);
    assert.equal(detail.shipments[0].trackingNumber,'ALPHA-123');assert.equal(detail.canCancel,false);
  }
});
