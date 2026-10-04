import crypto from 'node:crypto';
import {createServer} from 'node:http';
import bcrypt from 'bcryptjs';
import {database} from './database.js';
import {createApplication} from '../server.js';

export const json=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
export async function integrationFixture(env={},providerFetch=async()=>{throw new Error('Unexpected external call');},options={}) {
  const pool=await database(),server=createServer().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const app=createApplication({pool,stripe:null,mailer:options.mailer,mailFetch:options.mailFetch,env:{NODE_ENV:'development',PUBLIC_BASE_URL:base,...env},providerFetch});server.on('request',app.app);
  const password='LocalIntegration123!';const hash=await bcrypt.hash(password,4);
  async function account(email='buyer@local.test',admin=false) {
    const id=crypto.randomUUID(),token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(20).toString('hex');
    await pool.query('insert into users(id,name,email,password_hash,email_verified,is_admin) values($1,$2,$3,$4,true,$5)',[id,'Integration Buyer',email,hash,admin]);
    await pool.query(`insert into sessions(id,user_id,token_hash,csrf_token,expires_at,mfa_verified) values($1,$2,$3,$4,now()+interval '1 hour',$5)`,[crypto.randomUUID(),id,crypto.createHash('sha256').update(token).digest('hex'),csrf,admin]);
    return {id,email,cookie:'nc_session='+token,csrf};
  }
  async function api(path,{method='GET',body,account,cookie=account?.cookie,csrf=account?.csrf,headers={},form}={}) {
    const response=await fetch(base+path,{method,redirect:'manual',headers:{...(body?{'content-type':'application/json'}:{}),...(form?{'content-type':'application/x-www-form-urlencoded'}:{}),...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...headers},body:form?new URLSearchParams(form).toString():body?JSON.stringify(body):undefined});
    const data=await response.json().catch(()=>({}));
    return {status:response.status,data,cookie:response.headers.getSetCookie?.().find(c=>c.startsWith('nc_session='))?.split(';')[0],cookies:response.headers.getSetCookie?.()||[],location:response.headers.get('location'),headers:response.headers};
  }
  return {pool,base,account,api,password,application:app,async close(){await new Promise(r=>server.close(r));await pool.end();}};
}
