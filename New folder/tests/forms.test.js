import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {setImmediate} from 'node:timers/promises';
import {sellerFixture} from './seller-fixture.js';

let f;
before(async()=>{f=await sellerFixture();});
after(async()=>{await f?.close();});

// Run the shipped form handlers against the real HTTP server and PostgreSQL schema.
// Only DOM/FormData are adapted; the client must supply its own JSON and CSRF headers.
async function formPage(file,account=f.accounts.buyer) {
  const nodes=new Map(),pending=new Set(),requests=[],alerts=[];
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{style:{},textContent:'',innerHTML:'',fields:{},resetCount:0,querySelector(){return {disabled:false};},reset(){this.resetCount++;this.fields={};}});
    return nodes.get(selector);
  };
  const context=vm.createContext({
    document:{querySelector:node},
    FormData:class {constructor(form){this.fields=form.fields;} entries(){return Object.entries(this.fields);}},
    alert:message=>alerts.push(message),
    fetch:(url,options={})=>{
      const headers=new Headers(options.headers);
      if(account?.cookie)headers.set('cookie',account.cookie);
      headers.set('origin',f.base);
      const request={url,method:options.method||'GET',headers,body:options.body};
      requests.push(request);
      const promise=(async()=>{
        const response=await fetch(f.base+url,{...options,headers,signal:AbortSignal.timeout(15000)});
        request.status=response.status;
        const json=await response.json().catch(()=>({}));
        request.json=json;
        return {ok:response.ok,status:response.status,json:async()=>json};
      })();
      pending.add(promise);
      promise.then(()=>pending.delete(promise),()=>pending.delete(promise));
      return promise;
    }
  });
  const source=await fs.readFile(new URL('../'+file,import.meta.url),'utf8');
  const start=file==='support.js'?'load':'boot';
  assert.ok(source.trimEnd().endsWith(`${start}();`));
  vm.runInContext(source.trimEnd().slice(0,-`${start}();`.length)+`globalThis.ready=${start}();`,context);
  await context.ready;
  async function flush(){do{await Promise.all([...pending]);await setImmediate();}while(pending.size);}
  return {alerts,node,requests,context,async submit(fields){
    const form=node(file==='support.js'?'#f':'#applyForm');
    form.fields={...fields};
    const previous=requests.length;
    await form.onsubmit({target:form,preventDefault(){}});
    await flush();
    return {form,request:requests.slice(previous).find(r=>r.method==='POST')};
  }};
}

test('support form sends JSON and CSRF, saves its message and refreshes the ticket list',async()=>{
  const page=await formPage('support.js');
  const fields={subject:'Delivery update',body:'මගේ order එක ගැන විස්තර අවශ්‍යයි.\nPlease send a tracking update.',priority:'high',orderId:''};
  const {form,request}=await page.submit(fields);
  assert.equal(request.status,201,JSON.stringify(request.json));
  assert.equal(request.headers.get('content-type'),'application/json');
  assert.equal(request.headers.get('x-csrf-token'),f.accounts.buyer.csrf);
  const ticket=(await f.pool.query('select * from support_tickets where id=$1',[request.json.id])).rows[0];
  assert.equal(ticket.subject,fields.subject);assert.equal(ticket.priority,'high');
  assert.equal(ticket.user_id,f.accounts.buyer.id);assert.equal(ticket.order_id,null);
  const message=(await f.pool.query('select * from support_messages where ticket_id=$1',[ticket.id])).rows[0];
  assert.equal(message.body,fields.body);assert.equal(message.sender_user_id,f.accounts.buyer.id);
  assert.equal(form.resetCount,1);assert.equal(page.node('#supportStatus').textContent,'Ticket created.');
  assert.match(page.node('#tickets').innerHTML,/Delivery update/);
});

test('support form accepts a real order reference and the ticket stays private to its owner',async()=>{
  const order=await f.checkout([{id:'platform-product',qty:1}]);
  assert.equal(order.status,200);
  const page=await formPage('support.js');
  const {request}=await page.submit({subject:'Order question',body:'Can you confirm the delivery date?',priority:'normal',orderId:order.data.orderId});
  assert.equal(request.status,201,JSON.stringify(request.json));
  const path='/api/support/tickets/'+request.json.id;
  const own=await f.api(path,{account:f.accounts.buyer});
  assert.equal(own.status,200);assert.equal(own.data.ticket.order_id,order.data.orderId);
  assert.equal((await f.api(path,{account:f.accounts.alpha})).status,404);
});

test('seller application sends all fields as JSON and saves a pending profile once',async()=>{
  const page=await formPage('seller.js');
  const fields={storeName:'Form Fixture Store',slug:'form-fixture-store',businessEmail:'store@local.test',businessPhone:'+94770000000',country:'LK',address:'12 Test Road',description:'A local test store.'};
  const {form,request}=await page.submit(fields);
  assert.equal(request.status,201,JSON.stringify(request.json));
  assert.equal(request.headers.get('content-type'),'application/json');
  assert.equal(request.headers.get('x-csrf-token'),f.accounts.buyer.csrf);
  const profile=(await f.pool.query('select * from sellers where user_id=$1',[f.accounts.buyer.id])).rows[0];
  assert.equal(profile.store_name,fields.storeName);assert.equal(profile.slug,fields.slug);
  assert.equal(profile.business_email,fields.businessEmail);assert.equal(profile.business_phone,fields.businessPhone);
  assert.equal(profile.country,fields.country);assert.equal(profile.address,fields.address);assert.equal(profile.description,fields.description);
  assert.equal(profile.status,'pending');assert.notEqual(profile.id,profile.user_id);
  assert.equal(form.resetCount,1);assert.equal(page.node('#sellerStatus').textContent,'Application submitted.');
  const duplicate=await page.submit(fields);
  assert.equal(duplicate.request.status,409);assert.equal(form.resetCount,1);
  assert.deepEqual(form.fields,fields);
  assert.equal((await f.pool.query('select id from sellers where user_id=$1',[f.accounts.buyer.id])).rowCount,1);
});

test('both forms retain entered data and display errors for missing required fields',async()=>{
  for(const [file,fields] of [['support.js',{subject:'',body:'A test message',priority:'normal',orderId:''}],['seller.js',{storeName:'',slug:'another-store'}]]) {
    const page=await formPage(file);
    const {request,form}=await page.submit(fields);
    assert.equal(request.status,400,file);assert.match(page.node(file==='support.js'?'#supportStatus':'#sellerStatus').textContent,/required/i);
    assert.equal(form.resetCount,0);assert.deepEqual(form.fields,fields);
  }
});

test('both form submissions still enforce authentication and CSRF',async()=>{
  for(const [file,fields] of [['support.js',{subject:'Test subject',body:'Test message',priority:'normal',orderId:''}],['seller.js',{storeName:'Test Store',slug:'test-store'}]]) {
    const page=await formPage(file);
    vm.runInContext("csrf='invalid-token';",page.context);
    const rejected=await page.submit(fields);
    assert.equal(rejected.request.status,403,file);assert.equal(rejected.form.resetCount,0);
    const signedOut=await formPage(file,null);
    const anonymous=await signedOut.submit(fields);
    assert.equal(anonymous.request.status,401,file);assert.equal(anonymous.form.resetCount,0);
  }
});
