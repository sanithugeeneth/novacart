import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {integrationFixture,json} from './integration-fixture.js';

const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const appleKey=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const env={ENABLE_OAUTH_GOOGLE:'true',OAUTH_GOOGLE_CLIENT_ID:'google-client',OAUTH_GOOGLE_CLIENT_SECRET:'google-secret',ENABLE_OAUTH_APPLE:'true',OAUTH_APPLE_CLIENT_ID:'apple-client',OAUTH_APPLE_TEAM_ID:'team',OAUTH_APPLE_KEY_ID:'key',OAUTH_APPLE_PRIVATE_KEY:appleKey.privateKey.export({format:'pem',type:'pkcs8'}),PUBLIC_BASE_URL:'https://store.test'};
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
function signed(claims,key=rsa.privateKey){const data=enc({alg:'RS256',kid:'test-key'})+'.'+enc(claims);return data+'.'+crypto.sign('RSA-SHA256',Buffer.from(data),key).toString('base64url');}
async function fixture(t){
  const codes=new Map();const exchanges=[];
  const f=await integrationFixture(env,async(url,opt)=>{
    if(url.includes('certs')||url.endsWith('/keys'))return json({keys:[{...rsa.publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'},{...appleKey.publicKey.export({format:'jwk'}),kid:'test-ec',alg:'ES256',use:'sig'}]});
    if(url.endsWith('/token')){const fields=Object.fromEntries(new URLSearchParams(opt.body));exchanges.push(fields);const claims=codes.get(fields.code);assert.ok(claims,'authorization code is known');if(url.includes('appleid')){const [h,p,s]=fields.client_secret.split('.');assert.equal(JSON.parse(Buffer.from(h,'base64url')).alg,'ES256');assert.equal(JSON.parse(Buffer.from(p,'base64url')).sub,env.OAUTH_APPLE_CLIENT_ID);assert.ok(crypto.verify('sha256',Buffer.from(h+'.'+p),{key:appleKey.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')));}return json({id_token:typeof claims==='string'?claims:signed(claims)});}
    throw new Error('Unexpected endpoint');
  });t.after(()=>f.close());
  async function start(provider='google',claims={},account){
    const r=account?await f.api('/api/oauth/'+provider+'/link',{method:'POST',body:{},account}):await f.api('/api/oauth/'+provider);
    assert.equal(r.status,account?200:302);const u=new URL(account?r.data.url:r.location),code=crypto.randomUUID(),now=Math.floor(Date.now()/1000);
    codes.set(code,{iss:provider==='google'?'https://accounts.google.com':'https://appleid.apple.com',aud:env['OAUTH_'+provider.toUpperCase()+'_CLIENT_ID'],sub:'provider-user',iat:now,exp:now+300,nonce:u.searchParams.get('nonce'),email:'new@local.test',email_verified:true,name:'New User',...claims});
    const cookie=r.cookies.find(c=>c.startsWith('nc_oauth_'+provider+'=')).split(';')[0];
    return {provider,u,code,state:u.searchParams.get('state'),cookie,rawCookie:r.cookies[0]};
  }
  const finish=(s,overrides={})=>s.provider==='apple'?f.api('/api/oauth/apple/callback',{method:'POST',form:{state:s.state,code:s.code},cookie:s.cookie,headers:{origin:'https://appleid.apple.com'},...overrides}):f.api('/api/oauth/google/callback?'+new URLSearchParams({state:s.state,code:s.code}),{cookie:s.cookie,...overrides});
  return {...f,start,finish,codes,exchanges};
}
test('OAuth hides unconfigured providers and replaces placeholder endpoints with 503',async t=>{
  const f=await integrationFixture();t.after(()=>f.close());
  const providers=await f.api('/api/oauth/providers');assert.equal(providers.data.google.configured,false);assert.equal(providers.data.apple.configured,false);
  assert.equal((await f.api('/api/oauth/google')).status,503);assert.equal((await f.api('/api/oauth/apple')).status,503);
});
test('Google uses PKCE, creates a verified account and binds a one-use state to its browser',async t=>{
  const f=await fixture(t),s=await f.start();
  assert.equal(s.u.searchParams.get('code_challenge_method'),'S256');
  const wrong=await f.finish(s,{cookie:'nc_oauth_google='+crypto.randomBytes(32).toString('base64url')});assert.match(wrong.location,/verification_failed/);assert.equal(f.exchanges.length,0);
  const done=await f.finish(s);assert.equal(done.location,'/account.html?oauth=success');assert.ok(done.cookie);
  assert.equal(crypto.createHash('sha256').update(f.exchanges[0].code_verifier).digest('base64url'),s.u.searchParams.get('code_challenge'));
  assert.equal((await f.api('/api/auth/me',{cookie:done.cookie})).data.user.email,'new@local.test');
  const replay=await f.finish(s);assert.match(replay.location,/verification_failed/);assert.equal(f.exchanges.length,1);
  assert.equal((await f.pool.query('select * from oauth_accounts')).rowCount,1);
  const again=await f.finish(await f.start());assert.ok(again.cookie);assert.equal((await f.pool.query('select * from users')).rowCount,1);
});
test('OAuth rejects wrong issuer, audience, nonce, expiry and invalid signatures',async t=>{
  const f=await fixture(t);
  for(const claims of [{iss:'https://evil.test'},{aud:'other-client'},{nonce:'wrong'},{exp:1},{iat:Date.now()/1000+200},{email_verified:false}]){
    const r=await f.finish(await f.start('google',claims));assert.match(r.location,/verification_failed/);assert.equal(r.cookie,undefined);
  }
  const s=await f.start();const token=signed(f.codes.get(s.code));f.codes.set(s.code,token.slice(0,-5)+'AAAAA');assert.match((await f.finish(s)).location,/verification_failed/);
  assert.equal((await f.pool.query('select * from users')).rowCount,0);
});
test('existing emails require explicit linking; links require CSRF and cannot target admin accounts',async t=>{
  const f=await fixture(t),buyer=await f.account('new@local.test');
  const collision=await f.finish(await f.start());assert.match(collision.location,/link_required/);assert.equal(collision.cookie,undefined);
  assert.equal((await f.api('/api/oauth/google/link',{method:'POST',body:{},account:buyer,csrf:null})).status,403);
  const linked=await f.finish(await f.start('google',{},buyer));assert.equal(linked.location,'/account.html?oauth=success');
  const session=await f.finish(await f.start());assert.equal((await f.api('/api/auth/me',{cookie:session.cookie})).data.user.id,buyer.id);
  const admin=await f.account('admin@local.test',true);assert.equal((await f.api('/api/oauth/google/link',{method:'POST',body:{},account:admin})).status,403);
  await f.pool.query('update users set is_admin=true where id=$1',[buyer.id]);
  const blocked=await f.finish(await f.start());assert.match(blocked.location,/admin_required/);assert.equal(blocked.cookie,undefined);
});
test('Apple signs its client secret and accepts a browser-bound form_post callback',async t=>{
  const f=await fixture(t),s=await f.start('apple');
  assert.equal(s.u.searchParams.get('response_mode'),'form_post');assert.match(s.rawCookie,/SameSite=None/);assert.match(s.rawCookie,/Secure/);
  const r=await f.finish(s);assert.equal(r.location,'/account.html?oauth=success');assert.ok(r.cookie);
  assert.equal(f.exchanges[0].redirect_uri,'https://store.test/api/oauth/apple/callback');
  const reused=await f.finish(s);assert.match(reused.location,/verification_failed/);
  const ec=await f.start('apple');const signing=enc({kid:'test-ec',alg:'ES256'})+'.'+enc(f.codes.get(ec.code));f.codes.set(ec.code,signing+'.'+crypto.sign('sha256',Buffer.from(signing),{key:appleKey.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url'));assert.equal((await f.finish(ec)).location,'/account.html?oauth=success');
});
test('expired OAuth transactions and revoked linking sessions cannot sign in or connect an account',async t=>{
  const f=await fixture(t),s=await f.start();await f.pool.query("update oauth_states set expires_at=now()-interval '1 second'");assert.match((await f.finish(s)).location,/verification_failed/);
  const account=await f.account('existing@local.test'),link=await f.start('google',{},account);await f.pool.query('update sessions set revoked_at=now() where user_id=$1',[account.id]);assert.match((await f.finish(link)).location,/verification_failed/);assert.equal((await f.pool.query('select * from oauth_accounts')).rowCount,0);
});
