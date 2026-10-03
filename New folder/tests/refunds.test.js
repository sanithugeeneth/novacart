import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Stripe from 'stripe';
import {sellerFixture} from './seller-fixture.js';
let f,admin,calls=0,loseResponse=false,nextStatus='succeeded',gate=null;
const refunds=new Map(),keys=new Map();
before(async()=>{
  f=await sellerFixture();admin=f.accounts.orphan;
  await f.pool.query('update users set is_admin=true where id=$1',[admin.id]);
  f.stripe.refunds.create=async (body,{idempotencyKey})=>{
    calls++;
    if(gate)await gate();
    let refund=keys.get(idempotencyKey);
    if(!refund){refund={...body,id:'re_'+crypto.randomUUID(),currency:'usd',status:nextStatus};nextStatus='succeeded';keys.set(idempotencyKey,refund);refunds.set(refund.id,refund);}
    if(loseResponse){loseResponse=false;throw new Error('Provider accepted the request, but its response was lost');}
    return refund;
  };
  f.stripe.refunds.list=async ({payment_intent})=>({data:[...refunds.values()].filter(r=>r.payment_intent===payment_intent),has_more:false});
  f.stripe.refunds.retrieve=async id=>refunds.get(id);
});
after(async()=>f?.close());
async function paidOrder(){const result=await f.checkout([{id:'platform-product',qty:1}],'stripe');assert.equal(result.status,200,JSON.stringify(result.data));assert.equal((await f.pay(result.data.id)).status,200);return (await f.pool.query('select * from orders where id=$1',[result.data.id])).rows[0];}
const send=(order,key,body={},account=admin)=>f.api('/api/admin/orders/'+order.id+'/refund',{method:'POST',account,headers:{'idempotency-key':key},body});
async function event(type,object,id=crypto.randomUUID()){
  const payload=JSON.stringify({id,type,data:{object}});
  return fetch(f.base+'/api/stripe/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':Stripe.webhooks.generateTestHeaderString({payload,secret:f.secret})},body:payload});
}
test('partial/full refunds reserve cents once, preserve request keys and reject changed retries',async()=>{
  const o=await paidOrder(),key=crypto.randomUUID(),before=calls;
  const first=await send(o,key,{amount:5,reason:'Partial return'});assert.equal(first.status,200,JSON.stringify(first.data));
  assert.equal((await send(o,key,{amount:5,reason:'Partial return'})).data.duplicate,true);assert.equal(calls,before+1);
  assert.equal((await send(o,key,{amount:6,reason:'Partial return'})).status,409);
  assert.equal((await f.pool.query('select payment_status from orders where id=$1',[o.id])).rows[0].payment_status,'partially_refunded');
  assert.equal((await send(o,crypto.randomUUID())).status,200);
  const final=(await f.pool.query('select * from orders where id=$1',[o.id])).rows[0];assert.equal(final.payment_status,'refunded');assert.equal(final.status,'refunded');
  assert.equal((await send(o,crypto.randomUUID(),{amount:1})).status,400);
});
test('refund endpoints reject unauthorized users, missing CSRF/key and unpaid orders before provider calls',async()=>{
  const result=await f.checkout([{id:'platform-product',qty:1}],'cod'),o={id:result.data.orderId},before=calls;
  assert.equal((await send(o,crypto.randomUUID(),{},f.accounts.buyer)).status,403);
  assert.equal((await f.api('/api/admin/orders/'+o.id+'/refund',{method:'POST',account:admin,csrf:'wrong',body:{}})).status,403);
  for(const amount of [true,{},[],0,-2,'bad',1.234])assert.equal((await send(o,crypto.randomUUID(),{amount})).status,400);
  assert.equal((await send(o,'')).status,400);assert.equal((await send(o,crypto.randomUUID())).status,400);assert.equal(calls,before);
});
test('a lost provider response reserves the amount and retries the same provider refund without another transfer',async()=>{
  const o=await paidOrder(),key=crypto.randomUUID(),before=refunds.size;loseResponse=true;
  assert.equal((await send(o,key)).status,502);
  const reserved=(await f.pool.query('select * from refunds where order_id=$1',[o.id])).rows[0];assert.equal(reserved.status,'pending');assert.equal(reserved.submission_state,'unknown');
  assert.equal((await send(o,crypto.randomUUID())).status,400);
  assert.equal((await send(o,key)).status,200);assert.equal(refunds.size,before+1);
  assert.equal((await f.pool.query('select count(*)::int n from refunds where order_id=$1',[o.id])).rows[0].n,1);
});
test('concurrent clicks hold a durable reservation before calling the provider',async()=>{
  const o=await paidOrder(),key=crypto.randomUUID(),before=calls;let entered,release;
  const enteredPromise=new Promise(r=>entered=r),wait=new Promise(r=>release=r);gate=async()=>{entered();await wait;};
  const first=send(o,key);await enteredPromise;
  const duplicate=await send(o,key);assert.equal(duplicate.status,409);release();gate=null;
  assert.equal((await first).status,200);assert.equal(calls,before+1);
});
test('unknown requests older than the provider idempotency window reconcile without a new creation',async()=>{
  const o=await paidOrder(),key=crypto.randomUUID();loseResponse=true;assert.equal((await send(o,key)).status,502);
  await f.pool.query("update refunds set created_at=now()-interval '25 hours' where order_id=$1",[o.id]);const before=calls;
  assert.equal((await send(o,key)).status,200);assert.equal(calls,before);
});
test('signed refund updates reconcile pending requests and stale events cannot undo current provider state',async()=>{
  const o=await paidOrder(),key=crypto.randomUUID();nextStatus='pending';const initial=await send(o,key);assert.equal(initial.status,200);
  const current=refunds.get(initial.data.refundId);current.status='succeeded';
  const id=crypto.randomUUID();assert.equal((await event('refund.updated',{...current,status:'pending'},id)).status,200);
  assert.equal((await event('refund.updated',current,id)).status,200);
  assert.equal((await f.pool.query('select payment_status from orders where id=$1',[o.id])).rows[0].payment_status,'refunded');
  assert.equal((await f.pool.query('select count(*)::int n from refunds where order_id=$1',[o.id])).rows[0].n,1);
  assert.equal((await event('charge.refunded',{payment_intent:o.payment_intent_id})).status,200);
  assert.equal((await f.pool.query('select count(*)::int n from refunds where order_id=$1',[o.id])).rows[0].n,1);
});
test('failed refunds release the reserved amount only after current signed provider confirmation',async()=>{
  const o=await paidOrder();nextStatus='pending';const pending=await send(o,crypto.randomUUID());assert.equal(pending.status,200);
  const current=refunds.get(pending.data.refundId);current.status='failed';assert.equal((await event('refund.failed',current)).status,200);
  assert.equal((await send(o,crypto.randomUUID())).status,200);
});
