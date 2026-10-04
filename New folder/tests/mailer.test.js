import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMailer} from '../services/mailer.js';
import {configurationReport} from '../services/readiness.js';
import {integrationFixture} from './integration-fixture.js';

const env={MAIL_PROVIDER:'brevo',BREVO_API_KEY:'private-brevo-fixture',MAIL_FROM:'NovaCart <sender@local.test>'};
const response=body=>Response.json(body,{status:201});

test('Brevo authenticates without sending and maps HTML/text messages over HTTPS',async()=>{
  const calls=[],mail=createMailer(env,{fetchImpl:async(url,options)=>{
    calls.push({url,options});return response(url.endsWith('/account')?{email:'owner@local.test'}:{messageId:'test-message'});
  }});
  assert.equal(await mail.verify(),true);assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.brevo.com/v3/account');assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.body,undefined);
  const result=await mail.sendMail({to:'buyer@local.test',subject:'Order received',html:'<p>Thanks</p>',text:'Thanks'});
  assert.deepEqual(result,{messageId:'test-message',accepted:['buyer@local.test'],rejected:[]});
  const {url,options}=calls[1];assert.equal(url,'https://api.brevo.com/v3/smtp/email');
  assert.equal(options.method,'POST');assert.equal(options.headers['api-key'],env.BREVO_API_KEY);
  assert.equal(options.headers['content-type'],'application/json');assert.equal(options.redirect,'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(options.body),{sender:{email:'sender@local.test',name:'NovaCart'},to:[{email:'buyer@local.test'}],subject:'Order received',htmlContent:'<p>Thanks</p>',textContent:'Thanks'});
});

test('Brevo rejects errors, redirects, timeouts and malformed acknowledgements without leaking private data',async()=>{
  const privateError=env.BREVO_API_KEY+' buyer@local.test OTP=123456';
  const cases=[
    async()=>new Response(privateError,{status:401}),
    async()=>new Response(privateError,{status:429}),
    async()=>new Response(privateError,{status:503}),
    async()=>new Response(null,{status:302,headers:{location:'https://other.local.test'}}),
    async()=>{throw new Error(privateError);},
    async()=>{throw new DOMException(privateError,'TimeoutError');},
    async()=>new Response('not JSON',{status:200}),
    async()=>response({}),async()=>response(null)
  ];
  for(const fetchImpl of cases){
    const mail=createMailer(env,{fetchImpl});
    await assert.rejects(mail.sendMail({to:'buyer@local.test',text:'Hello'}),error=>{
      assert.ok(!error.message.includes(env.BREVO_API_KEY));assert.ok(!error.message.includes('buyer@'));assert.ok(!error.message.includes('123456'));return true;
    });
  }
  const mail=createMailer(env,{fetchImpl:cases[0]});await assert.rejects(mail.verify(),/Email provider request failed/);
});

test('mail configuration keeps SMTP default and rejects unsupported providers and ambiguous addresses',async()=>{
  assert.equal(createMailer({}),null);assert.equal(createMailer({MAIL_PROVIDER:'brevo'}),null);
  assert.throws(()=>createMailer({MAIL_PROVIDER:'unknown'}),/MAIL_PROVIDER/);
  const smtp=createMailer({SMTP_HOST:'smtp.local.test',SMTP_USER:'fixture',SMTP_PASS:'fixture'});
  assert.equal(typeof smtp.sendMail,'function');smtp.close();
  const mail=createMailer(env,{fetchImpl:()=>assert.fail('Invalid addresses must not reach the provider')});
  for(const to of ['one@local.test,two@local.test','one@local.test\r\nBcc: other@local.test','invalid']){
    await assert.rejects(mail.sendMail({to,text:'Hello'}),/Invalid email address/);
  }
});

test('Brevo readiness requires its API key and sender, not SMTP settings; credentials stay private',()=>{
  const emailCheck=e=>configurationReport(e).checks.find(c=>c.id==='email');
  assert.equal(emailCheck(env).state,'configured');
  assert.equal(emailCheck({...env,BREVO_API_KEY:''}).state,'incomplete');
  assert.equal(emailCheck({...env,MAIL_FROM:''}).state,'incomplete');
  assert.equal(emailCheck({...env,MAIL_PROVIDER:'unknown'}).state,'incomplete');
  assert.ok(!JSON.stringify(configurationReport(env)).includes(env.BREVO_API_KEY));
});

test('Brevo registration outbox retries a rejected send and records success only after acknowledgement',async()=>{
  let failing=true;const messages=[];
  const f=await integrationFixture({...env,REQUIRE_EMAIL_VERIFICATION:'true'},undefined,{mailFetch:async(url,options)=>{
    messages.push(JSON.parse(options.body));return failing?new Response('Rate limited',{status:429}):response({messageId:'queued-message'});
  }});
  try{
    const created=await f.api('/api/auth/register',{method:'POST',body:{name:'Buyer',email:'new@local.test',password:'EmailFixture123!'}});
    assert.equal(created.status,201);assert.equal(created.data.verificationSent,true);
    await f.application.processEmailOutbox();
    let row=(await f.pool.query('select * from email_outbox')).rows[0];assert.equal(row.sent_at,null);assert.equal(row.attempts,1);
    assert.ok(!row.last_error.includes(env.BREVO_API_KEY));
    failing=false;await f.pool.query('update email_outbox set next_attempt_at=now()');await f.application.processEmailOutbox();
    row=(await f.pool.query('select * from email_outbox')).rows[0];assert.ok(row.sent_at);assert.equal(messages.length,2);
    assert.equal(messages[1].to[0].email,'new@local.test');assert.match(messages[1].htmlContent,/verify-email/);
    await f.application.processEmailOutbox();assert.equal(messages.length,2);
  }finally{await f.close();}
});

test('Brevo email OTP requires the sent code and never grants a session on provider failure',async()=>{
  for(const failing of [false,true]){
    let message;
    const f=await integrationFixture({...env,ADMIN_MFA_REQUIRED:'true',ADMIN_MFA_METHOD:'email'},undefined,{mailFetch:async(url,options)=>{
      message=JSON.parse(options.body);return failing?new Response('private failure',{status:503}):response({messageId:'otp-message'});
    }});
    try{
      const admin=await f.account('admin@local.test',true),body={email:admin.email,password:f.password};
      const login=await f.api('/api/admin/login',{method:'POST',body});assert.equal(login.cookie,undefined);
      assert.equal(login.status,failing?503:202);
      if(!failing){
        const otp=message.textContent.match(/\b\d{6}\b/)[0];
        const cookie=login.cookies.find(c=>c.startsWith('nc_admin_challenge='))?.split(';')[0];
        const verified=await f.api('/api/admin/login',{method:'POST',body:{...body,otp},cookie});assert.equal(verified.status,200);
        assert.equal((await f.api('/api/admin/metrics',{cookie:verified.cookie})).status,200);
      }else{assert.ok(!JSON.stringify(login.data).includes('private failure'));}
    }finally{await f.close();}
  }
});
