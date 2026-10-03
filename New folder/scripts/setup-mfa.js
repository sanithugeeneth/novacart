import fs from 'node:fs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
const file='.env';
if(!fs.existsSync(file)){console.error('First copy .env.example to .env and enter your private admin email/password and database settings.');process.exit(1);}
let text=fs.readFileSync(file,'utf8');const env=dotenv.parse(text);
if(!env.ADMIN_EMAIL||/example\.com/i.test(env.ADMIN_EMAIL)){console.error('Set your own ADMIN_EMAIL in .env first.');process.exit(1);}
function set(key,value){const pattern=new RegExp('^'+key+'=.*$','m');text=pattern.test(text)?text.replace(pattern,key+'='+value):text+'\n'+key+'='+value+'\n';}
let secret=String(env.ADMIN_MFA_SECRET||'').trim();const fresh=!secret;
if(fresh){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const b of crypto.randomBytes(20))bits+=b.toString(2).padStart(8,'0');secret='';for(let i=0;i<bits.length;i+=5)secret+=alphabet[parseInt(bits.slice(i,i+5),2)];set('ADMIN_MFA_SECRET',secret);}
set('ADMIN_MFA_REQUIRED','true');set('ADMIN_MFA_METHOD','totp');fs.writeFileSync(file,text,{mode:0o600});
console.log('Admin MFA is enabled. Restart NovaCart after running the database migration.');
if(fresh){console.log('Add this setup key to your authenticator app (time-based, 6 digits, 30 seconds):');console.log(secret);console.log('Account: NovaCart / '+env.ADMIN_EMAIL);console.log('Keep the setup key private; do not include .env in shared ZIP files.');}
else console.log('The existing MFA secret was preserved. Use the account already enrolled in your authenticator.');
