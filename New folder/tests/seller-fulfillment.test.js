import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Stripe from 'stripe';
import {sellerFixture} from './seller-fixture.js';

let f;
before(async()=>{
  f=await sellerFixture();
  await f.pool.query('update users set is_admin=true where id=$1',[f.accounts.orphan.id]);
});
after(async()=>f?.close());
const stages=['processing','packed','shipped'];
async function order(method='stripe',items=[{id:'alpha-product',qty:1}]){
  const result=await f.checkout(items,method);
  assert.equal(result.status,200,JSON.stringify(result.data));
  return result.data.id||result.data.orderId;
}
async function paidOrder(){const id=await order();assert.equal((await f.pay(id)).status,200);return id;}
const change=(id,status,options={})=>f.api('/api/seller/orders/'+id,{
  method:'PATCH',account:f.accounts.alpha,body:{status,trackingNumber:'LOCAL-TRACK',courier:'Test courier'},...options
});
async function snapshot(id){
  return {
    order:(await f.pool.query('select * from orders where id=$1',[id])).rows,
    sellers:(await f.pool.query('select * from seller_orders where order_id=$1 order by seller_id',[id])).rows,
    audit:(await f.pool.query("select * from audit_logs where action='seller_order_update' and entity_id=$1 order by id",[id])).rows
  };
}
async function deniedUnchanged(id,status='shipped',options={},expected=409){
  const before=await snapshot(id),result=await change(id,status,options);
  assert.equal(result.status,expected,JSON.stringify(result.data));
  assert.deepEqual(await snapshot(id),before,'Rejected fulfillment must not change order, seller tracking or audit data.');
  return result;
}

test('unpaid card orders cannot be processed, packed or shipped, including forged payment fields',async()=>{
  const id=await order();
  for(const status of stages){
    const result=await deniedUnchanged(id,status,{body:{status,trackingNumber:'FORGED',paymentMethod:'cod',payment_status:'paid',paid_at:new Date().toISOString()}});
    assert.match(result.data.error,/payment/i);
  }
});

test('an unpaid signed checkout notification and stale seller status never unlock shipping',async()=>{
  const id=await order(),o=(await f.pool.query('select * from orders where id=$1',[id])).rows[0];
  const session=await f.stripe.checkout.sessions.retrieve(o.payment_session_id);
  const payload=JSON.stringify({id:'evt_'+crypto.randomUUID(),type:'checkout.session.completed',data:{object:session}});
  const response=await fetch(f.base+'/api/stripe/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':Stripe.webhooks.generateTestHeaderString({payload,secret:f.secret})},body:payload});
  assert.equal(response.status,200);
  await f.pool.query("update seller_orders set status='paid' where order_id=$1",[id]);
  await deniedUnchanged(id);
});

test('a verified paid card order can progress and update tracking without reversing fulfillment',async()=>{
  const id=await paidOrder(),before=(await snapshot(id)).order;
  for(const status of stages)assert.equal((await change(id,status)).status,200);
  assert.equal((await change(id,'shipped',{body:{status:'shipped',trackingNumber:'CORRECTED',courier:'Corrected courier'}})).status,200);
  const after=await snapshot(id);
  assert.equal(after.sellers[0].status,'shipped');assert.equal(after.sellers[0].tracking_number,'CORRECTED');
  assert.equal(after.audit.length,4);assert.deepEqual(after.order,before,'Seller fulfillment cannot set or rewrite payment data.');
  await deniedUnchanged(id,'processing');await deniedUnchanged(id,'packed');
});

test('cash-on-delivery orders can be processed, packed and shipped before collection',async()=>{
  const id=await order('cod');
  for(const status of stages)assert.equal((await change(id,status)).status,200);
  const state=await snapshot(id);
  assert.equal(state.order[0].payment_method,'cod');assert.equal(state.order[0].payment_status,'cod');
  assert.equal(state.order[0].paid_at,null);assert.equal(state.sellers[0].status,'shipped');
});

test('closed, released, inconsistent or unknown payment states fail closed without mutation',async()=>{
  const id=await paidOrder();
  const cases=[
    {payment:'unpaid'},{payment:'failed'},{payment:'pending'},{payment:'partially_refunded'},{payment:'refunded'},
    {payment:'paid',paidAt:false},{payment:'paid',method:'unrecognized'},
    {status:'pending_payment'},{status:'cancelled'},{status:'refunded'},{status:'delivered'},
    {status:'payment_failed'},{status:'payment_expired'},{released:true},
    {seller:'cancelled'},{seller:'refunded'},{seller:'delivered'},{seller:'pending_payment'},
    {method:'cod',payment:'unpaid'},{method:'cod',payment:'failed'},{method:'cod',payment:'refunded'}
  ];
  for(const row of cases){
    await f.pool.query('update orders set status=$2,payment_status=$3,payment_method=$4,paid_at=$5,inventory_released=$6 where id=$1',
      [id,row.status||'paid',row.payment||'paid',row.method||'stripe',row.paidAt===false?null:new Date(),row.released||false]);
    await f.pool.query('update seller_orders set status=$2 where order_id=$1',[id,row.seller||'paid']);
    await deniedUnchanged(id);
  }
});

test('an unresolved refund blocks fulfillment until its failure is confirmed',async()=>{
  const id=await paidOrder(),key=crypto.randomUUID(),admin=f.accounts.orphan;
  f.stripe.refunds.create=async()=>{throw new Error('Local simulated lost provider response');};
  const refund=()=>f.api('/api/admin/orders/'+id+'/refund',{method:'POST',account:admin,headers:{'idempotency-key':key},body:{amount:1}});
  assert.equal((await refund()).status,502);
  for(const status of stages)await deniedUnchanged(id,status);
  f.stripe.refunds.create=async body=>({...body,id:'re_'+crypto.randomUUID(),currency:'usd',status:'failed'});
  assert.equal((await refund()).status,200);
  assert.equal((await change(id,'shipped')).status,200);
});

test('successful partial and full refunds both stop seller fulfillment',async()=>{
  for(const amount of [1,null]){
    const id=await paidOrder();
    f.stripe.refunds.create=async body=>({...body,id:'re_'+crypto.randomUUID(),currency:'usd',status:'succeeded'});
    const refund=await f.api('/api/admin/orders/'+id+'/refund',{method:'POST',account:f.accounts.orphan,headers:{'idempotency-key':crypto.randomUUID()},body:amount===null?{}:{amount}});
    assert.equal(refund.status,200,JSON.stringify(refund.data));
    for(const status of stages)await deniedUnchanged(id,status);
  }
});

test('fulfillment keeps authentication, CSRF, seller ownership and status validation',async()=>{
  const id=await paidOrder();
  await deniedUnchanged(id,'shipped',{account:null},401);
  await deniedUnchanged(id,'shipped',{account:f.accounts.buyer},403);
  await deniedUnchanged(id,'shipped',{account:f.accounts.suspended},403);
  await deniedUnchanged(id,'shipped',{csrf:'wrong'},403);
  await deniedUnchanged(id,'shipped',{account:f.accounts.beta},404);
  await deniedUnchanged(id,'paid',{},400);
  assert.equal((await change('nonexistent-order','shipped')).status,404);
});

test('multi-seller orders are blocked until paid and each seller updates only its own allocation',async()=>{
  const id=await order('stripe',[{id:'alpha-product',qty:1},{id:'beta-product',qty:1}]);
  for(const name of ['alpha','beta'])await deniedUnchanged(id,'shipped',{account:f.accounts[name]});
  assert.equal((await f.pay(id)).status,200);
  assert.equal((await change(id,'shipped')).status,200);
  let rows=(await snapshot(id)).sellers;
  assert.equal(rows.find(x=>x.seller_id===f.accounts.alpha.sellerId).status,'shipped');
  assert.equal(rows.find(x=>x.seller_id===f.accounts.beta.sellerId).status,'paid');
  assert.equal((await change(id,'packed',{account:f.accounts.beta})).status,200);
});

test('a failed audit write rolls back the status and tracking update',async()=>{
  const id=await paidOrder(),connect=f.pool.connect;
  f.pool.connect=async()=>{
    const client=await connect(),query=client.query;
    client.query=async(sql,params)=>{
      if(/insert into audit_logs/i.test(sql))throw new Error('Local simulated database write failure');
      return query(sql,params);
    };
    return client;
  };
  try{await deniedUnchanged(id,'shipped',{},500);}finally{f.pool.connect=connect;}
});
