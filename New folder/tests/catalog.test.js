import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {setTimeout as delay} from 'node:timers/promises';
import {JSDOM} from 'jsdom';
import {sellerFixture} from './seller-fixture.js';

let f,html,source;
const id=n=>'catalog-'+String(n).padStart(3,'0');
before(async()=>{
  f=await sellerFixture();
  await f.pool.query('update products set active=false');
  for(let n=1;n<=105;n++)await f.pool.query("insert into products(id,cat,title,price,image,stock,brand,search_keywords,created_at) values($1,$2,$3,$4,'https://example.test/product.jpg',20,$5,$6,'2026-01-01T00:00:00Z')",[id(n),n>=90?'Rare Finds':'Tech',n===99?'Nebula limited widget':'Product '+n,n,n===98?'LateBrand':'Fixture',n===97?'latekeyword':'']);
  html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
  source=await fs.readFile(new URL('../app.js',import.meta.url),'utf8');
});
after(async()=>{await f?.close();});
async function until(predicate){for(let n=0;n<1500;n++){if(predicate())return;await delay(5);}throw new Error('Timed out waiting for storefront state.');}
async function storefront({saved={},intercept}={}){
  const dom=new JSDOM(html,{url:f.base,runScripts:'outside-only'}),w=dom.window;
  const requests=[];
  w.AbortController=globalThis.AbortController;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.fetch=async(url,options={})=>{
    const path=String(url);requests.push(path);
    const run=(opts=options)=>fetch(new URL(path,f.base),opts);
    return intercept?intercept(path,options,run):run();
  };
  for(const [key,value] of Object.entries(saved))w.localStorage.setItem(key,JSON.stringify(value));
  assert.ok(source.includes(';load();'));
  vm.runInContext(source.replace(';load();',';globalThis.storeReady=load();'),dom.getInternalVMContext());
  await w.storeReady;
  return {w,dom,requests,get state(){return w.eval('state')},close(){w.close()},async search(text){const input=w.document.querySelector('#searchInput');input.value=text;input.dispatchEvent(new w.Event('input'));await until(()=>!this.state.loading);}};
}

test('API pagination reaches every active product with stable ordering and rejects bad pages',async()=>{
  const rows=[];
  for(let page=1;page<=3;page++){
    const result=await f.api(`/api/products?page=${page}&limit=48`);
    assert.equal(result.status,200);assert.equal(result.data.pagination.total,105);rows.push(...result.data.products);
  }
  assert.equal(rows.length,105);assert.equal(new Set(rows.map(p=>p.id)).size,105);
  assert.equal(rows[0].id,id(1));assert.equal(rows.at(-1).id,id(105));
  for(const query of ['page=0','page=1.2','page=abc','limit=49','limit=NaN'])assert.equal((await f.api('/api/products?'+query)).status,400);
});
test('the actual Load more button fetches beyond 48 and stops only at the end of the catalog',async()=>{
  const page=await storefront();
  try{
    assert.equal(page.state.filtered.length,12);
    while(page.state.filtered.length<105){const count=page.state.filtered.length;page.w.document.querySelector('#loadMore').click();await until(()=>!page.state.loading);assert.ok(page.state.filtered.length>count);}
    assert.equal(page.w.document.querySelectorAll('#products .product-card').length,105);
    assert.equal(new Set(page.state.filtered.map(p=>p.id)).size,105);
    assert.equal(page.w.document.querySelector('#loadMore').style.display,'none');
    assert.ok(page.requests.some(path=>path.includes('page=9')));
  }finally{page.close();}
});
test('search, brand and keyword matches include products outside the initial page',async()=>{
  const page=await storefront();
  try{
    for(const [query,n] of [['Nebula',99],['LateBrand',98],['latekeyword',97]]){
      await page.search(query);assert.equal(page.state.total,1);assert.equal(page.state.filtered[0].id,id(n));
      assert.equal(page.w.document.querySelector('#products .product-card').dataset.id,id(n));
    }
  }finally{page.close();}
});
test('category pills and sorting use the full catalog, including a category absent from page one',async()=>{
  const page=await storefront();
  try{
    const pill=[...page.w.document.querySelectorAll('.cat-pill')].find(p=>p.dataset.cat==='Rare Finds');assert.ok(pill);
    pill.click();await until(()=>!page.state.loading);assert.equal(page.state.total,16);assert.ok(page.state.filtered.every(p=>p.cat==='Rare Finds'));
    const select=page.w.document.querySelector('#sortFilter');select.value='high';select.dispatchEvent(new page.w.Event('change'));await until(()=>!page.state.loading);
    assert.equal(page.state.filtered[0].id,id(105));assert.equal(page.state.page,1);
  }finally{page.close();}
});
test('a late old search response cannot replace the newer search or unlock its loading state',async()=>{
  let release,started;
  const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
  const page=await storefront({intercept:async(path,options,run)=>{
    if(new URL(path,f.base).searchParams.get('q')==='Product 1'){const response=await run({});started();await gate;return response;}
    return run();
  }});
  try{
    page.state.query='Product 1';const old=page.w.apply();await ready;
    page.state.query='Nebula';await page.w.apply();release();await old;
    assert.equal(page.state.filtered.length,1);assert.equal(page.state.filtered[0].id,id(99));assert.equal(page.state.loading,false);
  }finally{release();page.close();}
});
test('a failed next-page request keeps products and retries that same page',async()=>{
  let failNext=true;
  const page=await storefront({intercept:(path,options,run)=>{
    if(new URL(path,f.base).searchParams.get('page')==='2'&&failNext){failNext=false;return new Response(JSON.stringify({error:'Temporary catalog error'}),{status:503,headers:{'content-type':'application/json'}});}
    return run();
  }});
  try{
    const button=page.w.document.querySelector('#loadMore');button.click();await until(()=>!page.state.loading);
    assert.equal(page.state.page,1);assert.equal(page.state.filtered.length,12);assert.equal(button.disabled,false);assert.equal(button.textContent,'Try again');
    button.click();await until(()=>!page.state.loading);assert.equal(page.state.page,2);assert.equal(page.state.filtered.length,24);
  }finally{page.close();}
});
test('saved cart and wishlist products beyond page one retain their details across searches',async()=>{
  const page=await storefront({saved:{nc_cart:[{id:id(101),qty:2}],nc_wishlist:[id(103)]}});
  try{
    assert.match(page.w.document.querySelector('#cartItems').textContent,/Product 101/);
    assert.match(page.w.document.querySelector('#wishlistItems').textContent,/Product 103/);
    assert.equal(page.w.cartTotal(),202);
    await page.search('Nebula');page.w.renderCart();page.w.renderWishlist();
    assert.equal(page.w.cartTotal(),202);assert.match(page.w.document.querySelector('#cartItems').textContent,/Product 101/);
    assert.match(page.w.document.querySelector('#wishlistItems').textContent,/Product 103/);
  }finally{page.close();}
});
