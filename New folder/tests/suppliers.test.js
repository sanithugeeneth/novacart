import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {sellerFixture} from './seller-fixture.js';
import {json} from './integration-fixture.js';
import {aliSignature} from '../services/supplier-adapters.js';

const env={ENABLE_AMAZON_SYNC:'true',ENABLE_AMAZON_FORWARDING:'true',AMAZON_LWA_CLIENT_ID:'lwa-client',AMAZON_LWA_CLIENT_SECRET:'lwa-secret',AMAZON_REFRESH_TOKEN:'lwa-refresh',AMAZON_MARKETPLACE_ID:'market',ENABLE_ALIEXPRESS_SYNC:'true',ENABLE_ALIEXPRESS_FORWARDING:'true',ALIEXPRESS_APP_KEY:'ali-app',ALIEXPRESS_APP_SECRET:'ali-secret',ALIEXPRESS_ACCESS_TOKEN:'ali-token'};
const amazonSelection={externalId:'B012345678',externalSku:'NOVACART-SKU',country:'LK',retailPrice:49,category:'Tech',publish:true};
const aliSelection={externalId:'10050012345678',externalSku:'14:193',country:'LK',logisticsService:'TEST_SERVICE',retailPrice:30,category:'Home',publish:true};
async function fixture(t,overrides={}) {
  const state={stock:10,requests:[],forwards:[],timeout:false,aliCurrency:'USD',confirmed:new Map()};
  const f=await sellerFixture({env:{...env,...overrides},providerFetch:async(url,opt={})=>{
    state.requests.push({url,opt});
    if(url==='https://api.amazon.com/auth/o2/token')return json({access_token:'temporary-lwa-token',expires_in:3600});
    if(url.includes('/catalog/'))return json({asin:'B012345678',summaries:[{marketplaceId:'market',itemName:'Provider Headphones',brand:'Fixture'}],images:[{marketplaceId:'market',images:[{variant:'MAIN',link:'https://images.example.test/headphones.jpg'}]}]});
    if(url.includes('/inventory/'))return json({payload:{inventorySummaries:[{asin:'B012345678',sellerSku:'NOVACART-SKU',inventoryDetails:{fulfillableQuantity:state.stock}}]}});
    if(url.endsWith('/fulfillmentOrders')&&opt.method==='POST'){
      const p=JSON.parse(opt.body);state.forwards.push(p);state.confirmed.set(p.sellerFulfillmentOrderId,p);if(state.timeout)throw new Error('Connection lost after provider acceptance');return json({});
    }
    if(url.includes('/fulfillmentOrders/')&&!opt.method){const id=decodeURIComponent(url.split('/').at(-1)),p=state.confirmed.get(id);return json({payload:{fulfillmentOrder:{sellerFulfillmentOrderId:id,fulfillmentOrderStatus:'Processing'},fulfillmentOrderItems:p?.items||[]}});}
    if(url==='https://api-sg.aliexpress.com/sync'||url==='https://eco.taobao.com/router/rest') {
      const fields=Object.fromEntries(new URLSearchParams(opt.body));const input=Object.keys(fields).filter(k=>k!=='sign').sort().map(k=>k+fields[k]).join('');
      assert.equal(fields.sign,crypto.createHmac(fields.sign_method==='hmac'?'md5':'sha256','ali-secret').update(input).digest('hex').toUpperCase());assert.equal(fields.session,'ali-token');
      if(fields.method==='aliexpress.ds.product.get')return json({aliexpress_ds_product_get_response:{result:{ae_item_base_info_dto:{subject:'Provider Lamp',currency_code:state.aliCurrency,product_status_type:'onSelling',detail:'<p>Desk lamp</p>'},ae_item_sku_info_dtos:{ae_item_sku_info_d_t_o:[{id:'14:193',sku_id:'123',sku_available_stock:state.stock,offer_sale_price:'12.50',currency_code:state.aliCurrency}]},ae_multimedia_info_dto:{image_urls:'https://images.example.test/lamp.jpg'}}}});
      if(fields.method==='aliexpress.trade.buy.placeorder'){state.forwards.push(JSON.parse(fields.param_place_order_request4_open_api_d_t_o));if(state.timeout)throw new Error('Unknown outcome');return json({aliexpress_trade_buy_placeorder_response:{result:{is_success:true,order_list:{number:['9000000000123']}}}});}
    }
    throw new Error('Unexpected provider request: '+url);
  }});t.after(()=>f.close());
  const admin=f.accounts.orphan;await f.pool.query('update users set is_admin=true where id=$1',[admin.id]);
  const post=(path,body={},account=admin)=>f.api(path,{method:'POST',body,account});
  async function imported(provider='amazon',selection=provider==='amazon'?amazonSelection:aliSelection){const r=await post('/api/admin/suppliers/'+provider+'/import',selection);assert.equal(r.status,201,JSON.stringify(r.data));return r.data.productId;}
  async function order(provider='amazon',paid=true){const id=await imported(provider),checkout=await f.checkout([{id,qty:2}],'stripe');assert.equal(checkout.status,200,JSON.stringify(checkout.data));const oid=checkout.data.id;if(paid)assert.equal((await f.pay(oid)).status,200);return {id,oid};}
  const preview=(provider,oid)=>post(`/api/admin/suppliers/${provider}/orders/${oid}/preview`);
  const forward=(provider,oid,previewId)=>post(`/api/admin/suppliers/${provider}/orders/${oid}/forward`,{previewId,confirm:true});
  return {...f,state,admin,post,imported,order,preview,forward};
}
test('supplier operations require administrator authorization and CSRF; config never exposes provider secrets',async t=>{
  const f=await fixture(t);assert.equal((await f.api('/api/admin/suppliers')).status,401);assert.equal((await f.api('/api/admin/suppliers',{account:f.accounts.buyer})).status,403);
  assert.equal((await f.api('/api/admin/suppliers/amazon/import',{method:'POST',body:amazonSelection,account:f.admin,csrf:null})).status,403);
  const r=await f.api('/api/admin/suppliers',{account:f.admin});assert.equal(r.status,200);for(const secret of ['lwa-secret','ali-secret','ali-token','lwa-refresh'])assert.ok(!JSON.stringify(r.data).includes(secret));assert.equal(f.state.requests.length,0);
});
test('Amazon import and stock sync preserve retail price, original mappings and local reservations',async t=>{
  const f=await fixture(t),{id,oid}=await f.order('amazon',false);
  const mapping=(await f.pool.query('select * from supplier_products where product_id=$1',[id])).rows[0];
  assert.equal((await f.pool.query('select stock from products where id=$1',[id])).rows[0].stock,8);
  assert.equal((await f.post('/api/admin/supplier-products/'+mapping.id+'/sync')).status,200);
  let p=(await f.pool.query('select * from products where id=$1',[id])).rows[0];assert.equal(p.stock,8);assert.equal(Number(p.price),49);assert.equal(p.rating,'0.00');
  f.state.stock=1;assert.equal((await f.post('/api/admin/supplier-products/'+mapping.id+'/sync')).status,200);p=(await f.pool.query('select * from products where id=$1',[id])).rows[0];assert.equal(p.stock,0);
  assert.equal((await f.post('/api/admin/suppliers/amazon/import',{...amazonSelection,country:'US'})).status,409);
  const snapshot=(await f.pool.query('select supplier_snapshot from order_items where order_id=$1',[oid])).rows[0].supplier_snapshot;assert.equal(snapshot.externalSku,amazonSelection.externalSku);assert.equal(snapshot.provider,'amazon');
});
test('supplier checkout rejects COD, stale stock and unsupported destination before creating an order',async t=>{
  const f=await fixture(t),id=await f.imported();
  assert.equal((await f.checkout([{id,qty:1}],'cod')).status,400);
  await f.pool.query("update supplier_products set country='US' where product_id=$1",[id]);assert.equal((await f.checkout([{id,qty:1}],'stripe')).status,400);
  await f.pool.query("update supplier_products set country='LK',last_synced_at=now()-interval '25 hours' where product_id=$1",[id]);assert.equal((await f.checkout([{id,qty:1}],'stripe')).status,400);
  assert.equal((await f.pool.query('select * from orders')).rowCount,0);assert.equal((await f.pool.query('select stock from products where id=$1',[id])).rows[0].stock,10);
});
test('unpaid orders cannot forward; a paid order is reviewed and submitted exactly once, including concurrent clicks',async t=>{
  const f=await fixture(t),{oid}=await f.order('amazon',false);
  assert.equal((await f.preview('amazon',oid)).status,409);assert.equal(f.state.forwards.length,0);
  assert.equal((await f.pay(oid)).status,200);const preview=await f.preview('amazon',oid);assert.equal(preview.status,200);assert.equal(preview.data.items[0].qty,2);
  const results=await Promise.all([f.forward('amazon',oid,preview.data.previewId),f.forward('amazon',oid,preview.data.previewId)]);assert.ok(results.some(r=>r.status===200));assert.equal(f.state.forwards.length,1);
  const repeat=await f.forward('amazon',oid,preview.data.previewId);assert.equal(repeat.status,200);assert.equal(repeat.data.duplicate,true);assert.equal(f.state.forwards.length,1);
  const body=f.state.forwards[0];assert.equal(body.destinationAddress.countryCode,'LK');assert.equal(body.items[0].sellerSku,'NOVACART-SKU');assert.equal(body.fulfillmentPolicy,'FillOrKill');assert.ok(body.sellerFulfillmentOrderId.length<=40);
  const ledger=(await f.pool.query('select * from supplier_orders')).rows;assert.equal(ledger.length,1);assert.equal(ledger[0].status,'submitted');
});
test('changed addresses, expired previews and refunds invalidate fulfillment approval',async t=>{
  const f=await fixture(t),{oid}=await f.order();let p=await f.preview('amazon',oid);
  await f.pool.query("update orders set shipping_address=jsonb_set(shipping_address,'{city}','\"Kandy\"') where id=$1",[oid]);assert.equal((await f.forward('amazon',oid,p.data.previewId)).status,409);
  p=await f.preview('amazon',oid);await f.pool.query("update supplier_orders set expires_at=now()-interval '1 second'");assert.equal((await f.forward('amazon',oid,p.data.previewId)).status,409);
  p=await f.preview('amazon',oid);await f.pool.query("update orders set payment_status='partially_refunded' where id=$1",[oid]);assert.equal((await f.forward('amazon',oid,p.data.previewId)).status,409);assert.equal(f.state.forwards.length,0);
});
test('unknown Amazon acceptance is locked and reconciled by its stable provider reference without another POST',async t=>{
  const f=await fixture(t),{oid}=await f.order(),p=await f.preview('amazon',oid);f.state.timeout=true;
  assert.equal((await f.forward('amazon',oid,p.data.previewId)).status,502);assert.equal((await f.forward('amazon',oid,p.data.previewId)).status,409);assert.equal((await f.preview('amazon',oid)).status,409);assert.equal(f.state.forwards.length,1);
  const row=(await f.pool.query('select * from supplier_orders')).rows[0];assert.equal(row.status,'unknown');const reconciliation=await f.post('/api/admin/supplier-orders/'+row.id+'/reconcile');assert.equal(reconciliation.status,200);assert.equal(f.state.forwards.length,1);assert.equal((await f.pool.query('select status from supplier_orders')).rows[0].status,'submitted');
});
test('AliExpress uses signed product and order requests, exact SKU attributes and separate supplier-payment status',async t=>{
  const f=await fixture(t),{id,oid}=await f.order('aliexpress');
  assert.equal(Number((await f.pool.query('select cost_price from products where id=$1',[id])).rows[0].cost_price),12.5);
  const p=await f.preview('aliexpress',oid);assert.equal(p.status,200);const result=await f.forward('aliexpress',oid,p.data.previewId);assert.equal(result.status,200);assert.deepEqual(result.data.externalIds,['9000000000123']);assert.match(result.data.message,/payment/i);
  assert.equal(f.state.forwards[0].product_items[0].sku_attr,'14:193');assert.equal(f.state.forwards[0].product_items[0].logistics_service_name,'TEST_SERVICE');assert.equal(f.state.forwards[0].logistics_address.contact_person,'Test Buyer');
  assert.equal((await f.forward('aliexpress',oid,p.data.previewId)).data.duplicate,true);assert.equal(f.state.forwards.length,1);
});
test('AliExpress currency mismatches reject import and unknown acceptance never retries automatically',async t=>{
  const f=await fixture(t);f.state.aliCurrency='EUR';assert.equal((await f.post('/api/admin/suppliers/aliexpress/import',aliSelection)).status,502);assert.equal((await f.pool.query('select * from supplier_products')).rowCount,0);
  f.state.aliCurrency='USD';const {oid}=await f.order('aliexpress'),p=await f.preview('aliexpress',oid);f.state.timeout=true;assert.equal((await f.forward('aliexpress',oid,p.data.previewId)).status,502);assert.equal((await f.forward('aliexpress',oid,p.data.previewId)).status,409);assert.equal(f.state.forwards.length,1);
});
test('AliExpress TOP mode uses its documented HMAC protocol and newly imported products can stay drafts',async t=>{
  const f=await fixture(t,{ALIEXPRESS_PROTOCOL:'top'});const id=await f.imported('aliexpress',{...aliSelection,publish:false});assert.equal((await f.pool.query('select active from products where id=$1',[id])).rows[0].active,false);
  assert.ok(f.state.requests.some(r=>r.url==='https://eco.taobao.com/router/rest'));assert.equal(aliSignature({b:'2',a:'1'},'secret','top'),crypto.createHmac('md5','secret').update('a1b2').digest('hex').toUpperCase());
});
test('manual supplier resolution requires a settled request, provider-check confirmation and recorded evidence',async t=>{
  const f=await fixture(t),{oid}=await f.order('aliexpress'),p=await f.preview('aliexpress',oid);f.state.timeout=true;
  await f.forward('aliexpress',oid,p.data.previewId);const row=(await f.pool.query('select * from supplier_orders')).rows[0];
  const route='/api/admin/supplier-orders/'+row.id+'/resolve',body={outcome:'accepted',providerChecked:true,evidence:'Supplier support confirmed the exact order reference.',externalIds:['9000000000123']};
  assert.equal((await f.post(route,body)).status,409);
  await f.pool.query("update supplier_orders set updated_at=now()-interval '3 minutes' where id=$1",[row.id]);
  assert.equal((await f.post(route,{...body,providerChecked:false})).status,400);
  assert.equal((await f.post(route,body)).status,200);assert.equal((await f.forward('aliexpress',oid,p.data.previewId)).data.duplicate,true);assert.equal(f.state.forwards.length,1);
  const evidence=(await f.pool.query("select details from audit_logs where action='supplier_manual_resolution'")).rows[0].details;assert.equal(evidence.outcome,'accepted');assert.equal(evidence.evidence,body.evidence);
});
test('a provider-confirmed rejection requires a new preview and retains a durable resolution audit',async t=>{
  const f=await fixture(t),{oid}=await f.order(),p=await f.preview('amazon',oid);f.state.timeout=true;await f.forward('amazon',oid,p.data.previewId);
  const row=(await f.pool.query('select * from supplier_orders')).rows[0];await f.pool.query("update supplier_orders set updated_at=now()-interval '3 minutes' where id=$1",[row.id]);
  const resolved=await f.post('/api/admin/supplier-orders/'+row.id+'/resolve',{outcome:'not_created',providerChecked:true,evidence:'Provider support verified no fulfillment was created; case TEST-123.'});assert.equal(resolved.status,200);
  assert.equal((await f.forward('amazon',oid,p.data.previewId)).status,409);const fresh=await f.preview('amazon',oid);assert.equal(fresh.status,200);assert.notEqual(fresh.data.previewId,p.data.previewId);assert.equal(fresh.data.reference,p.data.reference);assert.equal((await f.pool.query("select * from audit_logs where action='supplier_manual_resolution'")).rowCount,1);
});
