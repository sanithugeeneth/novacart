import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('.');
const required=['server.js','app.js','auth.js','product.js','admin.js','schema.sql','docker-compose.yml','.env.example','render.yaml'];
for(const f of required){try{await fs.access(path.join(root,f));}catch{throw new Error(`Missing ${f}`)}}
const server=await fs.readFile(path.join(root,'server.js'),'utf8');
const app=await fs.readFile(path.join(root,'app.js'),'utf8');
const schema=await fs.readFile(path.join(root,'schema.sql'),'utf8');
for(const needle of [
  'contentSecurityPolicy:',
  'pg_advisory_xact_lock',
  'payment_intent_data:{metadata:{order_id:id}}',
  'Metrics authorization required.',
  "status === 'pending_payment'",
  "stripe_events(id,type) values($1,$2) on conflict(id) do nothing",
  'payment_status=\'partially_refunded\'',
  'SYNC_ADMIN_FROM_ENV',
  'locked_at',
  'safeFilename'
]) if(!server.includes(needle)) throw new Error(`Hardening marker missing: ${needle}`);
for(const needle of ["csrf:'", "textContent='Hi, '", "esc(p.image)"]) if(!app.includes(needle)) throw new Error(`Frontend hardening marker missing: ${needle}`);
for(const needle of ['locked_at timestamptz','lock_token text','email_outbox_lock_idx']) if(!schema.includes(needle)) throw new Error(`Schema hardening marker missing: ${needle}`);
console.log('NovaCart V13 static hardening checks passed.');
