import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {providerJSON, enabled, IntegrationError} from './provider-http.js';

const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const encoded = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const definitions = {
  google: {authorize:'https://accounts.google.com/o/oauth2/v2/auth', token:'https://oauth2.googleapis.com/token', jwks:'https://www.googleapis.com/oauth2/v3/certs', issuers:['https://accounts.google.com','accounts.google.com']},
  apple: {authorize:'https://appleid.apple.com/auth/authorize', token:'https://appleid.apple.com/auth/token', jwks:'https://appleid.apple.com/auth/keys', issuers:['https://appleid.apple.com']}
};

export function appleClientSecret(env, now = Math.floor(Date.now()/1000)) {
  const head = encoded({alg:'ES256',kid:env.OAUTH_APPLE_KEY_ID});
  const payload = encoded({iss:env.OAUTH_APPLE_TEAM_ID,iat:now,exp:now+300,aud:'https://appleid.apple.com',sub:env.OAUTH_APPLE_CLIENT_ID});
  const signature = crypto.sign('sha256',Buffer.from(`${head}.${payload}`),{key:String(env.OAUTH_APPLE_PRIVATE_KEY||'').replace(/\\n/g,'\n'),dsaEncoding:'ieee-p1363'});
  return `${head}.${payload}.${signature.toString('base64url')}`;
}

export function registerOAuth({app,pool,env,BASE,auth,authLimiter,csrfOk,getSession,createSession,audit,fetcher=fetch}) {
  const cache = new Map();
  const config = name => {
    const prefix = `OAUTH_${name.toUpperCase()}_`;
    let appleKeyValid=false;try{const key=crypto.createPrivateKey(String(env.OAUTH_APPLE_PRIVATE_KEY||'').replace(/\\n/g,'\n'));appleKeyValid=key.asymmetricKeyType==='ec'&&key.asymmetricKeyDetails?.namedCurve==='prime256v1';}catch{}
    const configured = name==='google' ? Boolean(env[prefix+'CLIENT_ID']&&env[prefix+'CLIENT_SECRET']) : Boolean(env[prefix+'CLIENT_ID']&&env[prefix+'TEAM_ID']&&env[prefix+'KEY_ID']&&appleKeyValid&&BASE.startsWith('https://')&&!/^https:\/\/(?:localhost|127\.|\[::1\])/.test(BASE));
    return {enabled:enabled(env['ENABLE_OAUTH_'+name.toUpperCase()]),configured,callback:`${BASE}/api/oauth/${name}/callback`};
  };
  const cookieOptions = name => ({httpOnly:true,secure:BASE.startsWith('https://'),sameSite:name==='apple'?'none':'lax',path:'/api/oauth',maxAge:600000});
  const ready = name => { const c=config(name); if(!c.enabled||!c.configured) throw new IntegrationError(`${name==='google'?'Google':'Apple'} sign-in is not configured.`,503); return c; };
  async function identity(name, jwt, nonce) {
    if(typeof jwt!=='string'||jwt.length>16000||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(jwt))throw new Error('Invalid token');
    const [h,p,s]=jwt.split('.'); const header=JSON.parse(Buffer.from(h,'base64url')); const claims=JSON.parse(Buffer.from(p,'base64url'));
    if(!(header.alg==='RS256'||name==='apple'&&header.alg==='ES256')||typeof header.kid!=='string')throw new Error('Invalid token');
    let saved=cache.get(name);
    if(!saved||saved.until<Date.now()||(!saved.keys.some(k=>k.kid===header.kid)&&Date.now()-saved.fetched>30000)) {
      const body=await providerJSON(fetcher,definitions[name].jwks);
      if(!Array.isArray(body.keys)||body.keys.length>30)throw new Error('Invalid keys');
      saved={keys:body.keys,until:Date.now()+600000,fetched:Date.now()};cache.set(name,saved);
    }
    const key=saved.keys.find(k=>k.kid===header.kid&&(header.alg==='RS256'?k.kty==='RSA':k.kty==='EC'&&k.crv==='P-256')&&(!k.use||k.use==='sig')&&(!k.alg||k.alg===header.alg));
    if(!key)throw new Error('Invalid key');
    const publicKey=crypto.createPublicKey({key,format:'jwk'});
    const verified=crypto.verify('sha256',Buffer.from(`${h}.${p}`),header.alg==='ES256'?{key:publicKey,dsaEncoding:'ieee-p1363'}:publicKey,Buffer.from(s,'base64url'));
    if(!verified)throw new Error('Invalid signature');
    const now=Math.floor(Date.now()/1000),clientId=env[`OAUTH_${name.toUpperCase()}_CLIENT_ID`];
    const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
    if(!definitions[name].issuers.includes(claims.iss)||!audiences.includes(clientId)||(audiences.length>1&&claims.azp!==clientId)||(claims.azp&&claims.azp!==clientId)||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+60||claims.iat<now-900||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255)throw new Error('Invalid claims');
    return claims;
  }
  async function start(req,res,name,linkUser=null) {
    try {
      const c=ready(name),state=token(),binding=token(),nonce=token(),verifier=name==='google'?token():'';
      await pool.query('delete from oauth_states where expires_at<now()');
      await pool.query(`insert into oauth_states(state_hash,provider,binding_hash,nonce,pkce_verifier,link_user_id,link_session_id,expires_at) values($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')`,[hash(state),name,hash(binding),nonce,verifier,linkUser?.uid||null,linkUser?.session_id||null]);
      res.cookie('nc_oauth_'+name,binding,cookieOptions(name));
      const url=new URL(definitions[name].authorize);
      for(const [k,v] of Object.entries({client_id:env[`OAUTH_${name.toUpperCase()}_CLIENT_ID`],redirect_uri:c.callback,response_type:'code',scope:name==='google'?'openid email profile':'name email',state,nonce}))url.searchParams.set(k,v);
      if(name==='google'){url.searchParams.set('code_challenge',crypto.createHash('sha256').update(verifier).digest('base64url'));url.searchParams.set('code_challenge_method','S256');}
      else url.searchParams.set('response_mode','form_post');
      res.set('Cache-Control','no-store');
      return linkUser?res.json({url:url.toString()}):res.redirect(url.toString());
    }catch(error){return res.status(error.status||503).json({error:error instanceof IntegrationError?error.message:'Sign-in could not be started.'});}
  }
  app.get('/api/oauth/providers',(_req,res)=>res.json({google:config('google'),apple:config('apple')}));
  app.get('/api/oauth/accounts',auth,async(req,res)=>{
    const result=await pool.query('select provider,created_at from oauth_accounts where user_id=$1',[req.session.uid]);res.json({accounts:result.rows});
  });
  for(const name of Object.keys(definitions)) {
    app.get(`/api/oauth/${name}`,authLimiter,(req,res)=>start(req,res,name));
    app.post(`/api/oauth/${name}/link`,authLimiter,auth,(req,res)=>{
      if(!csrfOk(req))return res.status(403).json({error:'Invalid CSRF token.'});
      if(req.session.is_admin)return res.status(403).json({error:'Administrators must use the admin sign-in and MFA flow.'});
      return start(req,res,name,req.session);
    });
    const callback=async(req,res)=>{
      res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');
      const body=name==='apple'?req.body:req.query;
      const state=typeof body?.state==='string'?body.state:'';
      const binding=req.cookies['nc_oauth_'+name];
      let client;
      let reason='verification_failed';
      try {
        const c=ready(name);
        if(!/^[-\w]{43}$/.test(state)||typeof binding!=='string'||binding.length!==43)throw new Error('Missing state');
        const consumed=await pool.query(`delete from oauth_states where state_hash=$1 and provider=$2 and binding_hash=$3 and expires_at>now() returning *`,[hash(state),name,hash(binding)]);
        if(!consumed.rowCount)throw new Error('Invalid state');
        res.clearCookie('nc_oauth_'+name,cookieOptions(name));
        const attempt=consumed.rows[0];
        if(body.error){reason='cancelled';throw new Error('Provider declined');}
        if(typeof body.code!=='string'||!body.code||body.code.length>5000)throw new Error('Missing code');
        const form=new URLSearchParams({grant_type:'authorization_code',code:body.code,redirect_uri:c.callback,client_id:env[`OAUTH_${name.toUpperCase()}_CLIENT_ID`],client_secret:name==='google'?env.OAUTH_GOOGLE_CLIENT_SECRET:appleClientSecret(env)});
        if(attempt.pkce_verifier)form.set('code_verifier',attempt.pkce_verifier);
        const tokens=await providerJSON(fetcher,definitions[name].token,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form.toString()});
        const claims=await identity(name,tokens.id_token,attempt.nonce);
        client=await pool.connect();await client.query('begin');
        // Serialize first login/link for the provider subject, including concurrent callbacks.
        await client.query('select pg_advisory_xact_lock(hashtext($1))',[name+':'+claims.sub]);
        const existing=await client.query(`select u.* from oauth_accounts oa join users u on u.id=oa.user_id where oa.provider=$1 and oa.provider_user_id=$2`,[name,claims.sub]);
        let user=existing.rows[0];
        if(attempt.link_user_id) {
          const live=await client.query(`select u.* from users u join sessions s on s.user_id=u.id where u.id=$1 and s.id=$2 and s.revoked_at is null and s.expires_at>now()`,[attempt.link_user_id,attempt.link_session_id]);
          if(!live.rowCount||live.rows[0].is_admin||(user&&user.id!==attempt.link_user_id))throw new Error('Link denied');
          user=live.rows[0];
        } else if(!user) {
          const email=String(claims.email||'').trim().toLowerCase();
          if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||![true,'true'].includes(claims.email_verified))throw new Error('Verified email required');
          const collision=await client.query('select id from users where email=$1',[email]);
          if(collision.rowCount){reason='link_required';throw new Error('Existing email requires explicit linking');}
          user={id:crypto.randomUUID(),name:String(claims.name||email.split('@')[0]).slice(0,100),email,is_admin:false};
          await client.query(`insert into users(id,name,email,password_hash,email_verified) values($1,$2,$3,$4,true)`,[user.id,user.name,email,await bcrypt.hash(token(),12)]);
        }
        if(user.is_admin){reason='admin_required';throw new Error('Admin requires MFA');}
        await client.query(`insert into oauth_accounts(id,user_id,provider,provider_user_id) values($1,$2,$3,$4) on conflict(provider,provider_user_id) do nothing`,[crypto.randomUUID(),user.id,name,claims.sub]);
        await client.query('update users set last_login_at=now() where id=$1',[user.id]);
        await client.query('commit');client.release();client=null;
        if(!attempt.link_user_id)await createSession(req,res,user.id);
        await audit(user.id,attempt.link_user_id?'oauth_link':'oauth_login','user',user.id,{provider:name});
        return res.redirect('/account.html?oauth=success');
      } catch(error) {
        if(client){await client.query('rollback').catch(()=>{});client.release();}
        return res.redirect('/login.html?oauth_error='+reason);
      }
    };
    if(name==='apple')app.post('/api/oauth/apple/callback',authLimiter,callback);
    else app.get('/api/oauth/google/callback',authLimiter,callback);
  }
}
