import {test} from 'node:test';import assert from 'node:assert/strict';import {integrationFixture} from './integration-fixture.js';
import {configurationReport} from '../services/readiness.js';
async function fixture(options={}){
 const messages=[],f=await integrationFixture({ADMIN_MFA_REQUIRED:'true',ADMIN_MFA_METHOD:'email',MAIL_FROM:'admin@local.test'},undefined,{mailer:options.off?undefined:{sendMail:async m=>{if(options.fail)throw Error('private SMTP details');messages.push(m);return {accepted:[m.to]};}}});const a=await f.account('admin@local.test',true);
 const login=(body={},cookie)=>f.api('/api/admin/login',{method:'POST',body:{email:a.email,password:f.password,...body},cookie});
 const request=async()=>{const r=await login();return {...r,challenge:r.cookies.find(c=>c.startsWith('nc_admin_challenge='))?.split(';')[0],code:messages.at(-1)?.text.match(/\b\d{6}\b/)[0]};};return {...f,a,login,request,messages};
}
test('email OTP sends only after password verification and grants an MFA session only once',async()=>{
 const f=await fixture();try{assert.equal((await f.login({password:'wrong'})).status,401);assert.equal(f.messages.length,0);const r=await f.request();assert.equal(r.status,202);assert.equal(r.cookie,undefined);assert.equal(f.messages[0].to,f.a.email);assert.ok(!JSON.stringify(r.data).includes(r.code));assert.match(r.cookies[0],/HttpOnly/);const stored=(await f.pool.query('select * from admin_email_challenges')).rows[0];assert.notEqual(stored.code_hash,r.code);assert.ok(!JSON.stringify(stored).includes(r.challenge.split('=')[1]));const ok=await f.login({otp:r.code},r.challenge);assert.equal(ok.status,200);assert.equal((await f.api('/api/admin/metrics',{cookie:ok.cookie})).status,200);assert.equal((await f.login({otp:r.code},r.challenge)).status,401);}finally{await f.close();}
});
test('email OTP is browser bound, expires and locks after five wrong attempts',async()=>{
 const f=await fixture();try{const r=await f.request();assert.equal((await f.login({otp:r.code})).status,401);for(let i=0;i<5;i++)assert.equal((await f.login({otp:r.code==='000000'?'111111':'000000'},r.challenge)).status,401);assert.equal((await f.login({otp:r.code},r.challenge)).status,401);await f.pool.query("update admin_email_challenges set sent_at=now()-interval '61 seconds'");const next=await f.request();await f.pool.query("update admin_email_challenges set expires_at=now()-interval '1 second'");assert.equal((await f.login({otp:next.code},next.challenge)).status,401);}finally{await f.close();}
});
test('email resend cooldown and rotation invalidate previous challenge',async()=>{
 const f=await fixture();try{const old=await f.request();assert.equal((await f.request()).status,429);await f.pool.query("update admin_email_challenges set sent_at=now()-interval '61 seconds'");const fresh=await f.request();assert.equal((await f.login({otp:old.code},old.challenge)).status,401);assert.equal((await f.login({otp:fresh.code},fresh.challenge)).status,200);}finally{await f.close();}
});
test('concurrent OTP requests send once and concurrent verification creates one session',async()=>{
 const f=await fixture();try{const r=await Promise.all([f.request(),f.request()]);assert.deepEqual(r.map(x=>x.status).sort(),[202,429]);const c=r.find(x=>x.status===202);assert.equal(f.messages.length,1);const v=await Promise.all([f.login({otp:c.code},c.challenge),f.login({otp:c.code},c.challenge)]);assert.deepEqual(v.map(x=>x.status).sort(),[200,401]);}finally{await f.close();}
});
test('SMTP missing or failing never authenticates and does not expose secrets',async()=>{
 for(const opts of [{off:true},{fail:true}]){const f=await fixture(opts);try{const r=await f.request();assert.equal(r.status,503);assert.equal(r.cookie,undefined);assert.equal(r.challenge,undefined);assert.ok(!JSON.stringify(r.data).includes('private SMTP'));assert.equal((await f.pool.query('select count(*)::int n from email_outbox')).rows[0].n,0);}finally{await f.close();}}
});
test('email mode prevents ordinary login bypass and readiness requires SMTP without requiring TOTP secret',async()=>{
 const f=await fixture();try{assert.equal((await f.api('/api/auth/login',{method:'POST',body:{email:f.a.email,password:f.password}})).status,403);}finally{await f.close();}
 const r=configurationReport({NODE_ENV:'production',ADMIN_MFA_METHOD:'email',ADMIN_MFA_REQUIRED:'true'});assert.ok(!r.checks.find(c=>c.id==='store').issues.some(i=>i.includes('ADMIN_MFA_SECRET')));assert.ok(r.checks.find(c=>c.id==='email').issues.some(i=>i.includes('SMTP_HOST')));
});
