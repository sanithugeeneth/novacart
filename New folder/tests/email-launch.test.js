import {test} from 'node:test';
import assert from 'node:assert/strict';
import {integrationFixture} from './integration-fixture.js';
import {sellerFixture} from './seller-fixture.js';

test('registration verification and reset emails deliver through the outbox; links are single-use and reset revokes sessions',async()=>{
  const messages=[],mailer={sendMail:async m=>messages.push(m)};
  const f=await integrationFixture({REQUIRE_EMAIL_VERIFICATION:'true'},undefined,{mailer});
  try{
    const email='new@local.test',password='EmailFixture123!';
    const created=await f.api('/api/auth/register',{method:'POST',body:{name:'Buyer <img src=x>',email,password}});assert.equal(created.status,201);assert.equal(created.data.verificationSent,true);
    assert.equal((await f.api('/api/auth/login',{method:'POST',body:{email,password}})).status,403);
    await f.application.processEmailOutbox();assert.equal(messages.length,1);assert.ok(!messages[0].html.includes('<img'));assert.ok(messages[0].html.includes('&lt;img'));
    const token=new URL(messages[0].text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
    assert.equal((await f.api('/api/auth/verify-email',{method:'POST',body:{token}})).status,200);
    assert.equal((await f.api('/api/auth/verify-email',{method:'POST',body:{token}})).status,400);
    const login=await f.api('/api/auth/login',{method:'POST',body:{email,password}});assert.equal(login.status,200);
    assert.equal((await f.api('/api/auth/forgot',{method:'POST',body:{email}})).status,200);
    await f.application.processEmailOutbox();assert.equal(messages.length,2);
    const resetToken=new URL(messages[1].text.match(/https?:\/\/\S+/)[0]).searchParams.get('token'),newPassword='Replacement123!';
    assert.equal((await f.api('/api/auth/reset',{method:'POST',body:{token:resetToken,password:newPassword}})).status,200);
    assert.equal((await f.api('/api/auth/reset',{method:'POST',body:{token:resetToken,password:newPassword}})).status,400);
    assert.equal((await f.api('/api/customer',{cookie:login.cookie})).status,401);
    assert.equal((await f.api('/api/auth/login',{method:'POST',body:{email,password:newPassword}})).status,200);
  }finally{await f.close();}
});
test('an SMTP failure retries later and concurrent email workers do not claim the same row',async()=>{
  let failures=1;const messages=[],mailer={sendMail:async m=>{if(failures-- >0)throw new Error('Temporary SMTP fixture failure');messages.push(m);}};
  const f=await integrationFixture({},undefined,{mailer});
  try{
    await f.pool.query("insert into email_outbox(to_email,subject,html,text_body) values('local@local.test','Fixture','<p>Retry</p>','Retry')");
    await f.application.processEmailOutbox();const pending=(await f.pool.query('select * from email_outbox')).rows[0];assert.equal(pending.sent_at,null);assert.equal(pending.attempts,1);assert.ok(new Date(pending.next_attempt_at)>new Date());
    await f.application.processEmailOutbox();assert.equal(messages.length,0);
    await f.pool.query("update email_outbox set next_attempt_at=now()-interval '1 second'");
    await Promise.all([f.application.processEmailOutbox(),f.application.processEmailOutbox()]);assert.equal(messages.length,1);assert.ok((await f.pool.query('select sent_at from email_outbox')).rows[0].sent_at);
  }finally{await f.close();}
});
test('a verified paid checkout sends one order confirmation through the mail worker',async()=>{
  const messages=[],f=await sellerFixture({mailer:{sendMail:async m=>messages.push(m)}});
  try{const order=await f.checkout([{id:'platform-product',qty:1}],'stripe');assert.equal(order.status,200);assert.equal((await f.pay(order.data.id)).status,200);assert.equal((await f.pay(order.data.id)).status,200);await f.application.processEmailOutbox();assert.equal(messages.filter(m=>m.subject.includes(order.data.id)).length,1);}
  finally{await f.close();}
});
