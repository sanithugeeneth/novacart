import fs from 'node:fs';import dotenv from 'dotenv';import {createMailer,mailProvider,mailRequiredKeys} from '../services/mailer.js';
if(!fs.existsSync('.env')){console.error('Create .env from .env.example first.');process.exit(1);}
let text=fs.readFileSync('.env','utf8');const env=dotenv.parse(text),missing=['ADMIN_EMAIL','ADMIN_PASSWORD',...mailRequiredKeys(env)].filter(k=>!env[k]||/CHANGE[-_ ]|YOUR[-_ ]|example\.com/i.test(env[k]));
if(missing.length){console.error('Configure private values in .env: '+missing.join(', '));process.exit(1);}
if(!['smtp','brevo'].includes(mailProvider(env))){console.error('MAIL_PROVIDER must be smtp or brevo.');process.exit(1);}
const mailer=createMailer(env);try{await mailer.verify();}catch{console.error('Email provider connection/authentication failed. Email OTP was not enabled.');process.exitCode=1;}finally{mailer.close();}if(process.exitCode)process.exit(process.exitCode);
for(const [k,v] of Object.entries({ADMIN_MFA_REQUIRED:'true',ADMIN_MFA_METHOD:'email'})){const re=new RegExp('^'+k+'=.*$','m');text=re.test(text)?text.replace(re,k+'='+v):text+'\n'+k+'='+v+'\n';}fs.writeFileSync('.env',text,{mode:0o600});console.log('Email OTP enabled. Run db:migrate and restart. Inbox delivery is checked when requesting your first code.');
