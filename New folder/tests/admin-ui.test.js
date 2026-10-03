import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {setImmediate} from 'node:timers/promises';
import {JSDOM} from 'jsdom';
import {sellerFixture} from './seller-fixture.js';
let f,admin,html,source;
before(async()=>{
 f=await sellerFixture();
 await f.pool.query('update users set is_admin=true where id=$1',[f.accounts.orphan.id]);
 const login=await f.api('/api/admin/login',{method:'POST',body:{email:f.accounts.orphan.email,password:f.password}});
 assert.equal(login.status,200);admin={cookie:login.cookie};
 await f.checkout([{id:'platform-product',qty:1}]);
 html=await fs.readFile(new URL('../admin.html',import.meta.url),'utf8');source=await fs.readFile(new URL('../admin.js',import.meta.url),'utf8');
});
after(async()=>{await f?.close();});
async function page(account){
 const dom=new JSDOM(html,{url:f.base+'/admin.html',runScripts:'outside-only'}),w=dom.window,requests=[],pending=new Set();
 w.fetch=(url,options={})=>{
  requests.push(String(url));const headers=new Headers(options.headers);if(account?.cookie)headers.set('cookie',account.cookie);
  const task=(async()=>{const response=await fetch(f.base+url,{...options,headers});const data=await response.json().catch(()=>({}));return{ok:response.ok,status:response.status,json:async()=>data};})();
  pending.add(task);task.then(()=>pending.delete(task),()=>pending.delete(task));return task;
 };
 vm.runInContext(await fs.readFile(new URL('../workspace-money.js',import.meta.url),'utf8'),dom.getInternalVMContext());
 vm.runInContext(source,dom.getInternalVMContext());
 async function flush(){do{await Promise.all([...pending]);await setImmediate();}while(pending.size);}
 await flush();return {w,requests,flush,close:()=>w.close()};
}
test('admin workspace restores a server-approved session, renders charts and waits for media clicks',async()=>{
 const p=await page(admin);
 try{
  const d=p.w.document;assert.equal(d.querySelector('#app').classList.contains('hidden'),false);
  assert.match(d.querySelector('#lastSync').textContent,/SYNCED/);
  assert.ok(d.querySelectorAll('#overviewChart .bar').length>0);
  assert.equal(d.querySelectorAll('#productsTable tbody tr').length,6);
  assert.ok(p.requests.includes('/api/admin/products'));
  assert.equal(p.requests.some(url=>url.startsWith('/api/admin/products/')),false);
  assert.equal(d.querySelector('#modalBackdrop').classList.contains('open'),false);
  d.querySelector('[data-product-assets]').click();await p.flush();
  assert.equal(d.querySelector('#modalBackdrop').classList.contains('open'),true);
  assert.match(d.querySelector('#modal').textContent,/Media/);
  d.querySelector('[data-close-modal]').click();assert.equal(d.querySelector('#modalBackdrop').classList.contains('open'),false);
 }finally{p.close();}
});
test('anonymous and customer sessions never enter the admin workspace',async()=>{
 for(const account of [null,f.accounts.buyer]){
  const p=await page(account);
  try{assert.equal(p.w.document.querySelector('#app').classList.contains('hidden'),true);assert.deepEqual(p.requests,['/api/admin/metrics','/api/admin/auth-method']);}finally{p.close();}
 }
});
