import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import dotenv from 'dotenv';
import {configurationReport,databaseReport} from '../services/readiness.js';
import {productionValues,writeProductionFile} from '../scripts/configure-production.js';
import {mailConfig} from '../services/mail-config.js';
import {integrationFixture} from './integration-fixture.js';
import {database} from './database.js';
import {createApplication} from '../server.js';
const template=fs.readFileSync(new URL('../.env.example',import.meta.url),'utf8');
function values(){return {...productionValues({domain:'shop.local.test',adminEmail:'owner@local.test',supportEmail:'support@local.test',country:'LK',address:"10 O'Brien Road"},template),STRIPE_SECRET_KEY:'sk_test_privateTestFixture',STRIPE_WEBHOOK_SECRET:'whsec_privateTestFixture',SMTP_HOST:'smtp.local.test',SMTP_USER:'smtpFixtureUser',SMTP_PASS:'privateSMTPfixture123!'};}

test('production setup uses unique secrets, restrictive permissions, literal values and never overwrites credentials',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'novacart-config-'));
  try{const file=path.join(folder,'.env.production'),env=values(),other=values();assert.notEqual(env.POSTGRES_PASSWORD,other.POSTGRES_PASSWORD);assert.notEqual(env.ADMIN_MFA_SECRET,other.ADMIN_MFA_SECRET);env.SMTP_PASS='literal$SMTP#password';writeProductionFile(file,env);assert.deepEqual(dotenv.parse(fs.readFileSync(file)),env);assert.equal(fs.statSync(file).mode&0o777,0o600);const before=fs.readFileSync(file,'utf8');assert.throws(()=>writeProductionFile(file,other),e=>e.code==='EEXIST');assert.equal(fs.readFileSync(file,'utf8'),before);}
  finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('configured test mode never claims live verification and partial enabled integrations fail the check without leaking secrets',()=>{
  const env=values(),report=configurationReport(env);assert.equal(report.configurationPassed,true,JSON.stringify(report));assert.equal(report.liveVerified,false);assert.equal(report.checks.find(c=>c.id==='stripe').mode,'test');assert.equal(report.checks.find(c=>c.id==='google').state,'disabled');
  for(const key of ['ADMIN_PASSWORD','ADMIN_MFA_SECRET','METRICS_TOKEN','SMTP_PASS','STRIPE_SECRET_KEY','POSTGRES_PASSWORD'])assert.ok(!JSON.stringify(report).includes(env[key]));
  const partial=configurationReport({...env,ENABLE_OAUTH_GOOGLE:'true',OAUTH_GOOGLE_CLIENT_ID:'configured-id'});assert.equal(partial.configurationPassed,false);assert.ok(partial.checks.find(c=>c.id==='google').issues.some(x=>x.includes('CLIENT_SECRET')));
  const invalid=configurationReport({...env,ENABLE_OAUTH_APPLE:'true',OAUTH_APPLE_PRIVATE_KEY:'bad-key',ENABLE_AMAZON_FORWARDING:'true',SMTP_REQUIRE_TLS:'false',ADMIN_MFA_REQUIRED:'false'});assert.equal(invalid.configurationPassed,false);assert.ok(invalid.checks.find(c=>c.id==='apple').issues.some(x=>x.includes('P-256')));
  assert.ok(invalid.checks.find(c=>c.id==='amazon').issues.some(x=>x.includes('ENABLE_AMAZON_SYNC')));
});
test('configuration CLI works without database/provider access, returns failures and redacts private values',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'novacart-preflight-'));
  try{const file=path.join(folder,'.env.production'),env=values();writeProductionFile(file,env);
    const run=()=>spawnSync(process.execPath,['scripts/preflight.js','--env',file,'--config-only','--json'],{encoding:'utf8'});
    const passed=run();assert.equal(passed.status,0,passed.stderr);assert.equal(JSON.parse(passed.stdout).configurationPassed,true);assert.ok(!passed.stdout.includes(env.SMTP_PASS));
    fs.appendFileSync(file,"\nENABLE_VISUAL_SEARCH='true'\n");const failed=run();assert.equal(failed.status,1);assert.equal(JSON.parse(failed.stdout).configurationPassed,false);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('readiness is admin-only, never exposes secrets, and private deployment files are not publicly served',async()=>{
  const env={ADMIN_MFA_REQUIRED:'true',ADMIN_MFA_SECRET:'JBSWY3DPEHPK3PXP',SMTP_PASS:'readinessSecretFixture'},f=await integrationFixture(env);
  try{const admin=await f.account('admin@local.test',true),buyer=await f.account();assert.equal((await f.api('/api/admin/launch-readiness')).status,401);assert.equal((await f.api('/api/admin/launch-readiness',{account:buyer})).status,403);const report=await f.api('/api/admin/launch-readiness',{account:admin});assert.equal(report.status,200);assert.equal(report.data.database.schemaCurrent,true);assert.ok(!JSON.stringify(report.data).includes(env.SMTP_PASS));assert.match(report.headers.get('cache-control'),/no-store/);
    await f.pool.query('update sessions set mfa_verified=false where user_id=$1',[admin.id]);assert.equal((await f.api('/api/admin/launch-readiness',{account:admin})).status,403);
    for(const file of ['.env.production','compose.production.yml','deploy/Caddyfile','services/readiness.js','scripts/configure-production.js'])assert.equal((await fetch(f.base+'/'+file)).status,404,file);
  }finally{await f.close();}
});
test('production startup validates its injected configuration and does not create demo inventory',async()=>{
  const pool=await database(),env={...values(),PORT:'0'},application=createApplication({pool,env,stripe:null,mailer:{verify:async()=>true,sendMail:async()=>{},close:()=>{}}});
  try{await application.start();assert.equal((await pool.query('select count(*)::int n from products')).rows[0].n,0);assert.equal((await pool.query('select count(*)::int n from users where is_admin=true')).rows[0].n,1);assert.equal((await databaseReport(pool)).schemaCurrent,true);}
  finally{await application.close();}
});
test('SMTP transport enforces TLS and finite connection and delivery timeouts',()=>{
  const config=mailConfig({...values(),SMTP_PORT:'587'});assert.equal(config.requireTLS,true);assert.equal(config.secure,false);assert.equal(config.tls.minVersion,'TLSv1.2');assert.ok(config.socketTimeout<=20000);assert.equal(mailConfig({SMTP_PORT:'465'}).secure,true);
});
