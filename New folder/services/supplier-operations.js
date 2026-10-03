import crypto from 'node:crypto';
import {IntegrationError,enabled} from './provider-http.js';
export const supplierView=row=>({id:row.id,orderId:row.order_id,provider:row.provider,status:row.status,externalIds:row.external_ids,reference:row.reference,message:row.message,updatedAt:row.updated_at,fulfillmentStatus:row.fulfillment_status,supplierPaymentStatus:row.supplier_payment_status,cancelStatus:row.cancel_status,packages:row.packages,lastSyncAt:row.last_sync_at,nextSyncAt:row.next_sync_at,syncError:row.sync_error,providerState:row.provider_state});
export function registerSupplierOperations({app,pool,env,adapters,adminOnly,endpoint,audit,saveProduct}){
 const auto=enabled(env.SUPPLIER_AUTO_SYNC),pollSeconds=300;let running=false;
 async function syncOrder(id,actor=null){
  const token=crypto.randomUUID();
  const row=(await pool.query(`update supplier_orders set sync_token=$2,sync_until=now()+interval '10 minutes' where id::text=$1 and status in ('submitted','unknown','submitting') and (status!='submitting' or updated_at<now()-interval '2 minutes') and (sync_until is null or sync_until<now()) returning *`,[id,token])).rows[0];
  if(!row)throw new IntegrationError('Shipment is missing, not submitted, or another sync is in progress.',409);
  try{
   const result=await adapters.orderStatus(row),client=await pool.connect();let saved;
   try{
    await client.query('begin');const current=(await client.query('select * from supplier_orders where id=$1 and sync_token=$2 for update',[row.id,token])).rows[0];
    if(!current)throw new IntegrationError('A newer sync superseded this response.',409);
    // Do not erase known package history when a provider temporarily omits it.
    const map=new Map((current.packages||[]).map(p=>[p.key,p]));const rank={pending:0,processing:1,partially_shipped:2,shipped:3,delivered:4};
    for(const p of result.packages){const old=map.get(p.key);map.set(p.key,old&&(rank[old.status]??0)>(rank[p.status]??0)?{...p,status:old.status}:p);}
    let fulfillment=result.fulfillment;
    if((rank[current.fulfillment_status]??0)>(rank[fulfillment]??0)&&fulfillment!=='cancelled')fulfillment=current.fulfillment_status;
    if(current.fulfillment_status==='delivered')fulfillment='delivered';
    if(current.fulfillment_status==='cancelled'&&!['shipped','partially_shipped','delivered'].includes(result.fulfillment))fulfillment='cancelled';
    if(fulfillment==='cancelled'&&[...map.values()].some(p=>['shipped','delivered'].includes(p.status)))fulfillment='partially_shipped';
    const cancellation=result.cancel||current.cancel_status;
    const error=current.cancel_status==='confirmed'&&['shipped','partially_shipped','delivered'].includes(result.fulfillment)?'Provider reports shipment after recorded cancellation. Review provider account.':(result.warnings||[]).join(' ');
    saved=(await client.query(`update supplier_orders set status='submitted',external_ids=$3,fulfillment_status=$4,supplier_payment_status=$5,cancel_status=$6,packages=$7,provider_state=$8,last_sync_at=now(),next_sync_at=now()+interval '5 minutes',sync_error=$9,sync_attempts=0,sync_token=null,sync_until=null,updated_at=now() where id=$1 and sync_token=$2 returning *`,[row.id,token,JSON.stringify(result.externalIds),fulfillment,result.payment,cancellation,JSON.stringify([...map.values()]),JSON.stringify(result.states),error])).rows[0];
    await client.query('commit');
   }catch(e){await client.query('rollback');throw e;}finally{client.release();}
   await audit(actor,'supplier_tracking_sync','order',row.order_id,{provider:row.provider,fulfillment:saved.fulfillment_status,payment:result.payment});return supplierView(saved);
  }catch(e){
   await pool.query(`update supplier_orders set sync_error=$3,sync_attempts=sync_attempts+1,next_sync_at=now()+least(3600,60*power(2,least(sync_attempts+1,6)))*interval '1 second',sync_token=null,sync_until=null where id=$1 and sync_token=$2`,[row.id,token,e instanceof IntegrationError?e.message:'Supplier status could not be verified.']);throw e;
  }
 }
 async function cancel(id,actor,confirm){
  if(confirm!==true)throw new IntegrationError('Confirm cancellation of this specific supplier shipment.',400);
  const c=await pool.connect();let row;
  try{await c.query('begin');row=(await c.query('select * from supplier_orders where id::text=$1 for update',[id])).rows[0];
   if(!row||row.status!=='submitted')throw new IntegrationError('Only a provider-accepted shipment can be cancelled here.',409);
   if(!['none'].includes(row.cancel_status)){await c.query('commit');return {duplicate:true,...supplierView(row)};}
   if(['shipped','delivered','partially_shipped'].includes(row.fulfillment_status))throw new IntegrationError('Shipment already started. Contact the provider for returns or interception.',409);
   adapters.ready(row.provider);
   await c.query("update supplier_orders set cancel_status=$2,cancel_requested_at=now(),next_sync_at=now(),updated_at=now() where id=$1",[row.id,row.provider==='amazon'?'submitting':'manual_required']);
   await c.query(`insert into audit_logs(actor_user_id,action,entity_type,entity_id,details) values($1,'supplier_cancel_intent','order',$2,$3)`,[actor,row.order_id,JSON.stringify({provider:row.provider,reference:row.reference})]);await c.query('commit');
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
  if(row.provider==='aliexpress')return {cancelStatus:'manual_required',message:'Cancellation task opened. Complete it in AliExpress, then sync status or record provider confirmation. No cancellation request was sent to AliExpress.'};
  try{const result=await adapters.cancelAmazon(row);await pool.query("update supplier_orders set cancel_status='requested',next_sync_at=now(),updated_at=now() where id=$1 and cancel_status='submitting'",[row.id]);return {cancelStatus:'requested',message:result.message};}
  catch{await pool.query("update supplier_orders set cancel_status='unknown',next_sync_at=now(),updated_at=now() where id=$1 and cancel_status='submitting'",[row.id]);throw new IntegrationError('Cancellation acceptance is unknown. Sync provider status before any further action; automatic resubmission is blocked.',502);}
 }
 app.post('/api/admin/supplier-orders/:id/sync',adminOnly,endpoint(async(req,res)=>res.json(await syncOrder(req.params.id,req.session.uid))));
 app.post('/api/admin/supplier-orders/:id/cancel',adminOnly,endpoint(async(req,res)=>res.json(await cancel(req.params.id,req.session.uid,req.body?.confirm))));
 app.post('/api/admin/supplier-orders/:id/cancel-review',adminOnly,endpoint(async(req,res)=>{
  const {outcome,evidence,providerChecked}=req.body||{};
  if(providerChecked!==true||!['confirmed','rejected'].includes(outcome)||typeof evidence!=='string'||evidence.trim().length<20||evidence.length>1000)throw new IntegrationError('Check the provider and record at least 20 characters of evidence.',400);
  const c=await pool.connect();try{await c.query('begin');const row=(await c.query('select * from supplier_orders where id::text=$1 for update',[req.params.id])).rows[0];
   if(!row||!['manual_required','requested','unknown','submitting'].includes(row.cancel_status))throw new IntegrationError('No unresolved cancellation task.',409);
   if(row.cancel_status==='submitting'&&Date.now()-new Date(row.cancel_requested_at)<120000)throw new IntegrationError('Wait for the in-flight cancellation request.',409);
   if(outcome==='confirmed'&&(row.fulfillment_status==='delivered'||(row.packages||[]).some(p=>['shipped','delivered'].includes(p.status))))throw new IntegrationError('Shipment already started. Resolve return/interception in the provider account.',409);
   await c.query(`update supplier_orders set cancel_status=$2,fulfillment_status=case when $2='confirmed' then 'cancelled' else fulfillment_status end,updated_at=now() where id=$1`,[row.id,outcome]);
   await c.query(`insert into audit_logs(actor_user_id,action,entity_type,entity_id,details) values($1,'supplier_cancel_manual_review','order',$2,$3)`,[req.session.uid,row.order_id,JSON.stringify({provider:row.provider,outcome,evidence:evidence.trim(),source:'administrator_provider_check'})]);await c.query('commit');res.json({manualVerification:true,message:'Provider check recorded. Customer payment/refund is unchanged.'});
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }));
 app.post('/api/admin/suppliers/:provider/check',adminOnly,endpoint(async(req,res)=>{
  // Non-mutating provider probe using an exact merchant-owned product selection.
  const p=await adapters.product(req.params.provider,req.body||{});
  await audit(req.session.uid,'supplier_read_probe','supplier',req.params.provider,{externalId:p.externalId,country:p.country});
  res.json({readVerified:true,checkedAt:new Date().toISOString(),product:{title:p.title,stock:p.stock,currency:p.currency},message:'Product read permission verified now. This does not verify order creation, payment or cancellation permissions.'});
 }));
 async function runSync(){
  if(!auto||running)return {enabled:auto,skipped:true};running=true;let orders=0,products=0,failed=0;
  try{
   const rows=(await pool.query("select id from supplier_orders where status in ('submitted','unknown','submitting') and next_sync_at<=now() and (sync_until is null or sync_until<now()) and fulfillment_status not in ('cancelled','delivered') order by next_sync_at limit 5")).rows;
   for(const row of rows){try{await syncOrder(String(row.id));orders++;}catch{failed++;}}
   const sources=(await pool.query('select id from supplier_products where next_sync_at<=now() and (sync_until is null or sync_until<now()) order by next_sync_at limit 3')).rows;
   for(const r of sources){const token=crypto.randomUUID(),s=(await pool.query("update supplier_products set sync_token=$2,sync_until=now()+interval '5 minutes' where id=$1 and (sync_until is null or sync_until<now()) returning *",[r.id,token])).rows[0];if(!s)continue;
    try{await saveProduct(s.provider,{externalId:s.external_id,externalSku:s.external_sku,country:s.country,logisticsService:s.logistics_service},{},null);await pool.query("update supplier_products set sync_token=null,sync_until=null,sync_error='',next_sync_at=now()+interval '6 hours' where id=$1 and sync_token=$2",[s.id,token]);products++;}
    catch{await pool.query("update supplier_products set sync_token=null,sync_until=null,sync_error='Stock refresh failed. Check provider access.',next_sync_at=now()+interval '15 minutes' where id=$1 and sync_token=$2",[s.id,token]);failed++;}
   }
   return {enabled:true,orders,products,failed};
  }finally{running=false;}
 }
 return {runSync,automation:{enabled:auto,pollSeconds,stockIntervalHours:6,paymentAutomation:false,forwardingRequiresReview:true}};
}
