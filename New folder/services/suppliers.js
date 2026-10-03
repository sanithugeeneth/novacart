import {registerSupplierOperations,supplierView} from './supplier-operations.js';
import crypto from 'node:crypto';
import {IntegrationError} from './provider-http.js';
import {supplierAdapters} from './supplier-adapters.js';

const fingerprint=body=>crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
const reference=(order,provider)=>'NC'+fingerprint(provider+':'+order).slice(0,32);
const uid=()=>crypto.randomUUID();
const snapshot=m=>({provider:m.provider,externalId:m.external_id,externalSku:m.external_sku,country:m.country,marketplace:m.marketplace,logisticsService:m.logistics_service});
const publicOrder=supplierView;

// Imported supplier SKUs are single-SKU local products. Local variants cannot silently
// change the external item, country, or shipping service chosen at checkout.
export async function supplierCheckout(client,items,country,paymentMethod,env) {
  const adapters=supplierAdapters(env);
  for(const item of items) {
    const result=await client.query(`select s.* from supplier_products s join products p on p.id=s.product_id where s.product_id=$1 for update of p`,[item.productId]);
    if(!result.rowCount)continue;
    const source=result.rows[0];adapters.ready(source.provider,true);
    if(item.variantId)throw new Error('Supplier products must use their original SKU.');
    if(paymentMethod!=='stripe')throw new Error('Supplier items require card payment before fulfillment.');
    if(country!==source.country)throw new Error('A supplier item is not available for this delivery country.');
    if(source.provider==='aliexpress'&&!source.logistics_service)throw new Error('Supplier delivery service is not configured.');
    if(Date.now()-new Date(source.last_synced_at).getTime()>24*3600000)throw new Error('Supplier stock needs to be refreshed. Please contact support.');
    item.supplierSnapshot=snapshot(source);
  }
}

export function registerSuppliers({app,pool,env,adminOnly,csrfOk,audit,fetcher=fetch}) {
  const adapters=supplierAdapters(env,fetcher);
  const endpoint=(fn,mutate=true)=>async(req,res)=>{
    if(mutate&&!csrfOk(req))return res.status(403).json({error:'Invalid CSRF token.'});
    try{await fn(req,res);}catch(error){res.status(error.status||503).json({error:error instanceof IntegrationError?error.message:'Supplier operation could not be completed.'});}
  };
  async function saveProduct(provider,selection,options,actor) {
    const data=await adapters.product(provider,selection);
    const id='sup-'+provider+'-'+fingerprint(data.externalId+':'+data.externalSku).slice(0,20);
    const client=await pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))',[id]);
      const existing=(await client.query('select * from supplier_products where product_id=$1 for update',[id])).rows[0];
      if(existing&&(existing.country!==data.country||existing.marketplace!==data.marketplace))throw new IntegrationError('This SKU already has a different destination or marketplace. Keep its existing mapping.',409);
      let price=Number(options.retailPrice),category=String(options.category||'Other').trim().slice(0,60);
      if(!existing&&(!Number.isFinite(price)||price<=0||price>9999999))throw new IntegrationError('Set a valid retail price before importing.',400);
      if(!existing)await client.query(`insert into products(id,slug,sku,cat,title,price,rating,reviews,image,stock,description,currency,cost_price,brand,active) values($1,$1,$1,$2,$3,$4,0,0,$5,0,$6,$7,$8,$9,$10)`,[id,category,data.title,Math.round(price*100)/100,data.image,data.description,data.currency,data.cost||0,data.brand,options.publish===true]);
      const current=(await client.query('select stock from products where id=$1 for update',[id])).rows[0];
      // Conservatively reserve all outstanding local orders even if the supplier
      // may already have deducted them; this never restores reserved stock.
      const reserved=await client.query(`select coalesce(sum(oi.qty),0)::int as qty from order_items oi join orders o on o.id=oi.order_id where oi.product_id=$1 and o.inventory_released=false and o.status not in ('cancelled','payment_failed','payment_expired','refunded','delivered')`,[id]);
      const available=Math.max(0,data.stock-Number(reserved.rows[0].qty));
      await client.query(`update products set title=$2,image=$3,description=$4,brand=$5,stock=$6,cost_price=coalesce($7,cost_price),updated_at=now() where id=$1`,[id,data.title,data.image,data.description,data.brand,available,data.cost]);
      await client.query('delete from product_images where product_id=$1',[id]);
      for(let n=0;n<data.images.length;n++)await client.query('insert into product_images(product_id,url,alt,sort_order) values($1,$2,$3,$4)',[id,data.images[n],data.title,n]);
      await client.query(`insert into supplier_products(id,provider,external_id,external_sku,product_id,country,marketplace,logistics_service,supplier_stock,supplier_cost,currency,last_synced_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()) on conflict(product_id) do update set supplier_stock=excluded.supplier_stock,supplier_cost=excluded.supplier_cost,currency=excluded.currency,last_synced_at=now()`,[uid(),provider,data.externalId,data.externalSku,id,data.country,data.marketplace,data.logisticsService,data.stock,data.cost,data.currency]);
      if(available!==current.stock)await client.query(`insert into inventory_movements(product_id,change_qty,reason,created_by) values($1,$2,'supplier_sync',$3)`,[id,available-current.stock,actor]);
      await client.query('commit');
      await audit(actor,existing?'supplier_sync':'supplier_import','product',id,{provider,externalId:data.externalId,externalSku:data.externalSku,available});
      return {productId:id,stock:available,sourceStock:data.stock,retailPricePreserved:Boolean(existing)};
    }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
  }
  async function orderData(client,id,provider) {
    const order=(await client.query('select * from orders where id=$1 for update',[id])).rows[0];
    if(!order)throw new IntegrationError('Order not found.',404);
    if(order.payment_status!=='paid'||!order.paid_at||!['paid','processing','packed'].includes(order.status)||order.inventory_released)throw new IntegrationError('Only paid, open orders with reserved inventory can be forwarded.',409);
    const refund=await client.query(`select id from refunds where order_id=$1 and status in ('pending','succeeded') limit 1`,[id]);
    const returns=await client.query(`select id from returns_requests where order_id=$1 and status not in ('rejected') limit 1`,[id]);
    if(refund.rowCount||returns.rowCount)throw new IntegrationError('Resolve the refund or return before supplier fulfillment.',409);
    const items=(await client.query(`select * from order_items where order_id=$1 and supplier_snapshot->>'provider'=$2 order by id`,[id,provider])).rows;
    if(!items.length)throw new IntegrationError('This order has no checkout-time mapping for this supplier.',409);
    return {order,items,body:adapters.payload(provider,order,items,reference(id,provider))};
  }
  const operations=registerSupplierOperations({app,pool,env,adapters,adminOnly,endpoint,audit,saveProduct});
  app.get('/api/admin/suppliers',adminOnly,endpoint(async(_req,res)=>{
    const products=await pool.query(`select s.*,p.title,p.price,p.stock,p.active from supplier_products s join products p on p.id=s.product_id order by s.last_synced_at desc limit 1000`);
    const orders=await pool.query('select * from supplier_orders order by updated_at desc limit 100');
    res.json({providers:adapters.statuses,automation:operations.automation,products:products.rows,orders:orders.rows.map(publicOrder)});
  },false));
  app.post('/api/admin/suppliers/:provider/product',adminOnly,endpoint(async(req,res)=>res.json({product:await adapters.product(req.params.provider,req.body||{})})));
  app.post('/api/admin/suppliers/:provider/import',adminOnly,endpoint(async(req,res)=>res.status(201).json(await saveProduct(req.params.provider,req.body||{},req.body||{},req.session.uid))));
  app.post('/api/admin/supplier-products/:id/sync',adminOnly,endpoint(async(req,res)=>{
    const source=(await pool.query('select * from supplier_products where id::text=$1',[req.params.id])).rows[0];
    if(!source)throw new IntegrationError('Supplier mapping not found.',404);
    res.json(await saveProduct(source.provider,{externalId:source.external_id,externalSku:source.external_sku,country:source.country,logisticsService:source.logistics_service},{},req.session.uid));
  }));
  app.post('/api/admin/suppliers/:provider/orders/:orderId/preview',adminOnly,endpoint(async(req,res)=>{
    const provider=req.params.provider;adapters.ready(provider,true);
    const client=await pool.connect();
    try{
      await client.query('begin');
      const data=await orderData(client,req.params.orderId,provider);
      const old=(await client.query('select * from supplier_orders where order_id=$1 and provider=$2 for update',[data.order.id,provider])).rows[0];
      if(old&&!['prepared','rejected'].includes(old.status))throw new IntegrationError('This shipment already has a submission record. Check the fulfillment ledger; do not create another supplier order.',409);
      const id=uid(),ref=reference(data.order.id,provider),hash=fingerprint(data.body);
      const result=await client.query(`insert into supplier_orders(id,order_id,provider,reference,status,request_hash,payload,expires_at,created_by) values($1,$2,$3,$4,'prepared',$5,$6,now()+interval '10 minutes',$7) on conflict(order_id,provider) do update set id=excluded.id,status='prepared',message='',request_hash=excluded.request_hash,payload=excluded.payload,expires_at=excluded.expires_at,updated_at=now() returning *`,[id,data.order.id,provider,ref,hash,JSON.stringify(data.body),req.session.uid]);
      await client.query('commit');
      res.json({previewId:result.rows[0].id,provider,orderId:data.order.id,reference:ref,expiresAt:result.rows[0].expires_at,items:data.items.map(i=>({title:i.title,qty:i.qty,sku:i.supplier_snapshot.externalSku})),address:data.order.shipping_address,phone:data.order.phone,message:provider==='amazon'?'Confirmation sends this order to Amazon MCF and may incur fulfillment charges.':'Confirmation creates an AliExpress supplier order. Supplier payment is completed separately in AliExpress.'});
    }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
  }));
  app.post('/api/admin/suppliers/:provider/orders/:orderId/forward',adminOnly,endpoint(async(req,res)=>{
    const provider=req.params.provider;adapters.ready(provider,true);
    if(req.body?.confirm!==true)throw new IntegrationError('Review the preview and explicitly confirm fulfillment.',400);
    const client=await pool.connect();let shipment;
    try{
      await client.query('begin');
      // The order row serializes competing preview, forwarding and refund actions.
      await client.query('select id from orders where id=$1 for update',[req.params.orderId]);
      shipment=(await client.query('select * from supplier_orders where order_id=$1 and provider=$2 for update',[req.params.orderId,provider])).rows[0];
      if(shipment?.status==='submitted'){await client.query('commit');return res.json({duplicate:true,...publicOrder(shipment)});}
      if(!shipment||shipment.id!==req.body.previewId||shipment.status!=='prepared'||new Date(shipment.expires_at).getTime()<=Date.now())throw new IntegrationError('A fresh, unsubmitted fulfillment preview is required. Unknown outcomes must be reconciled first.',409);
      const data=await orderData(client,req.params.orderId,provider);
      if(fingerprint(data.body)!==shipment.request_hash)throw new IntegrationError('Order details changed. Create a new preview.',409);
      await client.query(`update supplier_orders set status='submitting',updated_at=now(),message='Submission started. Do not resend.' where id=$1`,[shipment.id]);
      await client.query('commit');
    }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
    // Persist the intent BEFORE the network call. A timeout/crash never triggers a retry.
    try{
      const response=await adapters.forward(provider,shipment.payload);
      await pool.query(`update supplier_orders set status='submitted',external_ids=$2,message=$3,updated_at=now() where id=$1`,[shipment.id,JSON.stringify(response.externalIds),response.message]);
      await audit(req.session.uid,'supplier_forward','order',shipment.order_id,{provider,reference:shipment.reference,externalIds:response.externalIds});
      return res.json({...response,orderId:shipment.order_id,reference:shipment.reference});
    }catch(error){
      await pool.query(`update supplier_orders set status='unknown',message=$2,updated_at=now() where id=$1`,[shipment.id,'Acceptance was not confirmed. Verify the supplier account before any further action.']).catch(()=>{});
      throw new IntegrationError('Supplier acceptance is unconfirmed. This shipment is locked against duplicate submission. Check the fulfillment ledger.',502);
    }
  }));
  app.post('/api/admin/supplier-orders/:id/reconcile',adminOnly,endpoint(async(req,res)=>{
    const row=(await pool.query('select * from supplier_orders where id::text=$1',[req.params.id])).rows[0];
    if(!row)throw new IntegrationError('Shipment record not found.',404);
    if(!['unknown','submitted','submitting'].includes(row.status))throw new IntegrationError('This record has not been submitted.',409);
    if(row.status==='submitting'&&Date.now()-new Date(row.updated_at).getTime()<120000)throw new IntegrationError('A request may still be running. Check again in two minutes.',409);
    if(row.provider!=='amazon')throw new IntegrationError('Verify this reference in AliExpress and contact supplier support. Automatic resubmission is intentionally blocked when acceptance is unknown.',409);
    const result=await adapters.reconcileAmazon(row.reference,row.payload);
    await pool.query(`update supplier_orders set status='submitted',external_ids=$2,message=$3,updated_at=now() where id=$1`,[row.id,JSON.stringify(result.externalIds),result.message]);
    await audit(req.session.uid,'supplier_reconcile','order',row.order_id,{provider:row.provider,reference:row.reference});res.json(result);
  }));
  app.post('/api/admin/supplier-orders/:id/resolve',adminOnly,endpoint(async(req,res)=>{
    const {outcome,evidence,providerChecked,externalIds}=req.body||{};
    if(providerChecked!==true||!['accepted','not_created'].includes(outcome)||typeof evidence!=='string'||evidence.trim().length<20||evidence.length>1000)throw new IntegrationError('Confirm a provider-account check and record at least 20 characters of evidence.',400);
    if(outcome==='accepted'&&(!Array.isArray(externalIds)||!externalIds.length||externalIds.length>100||externalIds.some(x=>typeof x!=='string'||!/^[-\w]{3,80}$/.test(x))))throw new IntegrationError('Record the exact supplier order references.',400);
    const client=await pool.connect();
    try{
      await client.query('begin');
      const row=(await client.query('select * from supplier_orders where id::text=$1 for update',[req.params.id])).rows[0];
      if(!row||!['unknown','submitting'].includes(row.status))throw new IntegrationError('Only an unconfirmed submission can be manually resolved.',409);
      if(Date.now()-new Date(row.updated_at).getTime()<120000)throw new IntegrationError('Wait at least two minutes, then verify the final outcome with the provider.',409);
      const message=outcome==='accepted'?'Administrator verified provider acceptance.':'Administrator verified that no provider order was created. A new preview is required before retrying.';
      await client.query('update supplier_orders set status=$2,external_ids=$3,message=$4,updated_at=now() where id=$1',[row.id,outcome==='accepted'?'submitted':'rejected',JSON.stringify(outcome==='accepted'?externalIds:[]),message]);
      // Resolution evidence and the earlier payload hash survive any later preview.
      await client.query(`insert into audit_logs(actor_user_id,action,entity_type,entity_id,details) values($1,'supplier_manual_resolution','order',$2,$3)`,[req.session.uid,row.order_id,JSON.stringify({provider:row.provider,reference:row.reference,requestHash:row.request_hash,outcome,evidence:evidence.trim(),externalIds:outcome==='accepted'?externalIds:[]})]);
      await client.query('commit');res.json({message,manualVerification:true});
    }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
  }));
  return operations;
}
