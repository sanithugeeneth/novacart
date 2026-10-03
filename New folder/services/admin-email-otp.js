import crypto from 'node:crypto';
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const codeHash=(token,code)=>crypto.createHmac('sha256',token).update(code).digest('hex');
export function adminEmailOtp({pool,mailer,env,isProd}){
 const cookie='nc_admin_challenge',options={httpOnly:true,secure:isProd,sameSite:'strict',path:'/api/admin',maxAge:600000};
 return async(req,res,user)=>{
  res.set('Cache-Control','no-store');const otp=String(req.body?.otp||'').trim();
  if(!otp||req.body?.resend===true){
   if(!mailer||!env.MAIL_FROM){res.status(503).json({error:'Configure SMTP and MAIL_FROM, then restart to send admin email codes.'});return false;}
   const token=crypto.randomBytes(32).toString('base64url'),code=String(crypto.randomInt(1000000)).padStart(6,'0'),hash=digest(token),c=await pool.connect();
   try{await c.query('begin');await c.query('select id from users where id=$1 for update',[user.id]);
    if((await c.query("select user_id from admin_email_challenges where user_id=$1 and sent_at>now()-interval '60 seconds'",[user.id])).rowCount){await c.query('rollback');res.set('Retry-After','60').status(429).json({error:'Wait 60 seconds before requesting another code.'});return false;}
    await c.query(`insert into admin_email_challenges(user_id,token_hash,code_hash,expires_at,sent_at,attempts,consumed,delivered) values($1,$2,$3,now()+interval '10 minutes',now(),0,false,false) on conflict(user_id) do update set token_hash=excluded.token_hash,code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0,consumed=false,delivered=false`,[user.id,hash,codeHash(token,code)]);await c.query('commit');
   }catch(e){await c.query('rollback');throw e;}finally{c.release();}
   try{const r=await mailer.sendMail({from:env.MAIL_FROM,to:user.email,subject:'Your NovaCart admin sign-in code',text:`Your NovaCart admin sign-in code is ${code}. Expires in 10 minutes. Use once. Do not share this code.`,html:`<p>NovaCart admin sign-in code:</p><h1>${code}</h1><p>Expires in 10 minutes. Use once. Do not share this code.</p>`});
    if(r?.rejected?.length||Array.isArray(r?.accepted)&&!r.accepted.length)throw Error();
    if(!(await pool.query('update admin_email_challenges set delivered=true where user_id=$1 and token_hash=$2 and consumed=false returning user_id',[user.id,hash])).rowCount)throw Error();
   }catch{await pool.query('update admin_email_challenges set consumed=true where user_id=$1 and token_hash=$2',[user.id,hash]);res.status(503).json({error:'Email delivery failed. Check SMTP settings and retry after 60 seconds.'});return false;}
   res.cookie(cookie,token,options);const [local,domain]=user.email.split('@');res.status(202).json({requiresOtp:true,method:'email',destination:local[0]+'***@'+domain,expiresIn:600,resendAfter:60});return false;
  }
  const token=String(req.cookies?.[cookie]||'');if(!/^[A-Za-z0-9_-]{43}$/.test(token)){res.status(401).json({error:'Request a new email code in this browser.'});return false;}
  const c=await pool.connect();let valid=false;
  try{await c.query('begin');const row=(await c.query('select *,expires_at>now() as fresh from admin_email_challenges where user_id=$1 and token_hash=$2 for update',[user.id,digest(token)])).rows[0];
   if(row?.fresh&&row.delivered&&!row.consumed&&row.attempts<5){valid=/^\d{6}$/.test(otp)&&crypto.timingSafeEqual(Buffer.from(row.code_hash),Buffer.from(codeHash(token,otp)));await c.query('update admin_email_challenges set attempts=attempts+1,consumed=$2 where user_id=$1',[user.id,valid||row.attempts+1>=5]);}await c.query('commit');
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
  if(!valid){res.status(401).json({error:'Invalid or expired email code. After five failed attempts, request a new code.'});return false;}
  res.clearCookie(cookie,{...options,maxAge:undefined});return true;
 };
}
