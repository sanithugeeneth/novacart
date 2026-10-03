import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {sellerFixture} from './seller-fixture.js';
let f;
before(async()=>{f=await sellerFixture({env:{CURRENCY:'LKR'}});await f.pool.query("update products set image='/assets/demo-lamp.jpg',description='A considered desk lamp.',old_price=40,seo_title='A lamp for your desk',seo_description='Explore this desk lamp.' where id='alpha-product'");});
after(async()=>{await f?.close();});
const page=async path=>{const response=await fetch(f.base+path,{redirect:'manual'}),html=await response.text();return {response,html,doc:new JSDOM(html).window.document};};
test('sitemap product URL serves the complete styled product in the initial HTML',async()=>{
 const {response,html,doc}=await page('/p/alpha-product');assert.equal(response.status,200);assert.equal(doc.querySelector('#detailTitle').textContent,'alpha-product');assert.match(doc.querySelector('#detailPrice').textContent,/LKR.*30\.00/);assert.match(doc.querySelector('#longCopy').textContent,/considered desk lamp/);assert.ok(doc.querySelector('#addToCart'));assert.ok(doc.querySelector('#buyNow'));assert.ok(doc.querySelector('.product-hero-detail'));assert.ok(!html.includes('View full product'));assert.ok(!html.includes('Loading product'));
 const bootstrap=JSON.parse(doc.querySelector('#productBootstrap').textContent);assert.equal(bootstrap.product.id,'alpha-product');assert.equal(bootstrap.product.currency,'LKR');assert.equal(bootstrap.product.variants[0].id,'alpha-variant');for(const field of ['seller_id','cost_price','password_hash'])assert.equal(field in bootstrap.product,false);
});
test('metadata, canonical, offer and main image agree with the visible product selection',async()=>{
 const {doc}=await page('/p/alpha-product?campaign=test');assert.equal(doc.title,'A lamp for your desk');assert.equal(doc.querySelector('meta[name=description]').content,'Explore this desk lamp.');assert.equal(doc.querySelector('link[rel=canonical]').href,f.base+'/p/alpha-product');assert.equal(doc.querySelector('meta[property="og:url"]').content,f.base+'/p/alpha-product');
 assert.match(doc.querySelector('#detailOldPrice').textContent,/LKR.*40\.00/);const schema=JSON.parse(doc.querySelector('#productStructuredData').textContent);assert.equal(schema.offers.price,'30.00');assert.equal(schema.offers.priceCurrency,'LKR');assert.equal(schema.offers.availability,'https://schema.org/InStock');assert.equal(schema.aggregateRating,undefined);assert.equal(schema.image[0],f.base+'/assets/demo-lamp.jpg');assert.equal(doc.querySelector('#mainProductImage').src,schema.image[0]);
});
test('all page CSS, JavaScript, icon and local product media resolve from nested URLs',async()=>{
 const {doc}=await page('/p/alpha-product');for(const el of doc.querySelectorAll('link[rel=stylesheet],link[rel=icon],script[src]')){const url=el.getAttribute('href')||el.getAttribute('src');assert.ok(url.startsWith('/'));const r=await fetch(f.base+url);assert.equal(r.status,200,url);}
 assert.equal((await fetch(doc.querySelector('#mainProductImage').src)).status,200);
});
test('old product URLs redirect automatically to the canonical full page',async()=>{
 const r=await fetch(f.base+'/product.html?id=alpha-product',{redirect:'manual'});assert.equal(r.status,301);assert.equal(r.headers.get('location'),'/p/alpha-product');
 const missing=await page('/product.html?id=missing');assert.equal(missing.response.status,404);assert.equal(missing.response.headers.get('x-robots-tag'),'noindex');
});
test('missing and inactive products return styled 404s and inactive products stay out of the sitemap',async()=>{
 await f.pool.query("update products set active=false where id='beta-product'");for(const path of ['/p/missing','/p/beta-product']){const p=await page(path);assert.equal(p.response.status,404);assert.equal(p.response.headers.get('x-robots-tag'),'noindex');assert.ok(p.doc.querySelector('link[href="/forma-ui.css"]'));}
 const xml=await (await fetch(f.base+'/sitemap.xml')).text();assert.ok(xml.includes('/p/alpha-product'));assert.ok(!xml.includes('/p/beta-product'));
});
test('out-of-stock variants produce matching availability and no-script controls stay disabled',async()=>{
 await f.pool.query("update product_variants set stock=0 where id='alpha-variant'");const {doc}=await page('/p/alpha-product');assert.equal(doc.querySelector('#stockText').textContent,'Out of stock');assert.equal(JSON.parse(doc.querySelector('#productStructuredData').textContent).offers.availability,'https://schema.org/OutOfStock');assert.equal(doc.querySelector('#addToCart').disabled,true);assert.ok(doc.querySelector('noscript'));
 await f.pool.query("update product_variants set stock=20 where id='alpha-variant'");
});
test('product-controlled HTML and script delimiters are escaped in markup and bootstrap JSON',async()=>{
 const malicious='Lamp </script><script>globalThis.pwned=true</script> & "bright"';await f.pool.query("update products set title=$1,description=$1,seo_title=$1 where id='platform-product'",[malicious]);const {doc}=await page('/p/platform-product');assert.equal(doc.querySelector('#detailTitle').textContent,malicious);assert.equal(doc.title,malicious);assert.equal(JSON.parse(doc.querySelector('#productBootstrap').textContent).product.title,malicious);assert.equal(doc.querySelectorAll('script:not([src]):not([type="application/json"]):not([type="application/ld+json"])').length,0);
});
test('long and unicode slugs and legacy empty slugs resolve exactly as advertised in the sitemap',async()=>{
 const slug='ලස්සන-ලාම්පුව-'+('long-'.repeat(40));await f.pool.query("update products set slug=$1 where id='alpha-product'",[slug]);let p=await page('/p/'+encodeURIComponent(slug));assert.equal(p.response.status,200);assert.equal(p.doc.querySelector('link[rel=canonical]').href,f.base+'/p/'+encodeURIComponent(slug));await f.pool.query("update products set slug='' where id='alpha-product'");p=await page('/p/alpha-product');assert.equal(p.response.status,200);assert.ok((await (await fetch(f.base+'/sitemap.xml')).text()).includes('/p/alpha-product'));
});
