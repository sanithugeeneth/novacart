import fs from 'node:fs';
import dotenv from 'dotenv';
import {Pool} from 'pg';
import Stripe from 'stripe';
import {configurationReport,databaseReport} from '../services/readiness.js';
import {createMailer} from '../services/mailer.js';
const args=process.argv.slice(2),at=args.indexOf('--env');let env={...process.env};
try{
  const file=at>=0?args[at+1]:'.env';if(at>=0&&!file)throw new Error();
  if(file&&fs.existsSync(file))env=at>=0?{...env,...dotenv.parse(fs.readFileSync(file))}:{...dotenv.parse(fs.readFileSync(file)),...env};
  else if(at>=0)throw new Error();
}catch{console.error('The requested environment file could not be loaded.');process.exit(1);}
const report=configurationReport(env),configOnly=args.includes('--config-only');
if(!configOnly){
  const pool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});
  try{report.database=await databaseReport(pool);}catch{report.database={connected:false,schemaCurrent:false,error:'Database check failed. Check connectivity and run the migration.'};}finally{await pool.end();}
}
if(args.includes('--connections')){
  report.connections={};
  for(const id of ['stripe','email']){
    const group=report.checks.find(x=>x.id===id);
    if(group.state!=='configured'){report.connections[id]={status:'skipped',reason:'Configuration is incomplete or disabled.'};continue;}
    let transport;
    try{
      if(id==='stripe')await new Stripe(env.STRIPE_SECRET_KEY,{timeout:10000,maxNetworkRetries:0}).accounts.retrieve();
      else{transport=createMailer(env);await transport.verify();}
      report.connections[id]={status:'authenticated',functionalTestRequired:true};
    }catch{report.connections[id]={status:'failed',reason:'Provider authentication or connectivity failed. Check the private server configuration.'};}
    finally{transport?.close();}
  }
}
const passed=report.configurationPassed&&(configOnly||report.database?.schemaCurrent)&&!Object.values(report.connections||{}).some(x=>x.status==='failed');
if(args.includes('--json'))console.log(JSON.stringify(report,null,2));
else{
  console.log(`NovaCart 21.2 ${passed?'configuration checks passed':'setup needs attention'} (${report.environment}).`);
  for(const item of report.checks){console.log(`${item.label}: ${item.state}`);for(const issue of item.issues)console.log('  Required: '+issue);for(const warning of item.warnings)console.log('  Note: '+warning);}
  if(report.database)console.log('Database: '+(report.database.schemaCurrent?'connected, schema current':'connection or migration needs attention'));
  for(const [id,result] of Object.entries(report.connections||{}))console.log(`${id} connection: ${result.status}`);
  console.log('This checks configuration and requested connections. It does not certify live payments, inbox delivery, OAuth, image recognition or supplier fulfillment.');
}
process.exitCode=passed?0:1;
