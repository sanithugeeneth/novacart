import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {sellerFixture} from './seller-fixture.js';
let f,local,history,total;
before(async()=>{
 f=await sellerFixture({env:{CURRENCY:'LKR'}});
 await f.pool.query('update users set is_admin=true where id=$1',[f.accounts.orphan.id]);
 const auth=await f.api('/api/admin/login',{method:'POST',body:{email:f.accounts.orphan.email,password:f.password}});assert.equal(auth.status,200);Object.assign(f.accounts.orphan,{cookie:auth.cookie,csrf:auth.data.csrfToken});
 local=(await f.checkout([{id:'alpha-product',qty:2}])).data.orderId;
 history=(await f.checkout([{id:'alpha-product',qty:1}])).data.orderId;
 await f.pool.query("update orders set currency='USD' where id=$1",[history]);
 total=Number((await f.pool.query('select total from orders where id=$1',[local])).rows[0].total);
 for(const currency of ['LKR','USD'])await f.pool.query("insert into seller_payouts(id,seller_id,period_start,period_end,gross_amount,net_amount,currency,status,ledger_version) values($1,$2,case when $3='USD' then date '2024-01-01' else date '2025-01-01' end,case when $3='USD' then date '2024-01-31' else date '2025-01-31' end,100,100,$3,'available',1)",[crypto.randomUUID(),f.accounts.alpha.sellerId,currency]);
});
after(async()=>{await f?.close();});

test('formatter uses explicit currency codes, preserves values and never guesses USD',async()=>{
 const ctx=vm.createContext({Intl});vm.runInContext(await fs.readFile(new URL('../workspace-money.js',import.meta.url),'utf8'),ctx);const m=ctx.WorkspaceMoney;
 assert.equal(m.format(10),'—');assert.equal(m.setCurrency(' lkr '),'LKR');assert.match(m.format(1234.5),/LKR.*1,234\.50/);assert.match(m.format(12,'USD'),/USD.*12\.00/);assert.match(m.format(12,'EUR'),/EUR.*12\.00/);assert.match(m.format(0),/LKR.*0\.00/);assert.match(m.format(-10),/LKR.*10\.00/);assert.equal(m.format(1,'bad<script>'),'—');assert.equal(m.format(NaN),'—');assert.throws(()=>m.setCurrency(null));assert.equal(m.format(1),'—');
});
test('admin and seller product prices use the configured currency even for old USD-default catalogue rows',async()=>{
 assert.equal((await f.pool.query("select currency from products where id='alpha-product'")).rows[0].currency,'USD');
 for(const route of ['/api/admin/products','/api/seller/products']){const r=await f.api(route,{account:route.includes('/admin/')?f.accounts.orphan:f.accounts.alpha});assert.equal(r.status,200);const p=r.data.products.find(p=>p.id==='alpha-product');assert.equal(p.currency,'LKR');assert.equal(p.price,25);}
 for(const route of ['/api/admin/products/alpha-product','/api/seller/products/alpha-product'])assert.equal((await f.api(route,{account:route.includes('/admin/')?f.accounts.orphan:f.accounts.alpha})).data.product.currency,'LKR');
 assert.equal((await f.api('/api/store-config')).data.currency,'LKR');
});
test('current-currency revenue, analytics and customer value exclude historical foreign amounts',async()=>{
 const account=f.accounts.orphan,m=await f.api('/api/admin/metrics',{account});assert.equal(m.status,200);assert.equal(m.data.currency,'LKR');assert.equal(m.data.revenue,total);assert.equal(m.data.orders,2);
 const a=await f.api('/api/admin/analytics?days=30',{account});assert.equal(a.status,200,JSON.stringify(a.data));assert.equal(a.data.currency,'LKR');assert.equal(a.data.summary.revenue,total);assert.equal(a.data.summary.orders,1);assert.equal(a.data.daily.reduce((n,d)=>n+d.revenue,0),total);assert.equal(a.data.categories.reduce((n,c)=>n+c.sales,0),50);
 const c=(await f.api('/api/admin/customers',{account})).data.customers.find(c=>c.id===f.accounts.buyer.id);assert.equal(c.currency,'LKR');assert.equal(c.lifetimeValue,total);assert.equal(c.orders,2);
});
test('historical order currencies remain unchanged in both operational screens',async()=>{
 for(const route of ['/api/admin/orders','/api/seller/orders']){const r=await f.api(route,{account:route.includes('/admin/')?f.accounts.orphan:f.accounts.alpha});assert.equal(r.status,200);const id=o=>o.id||o.order_id;assert.equal(r.data.orders.find(o=>id(o)===history).currency.toUpperCase(),'USD');assert.equal(r.data.orders.find(o=>id(o)===local).currency.toUpperCase(),'LKR');}
 assert.equal((await f.api('/api/admin/orders/'+history,{account:f.accounts.orphan})).data.order.currency.toUpperCase(),'USD');
});
test('seller payout summary includes only store-currency balances while history keeps both currencies',async()=>{
 const summary=await f.api('/api/seller/overview',{account:f.accounts.alpha});assert.equal(summary.data.currency,'LKR');assert.equal(summary.data.payouts.available,100);
 const p=await f.api('/api/seller/payouts',{account:f.accounts.alpha});assert.equal(p.data.balance.currency,'LKR');assert.deepEqual(p.data.payouts.map(p=>p.currency).sort(),['LKR','USD']);
});
test('shared formatter is served and static admin placeholders never claim dollars before configuration loads',async()=>{
 const r=await fetch(f.base+'/workspace-money.js');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);
 for(const page of ['admin.html','seller.html']){const html=await fs.readFile(new URL('../'+page,import.meta.url),'utf8');assert.ok(html.includes('workspace-money.js'));assert.ok(html.indexOf('workspace-money.js')<html.indexOf(page.replace('.html','.js')));assert.ok(!html.includes('$0'));}
});
