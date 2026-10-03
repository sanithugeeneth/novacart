import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {integrationFixture,json} from './integration-fixture.js';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTYQAAAAASUVORK5CYII=';
const env={ENABLE_VISUAL_SEARCH:'true',GOOGLE_VISION_API_KEY:'local-vision-fixture',VISUAL_SEARCH_DAILY_LIMIT:'2'};
test('visual search analyzes uploaded image bytes, searches the entire catalogue and stores no image',async t=>{
  const calls=[];const f=await integrationFixture(env,async(url,opt)=>{calls.push({url,opt});return json({responses:[{localizedObjectAnnotations:[{name:'Headphones',score:.95}],labelAnnotations:[{description:'Product',score:.99}]}]});});t.after(()=>f.close());
  for(let n=0;n<61;n++)await f.pool.query('insert into products(id,cat,title,price,image,active) values($1,$2,$3,20,$4,$5)',['p'+String(n).padStart(3,'0'),'Tech',n>=59?'Headphones':'Unrelated lamp','https://example.test/image.jpg',n!==60]);
  const r=await f.api('/api/visual-search',{method:'POST',body:{image,consent:true}});assert.equal(r.status,200);assert.deepEqual(r.data.results.map(p=>p.id),['p059']);assert.deepEqual(r.data.labels.map(l=>l.label),['headphones']);
  const body=JSON.parse(calls[0].opt.body);assert.equal(body.requests[0].image.content,image.split(',')[1]);assert.equal(body.requests[0].features[0].type,'LABEL_DETECTION');assert.equal(calls[0].opt.headers['x-goog-api-key'],env.GOOGLE_VISION_API_KEY);
  const stored=(await f.pool.query('select * from visual_searches')).rows[0];assert.equal(stored.image_url,'');assert.deepEqual(stored.results,['p059']);
});
test('visual search rejects remote URLs, malformed images, missing consent and authenticated CSRF failures before provider billing',async t=>{
  let count=0;const f=await integrationFixture(env,async()=>{count++;return json({});});t.after(()=>f.close());const account=await f.account();
  for(const body of [{imageUrl:'http://127.0.0.1/private',consent:true},{image:image.replace('image/png','image/jpeg'),consent:true},{image,consent:false},{query:'headphones'}])assert.equal((await f.api('/api/visual-search',{method:'POST',body})).status,400);
  assert.equal((await f.api('/api/visual-search',{method:'POST',body:{image,consent:true},account,csrf:null})).status,403);assert.equal(count,0);
});
test('visual search has a persistent daily budget and never invents matches on provider failure',async t=>{
  let result={responses:[{}]};const f=await integrationFixture(env,async()=>json(result));t.after(()=>f.close());
  const first=await f.api('/api/visual-search',{method:'POST',body:{image,consent:true}});assert.equal(first.status,200);assert.deepEqual(first.data.results,[]);
  result={responses:[{error:{code:13,message:'secret-provider-details'}}]};const second=await f.api('/api/visual-search',{method:'POST',body:{image,consent:true}});assert.equal(second.status,502);assert.ok(!JSON.stringify(second.data).includes('secret-provider-details'));
  assert.equal((await f.api('/api/visual-search',{method:'POST',body:{image,consent:true}})).status,429);
});
test('visual search exposes capability only when configured and accepts a normal photo over the former 200KB JSON limit',async t=>{
  const off=await integrationFixture();t.after(()=>off.close());assert.equal((await off.api('/api/visual-search/config')).data.enabled,false);assert.equal((await off.api('/api/visual-search',{method:'POST',body:{image,consent:true}})).status,503);
  let received=0;const f=await integrationFixture(env,async(_url,opt)=>{received=JSON.parse(opt.body).requests[0].image.content.length;return json({responses:[{}]});});t.after(()=>f.close());
  const original=await fs.readFile(new URL('../assets/hero-living.jpg',import.meta.url));const bytes=Buffer.concat([original,Buffer.alloc(210000)]);
  assert.equal((await f.api('/api/visual-search',{method:'POST',body:{image:'data:image/jpeg;base64,'+bytes.toString('base64'),consent:true}})).status,200);assert.ok(received>200000);
});
