import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {sellerFixture} from './seller-fixture.js';

let f;
before(async()=>{f=await sellerFixture();});
after(async()=>{await f?.close();});
const sellerReads = ['overview','products','orders','payouts'];

test('approved sellers use their existing login cookie for every seller read endpoint',async()=>{
  for(const name of ['alpha','beta']) for(const endpoint of sellerReads) {
    const result=await f.api(`/api/seller/${endpoint}`,{account:f.accounts[name]});
    assert.equal(result.status,200,`${name} ${endpoint}: ${JSON.stringify(result.data)}`);
  }
});
test('anonymous, invalid, revoked and expired sessions cannot access seller data',async()=>{
  for(const endpoint of sellerReads) assert.equal((await f.api(`/api/seller/${endpoint}`)).status,401);
  assert.equal((await f.api('/api/seller/products',{cookie:'nc_session=invalid'})).status,401);
  const token=f.accounts.beta.cookie.slice('nc_session='.length);
  const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  await f.pool.query('update sessions set revoked_at=now() where token_hash=$1',[tokenHash]);
  assert.equal((await f.api('/api/seller/products',{account:f.accounts.beta})).status,401);
  await f.pool.query("update sessions set revoked_at=null,expires_at=now()-interval '1 minute' where token_hash=$1",[tokenHash]);
  assert.equal((await f.api('/api/seller/products',{account:f.accounts.beta})).status,401);
  await f.pool.query("update sessions set expires_at=now()+interval '1 day' where token_hash=$1",[tokenHash]);
});
test('customers and pending, rejected or suspended sellers are denied with 403',async()=>{
  for(const name of ['buyer','pending','rejected','suspended']) for(const endpoint of sellerReads) {
    assert.equal((await f.api(`/api/seller/${endpoint}`,{account:f.accounts[name]})).status,403,`${name} ${endpoint}`);
  }
  await f.pool.query("update sellers set status='suspended' where id=$1",[f.accounts.beta.sellerId]);
  assert.equal((await f.api('/api/seller/products',{account:f.accounts.beta})).status,403);
  await f.pool.query("update sellers set status='approved' where id=$1",[f.accounts.beta.sellerId]);
});
test('seller product create/edit requires CSRF and enforces user ownership',async()=>{
  const body={title:'Seller test product',price:22,stock:8,cat:'Tech',image:'https://example.test/new.jpg',seller_id:f.accounts.beta.id};
  assert.equal((await f.api('/api/seller/products',{method:'POST',account:f.accounts.alpha,csrf:'wrong',body})).status,403);
  const created=await f.api('/api/seller/products',{method:'POST',account:f.accounts.alpha,body});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const product=(await f.pool.query('select * from products where id=$1',[created.data.id])).rows[0];
  assert.equal(product.seller_id,f.accounts.alpha.id);
  assert.notEqual(product.seller_id,f.accounts.alpha.sellerId);
  const path='/api/seller/products/'+created.data.id;
  assert.equal((await f.api(path,{method:'PATCH',account:f.accounts.alpha,body:{price:24}})).status,200);
  assert.equal((await f.api(path,{method:'PATCH',account:f.accounts.beta,body:{price:1}})).status,404);
  const listed=await f.api('/api/seller/products',{account:f.accounts.beta});
  assert.ok(listed.data.products.every(p=>p.seller_id===f.accounts.beta.id));
});
test('public seller catalogs resolve products using the owner user ID',async()=>{
  for(const name of ['alpha','beta']) {
    const result=await f.api('/api/sellers/'+name);
    assert.equal(result.status,200);
    assert.ok(result.data.products.some(p=>p.id===name+'-product'));
    assert.ok(!result.data.products.some(p=>p.id===(name==='alpha'?'beta':'alpha')+'-product'));
  }
  assert.equal((await f.api('/api/sellers/suspended')).status,404);
});
test('mixed COD checkout assigns seller profiles and keeps order-item owner IDs',async()=>{
  const result=await f.checkout([{id:'alpha-product',qty:2},{id:'alpha-product',variantId:'alpha-variant',qty:1},{id:'beta-product',qty:1},{id:'platform-product',qty:1}]);
  assert.equal(result.status,200,JSON.stringify(result.data));
  const id=result.data.orderId;
  const rows=(await f.pool.query('select * from seller_orders where order_id=$1',[id])).rows;
  assert.equal(rows.length,2);
  for(const [name,gross] of [['alpha',80],['beta',40]]) {
    const sellerOrder=rows.find(row=>row.seller_id===f.accounts[name].sellerId);
    assert.ok(sellerOrder);
    assert.equal(Number(sellerOrder.subtotal),gross);
    assert.equal(Number(sellerOrder.seller_net),gross*0.9);
    assert.equal(sellerOrder.status,'placed');
    const visible=await f.api('/api/seller/orders',{account:f.accounts[name]});
    assert.ok(visible.data.orders.some(o=>o.order_id===id));
    assert.ok(visible.data.orders.every(o=>o.seller_id===f.accounts[name].sellerId));
  }
  const items=(await f.pool.query('select product_id,seller_id from order_items where order_id=$1',[id])).rows;
  for(const item of items) assert.equal(item.seller_id,item.product_id==='platform-product'?null:f.accounts[item.product_id.split('-')[0]].id);
});
test('seller orders accept their owner updates and reject another seller or missing CSRF',async()=>{
  const checkout=await f.checkout([{id:'alpha-product',qty:1}]);
  assert.equal(checkout.status,200,JSON.stringify(checkout.data));
  const path='/api/seller/orders/'+checkout.data.orderId;
  const body={status:'processing',trackingNumber:'TEST-1',courier:'Test Courier'};
  assert.equal((await f.api(path,{method:'PATCH',account:f.accounts.alpha,csrf:'wrong',body})).status,403);
  assert.equal((await f.api(path,{method:'PATCH',account:f.accounts.beta,body})).status,404);
  assert.equal((await f.api(path,{method:'PATCH',account:f.accounts.alpha,body})).status,200);
  const row=(await f.pool.query('select * from seller_orders where order_id=$1',[checkout.data.orderId])).rows[0];
  assert.equal(row.status,'processing');
  assert.equal(row.tracking_number,'TEST-1');
});
test('seller card checkout still confirms payment through a signed Stripe webhook',async()=>{
  const result=await f.checkout([{id:'alpha-product',qty:1},{id:'beta-product',qty:1}],'stripe');
  assert.equal(result.status,200,JSON.stringify(result.data));
  assert.equal((await f.pay(result.data.id)).status,200);
  const order=(await f.pool.query('select payment_status from orders where id=$1',[result.data.id])).rows[0];
  assert.equal(order.payment_status,'paid');
  const sellers=(await f.pool.query('select status,seller_id from seller_orders where order_id=$1',[result.data.id])).rows;
  assert.equal(sellers.length,2);
  assert.ok(sellers.every(row=>row.status==='paid'));
});
test('unavailable or missing seller profiles reject checkout and roll back order and inventory',async()=>{
  for(const product of ['pending-product','suspended-product','orphan-product']) {
    const key=crypto.randomUUID();
    const before=(await f.pool.query('select id,stock from products order by id')).rows;
    const result=await f.checkout([{id:'platform-product',qty:1},{id:product,qty:1}],'cod',key);
    assert.equal(result.status,400);
    assert.match(result.data.error,/seller.*unavailable/i);
    assert.equal((await f.pool.query('select id from orders where idempotency_key=$1',[key])).rowCount,0);
    assert.deepEqual((await f.pool.query('select id,stock from products order by id')).rows,before);
  }
});
test('signature CSS and JS are served with correct MIME types and exact content',async()=>{
  for(const [file,type] of [['signature-ui.css',/^text\/css/],['signature-ui.js',/^(text|application)\/javascript/]]) {
    const response=await fetch(f.base+'/'+file);
    assert.equal(response.status,200,file);
    assert.match(response.headers.get('content-type'),type);
    assert.equal(await response.text(),await fs.readFile(new URL('../'+file,import.meta.url),'utf8'));
  }
});
test('customer pages reference the signature assets and allow their Google Fonts stylesheet',async()=>{
  for(const page of ['index.html','product.html','login.html','seller.html','account.html','orders.html','support.html']) {
    const response=await fetch(f.base+'/'+page);
    assert.equal(response.status,200);
    const html=await response.text();
    assert.match(html,/href="\/?signature-ui\.css"/);
    assert.match(html,/src="\/?signature-ui\.js"/);
    assert.match(response.headers.get('content-security-policy'),/style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  }
});
test('serving signature assets does not expose server files or dependency sources',async()=>{
  for(const file of ['server.js','schema.sql','package.json','.env','node_modules/stripe/package.json']) {
    assert.equal((await fetch(f.base+'/'+file)).status,404,file);
  }
});
