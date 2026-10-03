import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import {sellerFixture} from './seller-fixture.js';

let f,admin;
before(async()=>{
  f=await sellerFixture();
  const id=crypto.randomUUID();
  await f.pool.query('insert into users(id,name,email,password_hash,email_verified,is_admin) values($1,$2,$3,$4,true,true)',[id,'Test Admin','payout-admin@local.test',await bcrypt.hash(f.password,4)]);
  const login=await f.api('/api/admin/login',{method:'POST',body:{email:'payout-admin@local.test',password:f.password}});
  assert.equal(login.status,200);admin={cookie:login.cookie,csrf:login.data.csrfToken};
});
after(async()=>{await f?.close();});
async function order({date='2026-01-10',seller='alpha',payment='paid',status='paid',method='stripe',subtotal=100,discount=0,gross=100,commission=10}={}){
  const id='PAYOUT-'+crypto.randomUUID();
  await f.pool.query(`insert into orders(id,user_id,customer_email,customer_name,status,payment_status,payment_method,currency,subtotal,discount,total,shipping_address,paid_at)
    values($1,$2,'buyer@local.test','Buyer',$3,$4,$5,'USD',$6,$7,$8,'{}',$9)`,[id,f.accounts.buyer.id,status,payment,method,subtotal,discount,subtotal-discount,payment==='paid'?new Date():null]);
  await f.pool.query('insert into seller_orders(order_id,seller_id,subtotal,commission,seller_net,status,created_at) values($1,$2,$3,$4,$5,$6,$7)',[id,f.accounts[seller].sellerId,gross,commission,gross-commission,status,date+'T12:00:00Z']);
  return id;
}
const generate=(start,end,account)=>f.api('/api/seller/payouts/generate',{method:'POST',account:account||f.accounts.alpha,body:{periodStart:start,periodEnd:end}});
const update=(id,status,reference='TRANSFER-TEST-1')=>f.api('/api/admin/payouts/'+id,{method:'PATCH',account:admin,body:{status,transferReference:reference}});

test('payout eligibility excludes unpaid, failed, cancelled, refunded and uncollected COD orders',async()=>{
  await order();
  for(const [payment,status,method] of [['unpaid','pending_payment','stripe'],['failed','payment_failed','stripe'],['paid','cancelled','stripe'],['refunded','refunded','stripe'],['partially_refunded','paid','stripe'],['cod','delivered','cod']])await order({payment,status,method});
  const result=await generate('2026-01-01','2026-01-31');
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.gross,100);assert.equal(result.data.net,90);
  assert.equal((await f.pool.query('select order_id from seller_payout_items where payout_id=$1',[result.data.payoutId])).rowCount,1);
});
test('repeat and concurrent requests return one payout, and overlapping ranges cannot reuse orders',async()=>{
  const id=await order({date:'2026-02-10'});
  const results=await Promise.all(Array.from({length:4},()=>generate('2026-02-01','2026-02-28')));
  assert.ok(results.every(r=>r.status===200),JSON.stringify(results));
  assert.equal(new Set(results.map(r=>r.data.payoutId)).size,1);
  assert.equal(results.filter(r=>!r.data.duplicate).length,1);
  assert.equal((await generate('2026-02-02','2026-02-28')).status,409);
  await order({date:'2026-03-01'});
  const overlap=await generate('2026-02-10','2026-03-02');
  assert.equal(overlap.status,200);assert.equal(overlap.data.net,90);
  assert.equal((await f.pool.query('select * from seller_payout_items where seller_id=$1 and order_id=$2',[f.accounts.alpha.sellerId,id])).rowCount,1);
  await assert.rejects(()=>f.pool.query('insert into seller_payout_items(payout_id,seller_id,order_id,gross_amount,commission_amount,net_amount) values($1,$2,$3,100,10,90)',[overlap.data.payoutId,f.accounts.alpha.sellerId,id]),e=>e.code==='23505');
});
test('discounted mixed orders allocate cents once across sellers and exclude platform shipping/tax',async()=>{
  const id=await order({date:'2026-04-10',subtotal:100,discount:10,gross:60,commission:6});
  await f.pool.query("insert into seller_orders(order_id,seller_id,subtotal,commission,seller_net,status,created_at) values($1,$2,40,4,36,'paid','2026-04-10T12:00:00Z')",[id,f.accounts.beta.sellerId]);
  const a=await generate('2026-04-01','2026-04-30');const b=await generate('2026-04-01','2026-04-30',f.accounts.beta);
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.equal(a.data.gross,54);assert.equal(a.data.commission,5.4);assert.equal(a.data.net,48.6);
  assert.equal(b.data.gross,36);assert.equal(b.data.net,32.4);
});
test('a one-cent discount is allocated exactly once across seller balances',async()=>{
  const id=await order({date:'2026-09-10',subtotal:0.10,discount:0.01,gross:0.05,commission:0.01});
  await f.pool.query("insert into seller_orders(order_id,seller_id,subtotal,commission,seller_net,status,created_at) values($1,$2,0.05,0.01,0.04,'paid','2026-09-10T12:00:00Z')",[id,f.accounts.beta.sellerId]);
  const a=await generate('2026-09-01','2026-09-30'),b=await generate('2026-09-01','2026-09-30',f.accounts.beta);
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.equal(Math.round((a.data.gross+b.data.gross)*100),9);
  assert.equal(Math.round((a.data.net+b.data.net)*100),7);
});
test('pending refunds and open returns are withheld, and refunds invalidate an unpaid snapshot',async()=>{
  const pending=await order({date:'2026-05-10'}),returned=await order({date:'2026-05-11'});
  await f.pool.query("insert into refunds(id,order_id,amount,currency,status,reason) values($1,$2,10,'USD','pending','Test')",[crypto.randomUUID(),pending]);
  await f.pool.query("insert into returns_requests(id,order_id,user_id,reason,status) values($1,$2,$3,'Test','requested')",[crypto.randomUUID(),returned,f.accounts.buyer.id]);
  assert.equal((await generate('2026-05-01','2026-05-31')).status,409);
  const id=await order({date:'2026-06-10'});const result=await generate('2026-06-01','2026-06-30');assert.equal(result.status,200);
  await f.pool.query("update orders set payment_status='refunded',status='refunded' where id=$1",[id]);
  assert.equal((await update(result.data.payoutId,'paid')).status,409);
});
test('failed payouts retain their allocations, can be retried, and paid payouts cannot reopen',async()=>{
  await order({date:'2026-07-10'});const p=await generate('2026-07-01','2026-07-31');assert.equal(p.status,200);
  assert.equal((await update(p.data.payoutId,'failed')).status,200);
  assert.equal((await generate('2026-07-02','2026-07-31')).status,409);
  assert.equal((await generate('2026-07-01','2026-07-31')).data.payoutId,p.data.payoutId);
  assert.equal((await update(p.data.payoutId,'available')).status,200);
  assert.equal((await update(p.data.payoutId,'paid','')).status,400);
  assert.equal((await update(p.data.payoutId,'paid')).status,200);
  assert.equal((await update(p.data.payoutId,'paid')).data.duplicate,true);
  assert.equal((await update(p.data.payoutId,'available')).status,409);
  assert.equal((await update(p.data.payoutId,'failed')).status,409);
});
test('COD needs an admin collection receipt before inclusion in a payout',async()=>{
  const id=await order({date:'2026-08-10',payment:'cod',status:'delivered',method:'cod'});
  assert.equal((await generate('2026-08-01','2026-08-31')).status,409);
  const path='/api/admin/orders/'+id+'/confirm-cod',body={receiptReference:'RECEIPT-001'};
  assert.equal((await f.api(path,{method:'POST',account:f.accounts.alpha,body})).status,403);
  assert.equal((await f.api(path,{method:'POST',account:admin,body})).status,200);
  assert.equal((await f.api(path,{method:'POST',account:admin,body})).data.duplicate,true);
  const result=await generate('2026-08-01','2026-08-31');assert.equal(result.status,200);assert.equal(result.data.net,90);
});
test('bad dates, unauthenticated requests and invalid CSRF cannot generate payouts',async()=>{
  for(const dates of [['2026-02-30','2026-03-01'],['2026-10-01','2026-09-01'],['not-a-date','2026-01-01']])assert.equal((await generate(...dates)).status,400);
  assert.equal((await f.api('/api/seller/payouts/generate',{method:'POST',body:{}})).status,401);
  assert.equal((await f.api('/api/seller/payouts/generate',{method:'POST',account:f.accounts.alpha,csrf:'bad',body:{}})).status,403);
});
test('legacy duplicates survive migration but overlapping historical amounts cannot be paid again',async()=>{
  await order({date:'2025-01-10'});
  const ids=[crypto.randomUUID(),crypto.randomUUID()];
  for(const id of ids)await f.pool.query("insert into seller_payouts(id,seller_id,period_start,period_end,gross_amount,commission_amount,net_amount,status) values($1,$2,'2025-01-01','2025-01-31',100,10,90,'available')",[id,f.accounts.alpha.sellerId]);
  const schema=(await fs.readFile(new URL('../schema.sql',import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','');
  await f.pool.db.exec(schema);
  assert.equal((await generate('2025-01-01','2025-01-31')).status,409);
  assert.equal((await update(ids[0],'paid')).status,409);
  for(const id of ids)assert.equal((await update(id,'failed')).status,200);
  const fixed=await generate('2025-01-01','2025-01-31');assert.equal(fixed.status,200);assert.equal(fixed.data.net,90);
});
