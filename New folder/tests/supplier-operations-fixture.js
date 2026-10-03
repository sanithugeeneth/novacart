import assert from 'node:assert/strict';import crypto from 'node:crypto';import {sellerFixture} from './seller-fixture.js';import {json} from './integration-fixture.js';
const credentials={ENABLE_AMAZON_SYNC:'true',ENABLE_AMAZON_FORWARDING:'true',AMAZON_LWA_CLIENT_ID:'client',AMAZON_LWA_CLIENT_SECRET:'secret',AMAZON_REFRESH_TOKEN:'refresh',AMAZON_MARKETPLACE_ID:'market',ENABLE_ALIEXPRESS_SYNC:'true',ENABLE_ALIEXPRESS_FORWARDING:'true',ALIEXPRESS_APP_KEY:'app',ALIEXPRESS_APP_SECRET:'secret',ALIEXPRESS_ACCESS_TOKEN:'token'};
export async function operationsFixture(options={}){
 const state={missingPackage:false,delivery:'IN_TRANSIT',stock:10,amazon:'Processing',ali:'PLACE_ORDER_SUCCESS',logistics:'NO_LOGISTICS',packages:false,fail:false,cancels:0,cancelFail:false,reads:0,requests:[],wrong:false};let row;
 const f=await sellerFixture({env:{...credentials,...options.env},providerFetch:async(url,opt={})=>{
  state.requests.push({url,method:opt.method||'GET'});
  if(url==='https://api.amazon.com/auth/o2/token')return json({access_token:'test-token',expires_in:3600});
  if(url.includes('/cancel')){state.cancels++;if(state.cancelFail)throw Error('Lost response');return json({});}
  if(state.fail)throw Error('Provider unavailable');
  if(url.includes('/tracking?'))return json({payload:{packageNumber:1,trackingNumber:'TRACK-ONE',currentStatus:state.delivery}});
  if(url.includes('/catalog/'))return json({asin:'B012345678',summaries:[{marketplaceId:'market',itemName:'Supplier Fixture'}],images:[{marketplaceId:'market',images:[{variant:'MAIN',link:'https://example.test/supplier.jpg'}]}]});
  if(url.includes('/inventory/'))return json({payload:{inventorySummaries:[{asin:'B012345678',sellerSku:'SKU',inventoryDetails:{fulfillableQuantity:state.stock}}]}});
  if(url.includes('/fulfillmentOrders/')){state.reads++;return json({payload:{fulfillmentOrder:{sellerFulfillmentOrderId:state.wrong?'wrong':row.reference,fulfillmentOrderStatus:state.amazon},fulfillmentOrderItems:row.payload.items,fulfillmentShipments:state.packages?[{amazonShipmentId:'shipment-a',fulfillmentShipmentStatus:'Shipped',fulfillmentShipmentPackage:[{packageNumber:1,trackingNumber:'TRACK-ONE',carrierCode:'DHL'},...(state.missingPackage?[{packageNumber:2}]:[])]}]:[]}});}
  if(url.includes('/sync')||url.includes('/router/rest')){state.reads++;const p=Object.fromEntries(new URLSearchParams(opt.body));assert.equal(p.method,'aliexpress.ds.trade.order.get');assert.equal(p.order_id,'9000000000123');return json({aliexpress_ds_trade_order_get_response:{result:{order_status:state.ali,logistics_status:state.logistics,logistics_info_list:{ae_order_logistics_info:state.packages?[{logistics_no:'ALI-TRACK',logistics_service:'EMS'}]:[]}}}});}
  throw Error('Unexpected URL');
 }});
 const admin=f.accounts.orphan;await f.pool.query('update users set is_admin=true where id=$1',[admin.id]);
 const checkout=await f.checkout([{id:'platform-product',qty:2},{id:'alpha-product',qty:1}],'stripe');assert.equal(checkout.status,200);const oid=checkout.data.id;await f.pay(oid);
 const item=(await f.pool.query("select * from order_items where order_id=$1 and product_id='platform-product'",[oid])).rows[0];
 const provider=options.provider||'amazon',id=crypto.randomUUID(),reference='NC-SUPPLIER-FIXTURE';
 const payload={items:[{sellerSku:'SKU',sellerFulfillmentOrderItemId:String(item.id),quantity:2}]};
 await f.pool.query('update order_items set supplier_snapshot=$2 where id=$1',[item.id,JSON.stringify({provider,externalSku:'SKU',country:'LK'})]);
 await f.pool.query(`insert into supplier_orders(id,order_id,provider,reference,status,request_hash,payload,external_ids,expires_at) values($1,$2,$3,$4,'submitted','hash',$5,$6,now())`,[id,oid,provider,reference,JSON.stringify(payload),JSON.stringify(provider==='amazon'?[reference]:['9000000000123'])]);
 row={id,oid,provider,reference,payload};
 const post=(route,body={},account=admin)=>f.api(route,{method:'POST',body,account});
 const sync=()=>post('/api/admin/supplier-orders/'+id+'/sync');const cancel=(body={confirm:true})=>post('/api/admin/supplier-orders/'+id+'/cancel',body);
 const read=async()=>(await f.pool.query('select * from supplier_orders where id=$1',[id])).rows[0];
 return {...f,state,admin,row,post,sync,cancel,read};
}
