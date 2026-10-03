import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import Stripe from 'stripe';
import {database} from './database.js';
import {createApplication} from '../server.js';
let pool,application,server,base,adminId,customerId,adminCookie,customerCookie,customerCsrf;
const secret='whsec_local_regression_fixture';
const stripe=new Stripe('sk_test_local_fixture_only');
const sessions=new Map();let sequence=0,simulateOutage=false;
stripe.checkout.sessions.create=async payload=>{
 assert.equal(payload.expires_after,undefined);assert.ok(payload.expires_at>Date.now()/1000+1800);
 const session={...payload,id:'cs_fixture_'+(++sequence),currency:'usd',amount_total:payload.line_items.reduce((n,x)=>n+x.price_data.unit_amount*x.quantity,0),payment_status:'unpaid',payment_intent:'pi_fixture_'+sequence,status:'open',url:'https://checkout.stripe.com/test-fixture'};
 sessions.set(session.id,session);return session;
};
stripe.checkout.sessions.retrieve=async id=>{if(simulateOutage)throw new Error('Simulated provider outage');return sessions.get(id)};
stripe.checkout.sessions.expire=async id=>{const s=sessions.get(id);if(s.payment_status==='paid')throw new Error('Already paid');s.status='expired';return s;};
stripe.refunds.list=async()=>({data:[],has_more:false});
function otp(){const key=Buffer.from('48656c6c6f21deadbeef','hex'),b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const d=crypto.createHmac('sha1',key).update(b).digest();return String((d.readUInt32BE(d.at(-1)&15)&0x7fffffff)%1000000).padStart(6,'0')}
async function api(path,{method='GET',body,cookie,csrf,headers={}}={}){
 const r=await fetch(base+path,{signal:AbortSignal.timeout(15000),method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...headers},body:body?JSON.stringify(body):undefined});
 const data=await r.json().catch(()=>({}));return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function order(coupon=null){
 const r=await api('/api/checkout',{method:'POST',cookie:customerCookie,csrf:customerCsrf,headers:{'idempotency-key':crypto.randomUUID()},body:{email:'buyer@local.test',phone:'+94770000000',items:[{id:'p1',qty:1}],paymentMethod:'stripe',coupon,shippingAddress:{fullName:'Test Buyer',line1:'10 Test Road',city:'Colombo',postalCode:'00100',country:'LK'}}});
 assert.equal(r.status,200,JSON.stringify(r.data));const o=(await pool.query('select * from orders where id=$1',[r.data.id])).rows[0];return {order:o,session:sessions.get(o.payment_session_id)};
}
async function event(type,object,{id=crypto.randomUUID(),valid=true}={}){
 const payload=JSON.stringify({id,type,data:{object}}),signature=Stripe.webhooks.generateTestHeaderString({payload,secret:valid?secret:'whsec_incorrect_fixture'});
 const r=await fetch(base+'/api/stripe/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':signature},body:payload});return {status:r.status,data:await r.json()};
}
const paid=s=>({...s,payment_status:'paid',status:'complete'});
async function readOrder(id){return(await pool.query('select * from orders where id=$1',[id])).rows[0]}
before(async()=>{
 pool=await database();adminId=crypto.randomUUID();customerId=crypto.randomUUID();const hash=await bcrypt.hash('LocalTestPassword123!',4);
 for(const [id,email,admin] of [[adminId,'admin@local.test',true],[customerId,'buyer@local.test',false]])await pool.query('insert into users(id,name,email,password_hash,email_verified,is_admin) values($1,$2,$3,$4,true,$5)',[id,'Test Account',email,hash,admin]);
 await pool.query("insert into products(id,title,cat,price,image,stock) values('p1','Test Product','Tech',50,'https://example.test/product.jpg',100)");
 await pool.query("insert into coupons(code,percent_off,max_uses) values('TEST10',10,50)");
 application=createApplication({pool,stripe,env:{NODE_ENV:'development',ADMIN_MFA_REQUIRED:'true',ADMIN_MFA_SECRET:'JBSWY3DPEHPK3PXP',STRIPE_WEBHOOK_SECRET:secret}});
 server=application.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 const c=await api('/api/auth/login',{method:'POST',body:{email:'buyer@local.test',password:'LocalTestPassword123!'}});assert.equal(c.status,200);customerCookie=c.cookie;customerCsrf=c.data.csrfToken;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));if(pool)await pool.end()});
test('customer login cannot create an admin session even with a valid admin password',async()=>{
 const r=await api('/api/auth/login',{method:'POST',body:{email:'admin@local.test',password:'LocalTestPassword123!',otp:otp()}});assert.equal(r.status,403);assert.equal(r.cookie,undefined);
});
test('missing and malformed OTPs reject admin login',async()=>{
 for(const code of ['', 'invalid']){const r=await api('/api/admin/login',{method:'POST',body:{email:'admin@local.test',password:'LocalTestPassword123!',otp:code}});assert.equal(r.status,401);assert.equal(r.cookie,undefined);}
});
test('valid password and current OTP create an MFA-verified admin session',async()=>{
 const r=await api('/api/admin/login',{method:'POST',body:{email:'admin@local.test',password:'LocalTestPassword123!',otp:otp()}});assert.equal(r.status,200,JSON.stringify(r.data));adminCookie=r.cookie;
 assert.equal((await api('/api/admin/sellers',{cookie:adminCookie})).status,200);const db=await pool.query('select mfa_verified from sessions where user_id=$1',[adminId]);assert.equal(db.rows[0].mfa_verified,true);
});
test('legacy password-only admin sessions fail closed when MFA is required',async()=>{
 await pool.query('update sessions set mfa_verified=false where user_id=$1',[adminId]);assert.equal((await api('/api/admin/sellers',{cookie:adminCookie,headers:{'x-mfa-verified':'true'}})).status,403);await pool.query('update sessions set mfa_verified=true where user_id=$1',[adminId]);
});
test('customers cannot access administrator APIs',async()=>{assert.equal((await api('/api/admin/sellers',{cookie:customerCookie})).status,403);assert.equal((await api('/api/admin/sellers')).status,401)});
test('missing MFA secret rejects admin login instead of bypassing verification',async()=>{
 const isolated=createApplication({pool,stripe,env:{NODE_ENV:'development',ADMIN_MFA_REQUIRED:'true'}});const srv=isolated.app.listen(0,'127.0.0.1');await new Promise(r=>srv.once('listening',r));
 try{const r=await fetch('http://127.0.0.1:'+srv.address().port+'/api/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@local.test',password:'LocalTestPassword123!',otp:otp()})});assert.equal(r.status,503);}finally{await new Promise(r=>srv.close(r));}
});
test('valid raw Stripe signature confirms payment and exposes paid status to the customer',async()=>{
 const {order:o,session}=await order();assert.equal((await event('checkout.session.completed',paid(session))).status,200);assert.equal((await readOrder(o.id)).payment_status,'paid');
 const list=await api('/api/orders',{cookie:customerCookie});assert.equal(list.data.orders.find(x=>x.id===o.id).status,'paid');
});
test('forged Stripe signature cannot update an order',async()=>{const {order:o,session}=await order();assert.equal((await event('checkout.session.completed',paid(session),{valid:false})).status,400);assert.equal((await readOrder(o.id)).payment_status,'unpaid')});
test('duplicate signed events do not duplicate emails, points or paid history',async()=>{
 const {order:o,session}=await order();const id='evt_duplicate_fixture';const send=()=>event('checkout.session.completed',paid(session),{id});assert.equal((await send()).status,200);assert.equal((await send()).data.duplicate,true);
 assert.equal((await pool.query("select count(*)::int n from order_status_history where order_id=$1 and to_status='paid'",[o.id])).rows[0].n,1);
 assert.equal((await pool.query('select count(*)::int n from loyalty_ledger where order_id=$1',[o.id])).rows[0].n,1);
 assert.equal((await pool.query('select count(*)::int n from email_outbox where subject=$1',[`Order ${o.id} confirmed`])).rows[0].n,1);
});
test('wrong payment amount, currency or reference cannot mark an order paid',async()=>{
 for(const wrong of [{amount_total:1},{currency:'eur'},{client_reference_id:'wrong-order-key'}]){const {order:o,session}=await order();assert.equal((await event('checkout.session.completed',{...paid(session),...wrong})).status,500);assert.equal((await readOrder(o.id)).payment_status,'unpaid');}
});
test('coupon checkout total exactly matches the amount verified in the webhook',async()=>{
 const {order:o,session}=await order('TEST10');assert.equal(session.amount_total,Math.round(Number(o.total)*100));assert.equal(Number(o.discount),5);assert.equal((await event('checkout.session.completed',paid(session))).status,200);
 assert.equal((await pool.query("select uses_count from coupons where code='TEST10'")).rows[0].uses_count,1);
});
test('a declined card can be retried successfully without releasing reserved stock',async()=>{
 const {order:o,session}=await order();assert.equal((await event('payment_intent.payment_failed',{id:session.payment_intent,metadata:{order_id:o.id},last_payment_error:{code:'card_declined',message:'Local test decline'}})).status,200);
 assert.equal((await readOrder(o.id)).status,'pending_payment');assert.equal((await readOrder(o.id)).inventory_released,false);assert.equal((await event('checkout.session.completed',paid(session))).status,200);
});
test('an unpaid completion waits for async payment success',async()=>{const {order:o,session}=await order();assert.equal((await event('checkout.session.completed',session)).status,200);assert.equal((await readOrder(o.id)).payment_status,'unpaid');assert.equal((await event('checkout.session.async_payment_succeeded',paid(session))).status,200)});
test('late notification recovery confirms a provider-paid order before releasing inventory',async()=>{
 const {order:o,session}=await order();Object.assign(session,paid(session));await pool.query("update orders set reservation_expires_at=now()-interval '1 minute' where id=$1",[o.id]);await application.reconcileExpiredReservations();const updated=await readOrder(o.id);assert.equal(updated.payment_status,'paid');assert.equal(updated.inventory_released,false);
});
test('unpaid expiry releases stock once, while a provider outage preserves the reservation',async()=>{
 const {order:o}=await order();await pool.query("update orders set reservation_expires_at=now()-interval '1 minute' where id=$1",[o.id]);simulateOutage=true;await application.reconcileExpiredReservations();assert.equal((await readOrder(o.id)).inventory_released,false);simulateOutage=false;
 await application.reconcileExpiredReservations();assert.equal((await readOrder(o.id)).status,'payment_expired');assert.equal((await readOrder(o.id)).inventory_released,true);await application.reconcileExpiredReservations();
 assert.equal((await pool.query("select count(*)::int n from inventory_movements where order_id=$1 and reason='release'",[o.id])).rows[0].n,1);
});
