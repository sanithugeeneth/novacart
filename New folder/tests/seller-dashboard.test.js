import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {sellerFixture} from './seller-fixture.js';
let f;
before(async()=>{f=await sellerFixture();});
after(async()=>{await f?.close();});
const input=(extra={})=>({title:'Dashboard desk lamp',cat:'Home',price:25.50,oldPrice:35,stock:8,image:'/assets/demo-lamp.jpg',description:'A desk lamp.',brand:'Studio',searchKeywords:'desk, light',costPrice:10,badge:'NEW',...extra});
async function create(extra={}){const r=await f.api('/api/seller/products',{account:f.accounts.alpha,method:'POST',body:input(extra)});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.product;}
const path=p=>'/api/seller/products/'+p.id;
const read=async p=>(await f.api(path(p),{account:f.accounts.alpha})).data.product;
const patch=(p,body,account=f.accounts.alpha)=>f.api(path(p),{account,method:'PATCH',body});

test('seller product editor persists all fields, generated identifiers and audit history',async()=>{
 const p=await create({seller_id:f.accounts.beta.id,rating:5,reviews:500,currency:'EUR',slug:'forged'});
 assert.equal(p.seller_id,f.accounts.alpha.id);assert.equal(p.currency.trim(),'USD');assert.equal(p.rating,0);assert.equal(p.reviews,0);assert.notEqual(p.slug,'forged');assert.ok(p.sku);assert.ok(p.revision);
 const r=await patch(p,{...input({title:'Updated desk lamp',price:30,oldPrice:45,stock:12,active:false,sku:'DESK-001',brand:'Updated',cat:'Tech',description:'Updated details.',searchKeywords:'work light',costPrice:12,badge:'SALE'}),expectedStock:p.stock,expectedRevision:p.revision});
 assert.equal(r.status,200,JSON.stringify(r.data));const q=r.data.product;
 assert.equal(q.title,'Updated desk lamp');assert.equal(q.sku,'DESK-001');assert.equal(q.cat,'Tech');assert.equal(q.brand,'Updated');assert.equal(q.description,'Updated details.');assert.equal(q.search_keywords,'work light');assert.equal(q.costPrice,12);assert.equal(q.badge,'SALE');assert.equal(q.active,false);assert.equal(q.oldPrice,45);assert.equal(q.stock,12);assert.notEqual(q.revision,p.revision);
 const moves=(await f.pool.query("select change_qty from inventory_movements where product_id=$1 and reason='seller_stock_update' order by id",[p.id])).rows.map(x=>x.change_qty);assert.deepEqual(moves,[8,4]);
 assert.equal((await f.pool.query('select id from audit_logs where entity_id=$1',[p.id])).rowCount,2);
 assert.equal((await f.api('/api/products/'+p.id)).status,404);
});
test('product and variant mutations enforce owner, approval and CSRF',async()=>{
 const p=await create();
 assert.equal((await f.api(path(p))).status,401);
 assert.equal((await f.api(path(p),{account:f.accounts.beta})).status,404);
 assert.equal((await patch(p,{price:1},f.accounts.beta)).status,404);
 for(const account of [f.accounts.pending,f.accounts.suspended,f.accounts.buyer])assert.equal((await patch(p,{price:1},account)).status,403);
 for(const route of [path(p),path(p)+'/variants/alpha-variant'])assert.equal((await f.api(route,{account:f.accounts.alpha,method:'PATCH',csrf:'invalid',body:{price:1}})).status,403);
 assert.equal((await f.api(path(p)+'/variants',{account:f.accounts.beta,method:'POST',body:{title:'Blue',price:2,stock:2}})).status,404);
 assert.equal((await f.api(path(p)+'/variants/alpha-variant',{account:f.accounts.alpha,method:'PATCH',body:{price:2}})).status,404);
});
test('invalid amounts, stock, images and visibility cannot alter the catalogue',async()=>{
 for(const extra of [{price:-1},{price:1.234},{price:true},{stock:-2},{stock:1.5},{stock:2147483648},{active:'false'},{image:'javascript:alert(1)'},{image:'https://name:secret@example.test/image.jpg'},{image:'/assets/../server.js'},{oldPrice:1},{title:'x'}]){
  const r=await f.api('/api/seller/products',{account:f.accounts.alpha,method:'POST',body:input(extra)});assert.equal(r.status,400,JSON.stringify({extra,result:r.data}));
 }
 const p=await create({sku:'UNIQUE-SELLER-SKU'});
 assert.equal((await f.api('/api/seller/products',{account:f.accounts.alpha,method:'POST',body:input({sku:p.sku})})).status,409);
});
test('checkout consumes stock and stale inventory or product revisions cannot overwrite it',async()=>{
 const p=await create();const checkout=await f.checkout([{id:p.id,qty:2}]);assert.equal(checkout.status,200);
 assert.equal((await patch(p,{stock:20,expectedStock:p.stock,expectedRevision:p.revision})).status,409);
 assert.equal((await patch(p,{stock:20})).status,409);
 assert.equal((await patch(p,{title:'Metadata after purchase'})).status,200);
 let fresh=await read(p);assert.equal(fresh.stock,6);
 assert.equal((await patch(p,{stock:11,expectedStock:fresh.stock,expectedRevision:fresh.revision})).status,200);
 assert.equal((await patch(p,{price:29,expectedRevision:fresh.revision})).status,409);
 fresh=await read(p);assert.equal(fresh.stock,11);assert.equal(fresh.title,'Metadata after purchase');
});
test('variant creation, inventory, price and visibility edits reach checkout safely',async()=>{
 const p=await create();const route=path(p)+'/variants';
 const r=await f.api(route,{account:f.accounts.alpha,method:'POST',body:{title:'Blue / Large',price:32,oldPrice:40,stock:5,sku:'DASH-BLUE',active:true}});assert.equal(r.status,201,JSON.stringify(r.data));
 const v=r.data.product.variants[0];assert.equal(v.stock,5);
 assert.equal((await f.checkout([{id:p.id,variantId:v.id,qty:2}])).status,200);
 const update=body=>f.api(route+'/'+v.id,{account:f.accounts.alpha,method:'PATCH',body});
 assert.equal((await update({stock:20,expectedStock:5,expectedRevision:v.revision})).status,409);
 const latest=(await read(p)).variants[0];assert.equal(latest.stock,3);
 const saved=await update({title:'Blue / XL',stock:9,price:35,active:false,expectedStock:latest.stock,expectedRevision:latest.revision});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.product.variants[0].active,false);
 assert.equal((await f.checkout([{id:p.id,variantId:v.id,qty:1}])).status,400);
 assert.equal((await read(p)).stock,8);
 const movement=(await f.pool.query("select sum(change_qty)::int total from inventory_movements where variant_id=$1 and reason='seller_stock_update'",[v.id])).rows[0];assert.equal(movement.total,11);
});
test('stock and audit writes roll back together if audit storage fails',async()=>{
 const p=await create(),connect=f.pool.connect.bind(f.pool);
 f.pool.connect=async()=>{const c=await connect(),query=c.query.bind(c);c.query=(sql,...args)=>/insert into audit_logs/i.test(sql)?Promise.reject(new Error('injected audit failure')):query(sql,...args);return c;};
 try{const r=await patch(p,{stock:18,expectedStock:p.stock});assert.equal(r.status,500);}finally{f.pool.connect=connect;}
 assert.equal((await read(p)).stock,p.stock);assert.equal((await f.pool.query("select count(*)::int n from inventory_movements where product_id=$1 and reason='seller_stock_update'",[p.id])).rows[0].n,1);
});
test('seller search and pagination include the full catalogue and maintain ownership',async()=>{
 for(let n=0;n<55;n++)await f.pool.query("insert into products(id,slug,title,cat,price,image,stock,seller_id,active) values($1,$1,$2,'Home',10,'/assets/demo-lamp.jpg',10,$3,$4)",['paging-'+n,'Archive lamp '+n,f.accounts.alpha.id,n!==54]);
 const get=query=>f.api('/api/seller/products?'+query,{account:f.accounts.alpha});
 const a=await get('q=Archive&limit=12&page=1'),b=await get('q=Archive&limit=12&page=5');assert.equal(a.data.pagination.total,55);assert.equal(a.data.products.length,12);assert.equal(b.data.products.length,7);
 assert.ok(b.data.products.every(p=>!a.data.products.some(q=>q.id===p.id)));
 const searched=await get('q=Archive%20lamp%2054&visibility=hidden');assert.deepEqual(searched.data.products.map(p=>p.id),['paging-54']);
 assert.equal((await get('page=0')).status,400);assert.equal((await get('limit=101')).status,400);
 assert.equal((await f.api('/api/seller/products?q=Archive',{account:f.accounts.beta})).data.pagination.total,0);
});
test('seller order controls receive only their items with delivery details, search and status filters',async()=>{
 const order=await f.checkout([{id:'alpha-product',variantId:'alpha-variant',qty:1},{id:'beta-product',qty:1},{id:'platform-product',qty:1}]);assert.equal(order.status,200);const id=order.data.orderId;
 const r=await f.api('/api/seller/orders?q='+encodeURIComponent(id),{account:f.accounts.alpha});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.pagination.total,1);
 const o=r.data.orders[0];assert.equal(o.items.length,1);assert.equal(o.items[0].product_id,'alpha-product');assert.equal(o.items[0].variant_id,'alpha-variant');assert.equal(o.shipping_address.line1,'10 Test Road');assert.equal(o.customer_phone,'+94770000000');assert.equal(o.refund_held,false);
 assert.equal((await f.api('/api/seller/orders/'+id,{account:f.accounts.alpha,method:'PATCH',body:{status:'packed'}})).status,200);
 const packed=await f.api('/api/seller/orders?status=packed&limit=1',{account:f.accounts.alpha});assert.ok(packed.data.orders.some(o=>o.order_id===id));
 assert.equal((await f.api('/api/seller/orders?limit=1000',{account:f.accounts.alpha})).status,400);
});
test('seller catalogue script is served as JavaScript, without exposing server services',async()=>{
 const r=await fetch(f.base+'/seller-catalog.js');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);assert.equal(await r.text(),await fs.readFile(new URL('../seller-catalog.js',import.meta.url),'utf8'));
 assert.equal((await fetch(f.base+'/services/seller-products.js')).status,404);
});

test('supplier-linked stock cannot be manually overwritten but details remain editable',async()=>{
 const p=await create();await f.pool.query("insert into supplier_products(id,provider,external_id,external_sku,product_id,country,supplier_stock,currency,last_synced_at) values($1,'amazon','B000TEST','SUP-1',$2,'LK',8,'USD',now())",[crypto.randomUUID(),p.id]);
 const latest=await read(p);assert.equal(latest.supplier_managed,true);
 assert.equal((await patch(p,{stock:90,expectedStock:p.stock})).status,409);
 assert.equal((await f.api(path(p)+'/variants',{account:f.accounts.alpha,method:'POST',body:{title:'Blue',price:25,stock:5}})).status,409);
 assert.equal((await patch(p,{title:'Supplier lamp updated'})).status,200);assert.equal((await read(p)).stock,8);
});

test('editing the main image also updates the customer gallery while retaining other images',async()=>{
 const p=await create();await f.pool.query("insert into product_images(product_id,url,alt,sort_order) values($1,'/assets/demo-bottle.jpg','Second view',1)",[p.id]);
 assert.equal((await patch(p,{image:'/assets/demo-headphones.jpg',expectedRevision:p.revision})).status,200);
 const publicProduct=(await f.api('/api/products/'+p.id)).data.product;
 assert.equal(publicProduct.image,'/assets/demo-headphones.jpg');assert.equal(publicProduct.images[0].url,publicProduct.image);assert.equal(publicProduct.images[1].url,'/assets/demo-bottle.jpg');
});
