import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {sellerFixture} from './seller-fixture.js';
let f,admin;
before(async()=>{f=await sellerFixture();admin=f.accounts.orphan;await f.pool.query('update users set is_admin=true where id=$1',[admin.id]);f.stripe.refunds.create=async body=>({...body,id:'re_'+crypto.randomUUID(),currency:'usd',status:'succeeded'});});
after(async()=>f?.close());
beforeEach(async()=>{await f.pool.query('truncate orders cascade');await f.pool.query('delete from seller_payouts');});
async function order({date='2026-01-10',gross=100,commission=10,total=gross,seller='alpha',subtotal=gross,discount=0}={}){
 const id='RECOVERY-'+crypto.randomUUID();
 await f.pool.query(`insert into orders(id,user_id,customer_email,customer_name,status,payment_status,payment_method,currency,subtotal,discount,total,shipping_address,paid_at,payment_intent_id) values($1,$2,'buyer@local.test','Buyer','paid','paid','stripe','USD',$3,$4,$5,'{}',now(),$6)`,[id,f.accounts.buyer.id,subtotal,discount,total,'pi_'+id]);
 await f.pool.query("insert into seller_orders(order_id,seller_id,subtotal,commission,seller_net,status,created_at) values($1,$2,$3,$4,$5,'paid',$6)",[id,f.accounts[seller].sellerId,gross,commission,gross-commission,date+'T12:00:00Z']);return id;
}
const gen=(month='01',seller='alpha')=>f.api('/api/seller/payouts/generate',{method:'POST',account:f.accounts[seller],body:{periodStart:`2026-${month}-01`,periodEnd:`2026-${month}-28`}});
const update=(id,status='paid')=>f.api('/api/admin/payouts/'+id,{method:'PATCH',account:admin,body:{status,transferReference:'TRANSFER-RECOVERY-TEST'}});
const reconcile=(id,account=admin)=>f.api('/api/admin/payouts/'+id+'/reconcile',{method:'POST',account,body:{}});
const balance=(seller='alpha')=>f.api('/api/seller/payouts/reconcile',{method:'POST',account:f.accounts[seller],body:{}});
async function refund(id,amount,status='succeeded'){
 const rid=crypto.randomUUID();await f.pool.query("insert into refunds(id,order_id,amount,currency,status,reason) values($1,$2,$3,'USD',$4,'Regression test')",[rid,id,amount,status]);
 if(status==='succeeded')await f.pool.query("update orders set payment_status=case when total<=(select sum(amount) from refunds where order_id=$1 and status='succeeded') then 'refunded' else 'partially_refunded' end where id=$1",[id]);return rid;
}
async function paid(options){const id=await order(options),p=await gen(options?.date?.slice(5,7)||'01',options?.seller);assert.equal(p.status,200,JSON.stringify(p.data));assert.equal((await update(p.data.payoutId)).status,200);return{id,p:p.data};}

test('regression: a paid order refunded through the admin API no longer blocks new payouts',async()=>{
 const {id,p}=await paid();const original=(await f.pool.query('select * from seller_payouts where id=$1',[p.payoutId])).rows[0];
 const r=await f.api('/api/admin/orders/'+id+'/refund',{method:'POST',account:admin,headers:{'idempotency-key':crypto.randomUUID()},body:{reason:'Returned'}});assert.equal(r.status,200,JSON.stringify(r.data));
 await order({date:'2026-02-10',gross:200,commission:20});const n=await gen('02');assert.equal(n.status,200,JSON.stringify(n.data));assert.equal(n.data.refundDeduction,90);assert.equal(n.data.net,90);assert.equal(n.data.balance.reserved,90);
 assert.equal((await update(n.data.payoutId)).status,200);assert.equal((await balance()).data.balance.recovered,90);
 assert.deepEqual((await f.pool.query('select * from seller_payouts where id=$1',[p.payoutId])).rows[0],original);
 await order({date:'2026-03-10'});assert.equal((await gen('03')).data.net,90);
});
test('insufficient earnings settle at zero, carry debt forward, and recover it over later periods',async()=>{
 const {id}=await paid();await refund(id,100);const empty=await gen('02');assert.equal(empty.status,200);assert.equal(empty.data.status,'carried_forward');assert.equal(empty.data.balance.carryForward,90);
 await order({date:'2026-02-10',gross:40,commission:4});const a=await gen('02');assert.equal(a.data.net,0);assert.equal(a.data.status,'settled');assert.equal(a.data.balance.carryForward,54);assert.equal((await update(a.data.payoutId)).status,409);
 await order({date:'2026-03-10',gross:100,commission:10});const b=await gen('03');assert.equal(b.data.net,36);assert.equal(b.data.refundDeduction,54);assert.equal(b.data.balance.carryForward,0);
});
test('refunds of offset-only settlements become new debt without reopening the original transfer',async()=>{
 const {id}=await paid();await refund(id,100);const second=await order({date:'2026-02-10',gross:100,commission:10});const p=await gen('02');assert.equal(p.data.status,'settled');await refund(second,100);
 const b=await balance();assert.equal(b.data.balance.totalDebits,180);assert.equal(b.data.balance.recovered,90);assert.equal(b.data.balance.carryForward,90);
});
test('partial refunds are cumulative, capped, and pending/failed/canceled refunds are not debited',async()=>{
 const {id}=await paid();for(const state of ['pending','failed','canceled'])await refund(id,10,state);assert.equal((await balance()).data.balance.totalDebits,0);
 await refund(id,25);assert.equal((await balance()).data.balance.totalDebits,22.5);await balance();await refund(id,25);assert.equal((await balance()).data.balance.totalDebits,45);
 await refund(id,50);assert.equal((await balance()).data.balance.totalDebits,90);assert.equal((await f.pool.query('select * from seller_payout_refund_adjustments')).rowCount,1);
});
test('concurrent generation, repeated reconciliation and overlapping ranges cannot reuse offsets',async()=>{
 const {id}=await paid();await refund(id,100);await order({date:'2026-02-10',gross:200,commission:20});
 const requests=await Promise.all(Array.from({length:4},()=>gen('02')));assert.ok(requests.every(x=>x.status===200));assert.equal(new Set(requests.map(x=>x.data.payoutId)).size,1);assert.equal(requests[0].data.net,90);
 const pid=requests[0].data.payoutId;await reconcile(pid);await reconcile(pid);assert.equal((await f.pool.query('select * from seller_payout_refund_offsets')).rowCount,1);
 await order({date:'2026-03-10'});const next=await gen('03');assert.equal(next.data.net,90);assert.equal(next.data.refundDeduction,0);
});
test('an already available payout must be reconciled before recording its transfer after a refund',async()=>{
 const {id}=await paid();await order({date:'2026-02-10',gross:200,commission:20});const p=await gen('02');await refund(id,100);
 assert.equal((await update(p.data.payoutId)).status,409);const r=await reconcile(p.data.payoutId);assert.equal(r.status,200);assert.equal(r.data.net,90);assert.equal((await update(p.data.payoutId)).status,200);
});
test('failed transfer retries keep their offset reservations and cannot charge the refund twice',async()=>{
 const {id}=await paid();await refund(id,50);await order({date:'2026-02-10'});const p=await gen('02');assert.equal(p.data.net,45);assert.equal((await update(p.data.payoutId,'failed')).status,200);
 await order({date:'2026-03-10'});assert.equal((await gen('03')).data.refundDeduction,0);assert.equal((await update(p.data.payoutId,'available')).status,200);assert.equal((await update(p.data.payoutId)).status,200);assert.equal((await balance()).data.balance.recovered,45);
});
test('mixed seller refunds use discounted net earnings and the paid total including shipping and tax',async()=>{
 const id=await order({gross:60,commission:6,subtotal:100,discount:10,total:110});await f.pool.query("insert into seller_orders(order_id,seller_id,subtotal,commission,seller_net,status,created_at) values($1,$2,40,4,36,'paid','2026-01-10')",[id,f.accounts.beta.sellerId]);
 const a=await gen(),b=await gen('01','beta');await update(a.data.payoutId);await update(b.data.payoutId);await refund(id,55);
 assert.equal((await balance()).data.balance.totalDebits,24.3);assert.equal((await balance('beta')).data.balance.totalDebits,16.2);
 const own=(await balance()).data.balance.adjustments;assert.ok(own.every(x=>x.sourcePayoutId===a.data.payoutId));
});
test('cumulative fractional cents never overcharge either seller and full refunds recover full net',async()=>{
 const id=await order({gross:0.05,commission:0,subtotal:0.10,total:0.10});await f.pool.query("insert into seller_orders(order_id,seller_id,subtotal,commission,seller_net,status,created_at) values($1,$2,0.05,0,0.05,'paid','2026-01-10')",[id,f.accounts.beta.sellerId]);
 await update((await gen()).data.payoutId);await update((await gen('01','beta')).data.payoutId);
 await refund(id,0.01);assert.equal((await balance()).data.balance.totalDebits,0);assert.equal((await balance('beta')).data.balance.totalDebits,0);
 await refund(id,0.01);assert.equal((await balance()).data.balance.totalDebits,0.01);await refund(id,0.08);assert.equal((await balance()).data.balance.totalDebits,0.05);assert.equal((await balance('beta')).data.balance.totalDebits,0.05);
});
test('reconciliation is protected by seller/admin authorization, CSRF and seller isolation',async()=>{
 const {id,p}=await paid();await refund(id,100);
 assert.equal((await reconcile(p.payoutId,f.accounts.alpha)).status,403);
 assert.equal((await f.api('/api/seller/payouts/reconcile',{method:'POST',body:{}})).status,401);
 assert.equal((await f.api('/api/seller/payouts/reconcile',{method:'POST',account:f.accounts.alpha,csrf:'wrong',body:{}})).status,403);
 assert.equal((await f.api('/api/admin/payouts/'+p.payoutId+'/reconcile',{method:'POST',account:admin,csrf:'wrong',body:{}})).status,403);
 assert.equal((await balance('beta')).data.balance.totalDebits,0);assert.equal((await balance()).data.balance.totalDebits,90);
});
test('audit failure rolls back adjustments, offsets and payout generation together',async()=>{
 const {id}=await paid();await refund(id,100);await order({date:'2026-02-10'});
 await f.pool.db.exec("create function block_recovery_audit() returns trigger language plpgsql as $$ begin if NEW.action='payout_refund_offset' then raise exception 'Audit test failure'; end if; return NEW; end $$; create trigger block_recovery before insert on audit_logs for each row execute function block_recovery_audit()");
 try{assert.equal((await gen('02')).status,400);assert.equal((await f.pool.query('select * from seller_payout_refund_adjustments')).rowCount,0);assert.equal((await f.pool.query('select * from seller_payout_refund_offsets')).rowCount,0);assert.equal((await f.pool.query('select * from seller_payouts')).rowCount,1);}finally{await f.pool.db.exec('drop trigger block_recovery on audit_logs; drop function block_recovery_audit()');}
 assert.equal((await gen('02')).status,200);
});
test('migration is repeatable and does not change paid records or previously recorded refund recovery',async()=>{
 const {id,p}=await paid();await refund(id,100);await order({date:'2026-02-10'});const n=await gen('02');assert.equal(n.data.status,'settled');
 const snapshot=(await f.pool.query('select * from seller_payouts order by id')).rows;
 const sql=(await fs.readFile(new URL('../schema.sql',import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','');await f.pool.db.exec(sql);await f.pool.db.exec(sql);
 assert.deepEqual((await f.pool.query('select * from seller_payouts order by id')).rows,snapshot);assert.equal((await balance()).data.balance.recovered,90);assert.equal((await reconcile(p.payoutId)).data.net,90);
});

test('refunds of an unpaid payout release its reserved offsets for other eligible payouts',async()=>{
 const {id}=await paid();await refund(id,50);const current=await order({date:'2026-02-10'});const p=await gen('02');assert.equal(p.data.refundDeduction,45);
 await refund(current,100);await order({date:'2026-03-10'});const next=await gen('03');assert.equal(next.status,200,JSON.stringify(next.data));assert.equal(next.data.refundDeduction,45);assert.equal(next.data.net,45);
 const old=(await f.pool.query('select * from seller_payouts where id=$1',[p.data.payoutId])).rows[0];assert.equal(old.status,'failed');assert.equal(Number(old.refund_amount),0);assert.match(old.reconciliation_note,/changed/);assert.equal((await update(p.data.payoutId)).status,409);
 const review=await reconcile(p.data.payoutId);assert.equal(review.status,200);assert.equal(review.data.needsReview,true);assert.equal(review.data.balance.reserved,45);
});
