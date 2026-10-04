import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import {fileURLToPath} from 'node:url';
export function productionValues({domain,adminEmail,supportEmail,country,address},template) {
  if(!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain||'')||domain==='example.com'||domain.endsWith('.example.com'))throw new Error('Supply your public domain as --domain, without https:// or a path.');
  for(const [name,value] of Object.entries({adminEmail,supportEmail}))if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value||'')||/@example\.com$/i.test(value))throw new Error(`Supply a real ${name} address.`);
  if(!country?.trim()||!address?.trim())throw new Error('Supply --country and --address for your business.');
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='',secret='';for(const byte of crypto.randomBytes(20))bits+=byte.toString(2).padStart(8,'0');for(let i=0;i<bits.length;i+=5)secret+=alphabet[parseInt(bits.slice(i,i+5),2)];
  const dbPassword=crypto.randomBytes(32).toString('hex');
  return {...dotenv.parse(template),NODE_ENV:'production',PORT:'3000',STORE_DOMAIN:domain,PUBLIC_BASE_URL:'https://'+domain,BUSINESS_COUNTRY:country,BUSINESS_ADDRESS:address,ADMIN_EMAIL:adminEmail,SUPPORT_EMAIL:supportEmail,PRIVACY_EMAIL:supportEmail,ADMIN_PASSWORD:'Nc1!'+crypto.randomBytes(24).toString('base64url'),ADMIN_MFA_REQUIRED:'true',ADMIN_MFA_SECRET:secret,METRICS_TOKEN:crypto.randomBytes(32).toString('hex'),POSTGRES_PASSWORD:dbPassword,DATABASE_URL:`postgresql://novacart:${dbPassword}@db:5432/novacart`,MAIL_FROM:`NovaCart <${supportEmail}>`,TRUST_PROXY:'1',ENFORCE_ORIGIN_CHECK:'true',REQUIRE_EMAIL_VERIFICATION:'true',SEED_DEMO_PRODUCTS:'false',SMTP_REQUIRE_TLS:'true'};
}
export function writeProductionFile(file,values) {
  const lines=Object.entries(values).map(([key,value])=>{
    if(/[\r\n]/.test(value))throw new Error(`${key} must be one line; encode private-key newlines as \\n.`);
    // Literal single quotes prevent Compose from expanding dollar signs in secrets.
    // An unquoted apostrophe in an ordinary street address is also supported.
    let encoded=`'${value}'`;
    if(String(value).includes("'")){
      if(/[#$\\]/.test(value))throw new Error(`${key} contains characters requiring manual environment-file quoting.`);
      encoded=String(value);
    }
    if(dotenv.parse(`${key}=${encoded}`)[key]!==String(value))throw new Error(`${key} requires manual environment-file quoting.`);
    return `${key}=${encoded}`;
  });
  fs.writeFileSync(file,'# Private server configuration. Never share or commit this file.\n'+lines.join('\n')+'\n',{flag:'wx',mode:0o600});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args={};for(let i=2;i<process.argv.length;i+=2){if(!['--domain','--admin-email','--support-email','--country','--address','--output'].includes(process.argv[i])||!process.argv[i+1])throw new Error('Usage: npm run setup:production -- --domain shop.your-domain.tld --admin-email you@your-domain.tld --support-email support@your-domain.tld --country LK --address "Your business address"');args[process.argv[i]]=process.argv[i+1];}
    const values=productionValues({domain:args['--domain'],adminEmail:args['--admin-email'],supportEmail:args['--support-email'],country:args['--country'],address:args['--address']},fs.readFileSync(new URL('../.env.example',import.meta.url),'utf8'));
    const file=path.resolve(args['--output']||'.env.production');writeProductionFile(file,values);
    console.log('Created private configuration: '+file+'\nExisting files are never overwritten. Read this file locally for your generated admin password and authenticator setup key. Add Stripe and email provider credentials, then run npm run launch:config.');
  }catch(error){console.error(error.code==='EEXIST'?'Configuration already exists; it was not changed. Edit the existing file to preserve your database and admin credentials.':error.message);process.exitCode=1;}
}
