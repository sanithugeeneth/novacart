import crypto from 'node:crypto';
const enabled=v=>String(v||'').toLowerCase()==='true';
const placeholder=v=>/CHANGE[-_ ]|YOUR[-_ ]|example\.com/i.test(String(v||''));
const email=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||''));
export function configurationReport(env) {
  const prod=String(env.NODE_ENV||'').toLowerCase()==='production',checks=[];
  function group(id,label,active,keys,required=false) {
    const issues=active?keys.filter(k=>!String(env[k]||'').trim()||placeholder(env[k])).map(k=>`${k} is missing or contains a placeholder.`):[];
    const item={id,label,enabled:active,required,issues,warnings:[]};checks.push(item);return item;
  }
  const core=group('store','Store and security',true,['DATABASE_URL','PUBLIC_BASE_URL','BUSINESS_NAME','BUSINESS_COUNTRY','BUSINESS_ADDRESS','SUPPORT_EMAIL','ADMIN_EMAIL','ADMIN_PASSWORD','CURRENCY'],true);
  let base;
  try{base=new URL(env.PUBLIC_BASE_URL);if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new Error();}catch{core.issues.push('PUBLIC_BASE_URL must be an HTTP(S) origin, without a path or credentials.');}
  if(prod&&base?.protocol!=='https:')core.issues.push('PUBLIC_BASE_URL must use HTTPS in production.');
  if(env.STORE_DOMAIN&&base?.host!==env.STORE_DOMAIN)core.issues.push('STORE_DOMAIN must match PUBLIC_BASE_URL.');
  for(const k of ['ADMIN_EMAIL','SUPPORT_EMAIL'])if(!email(env[k]))core.issues.push(`${k} must be a valid email address.`);
  if(!/^[A-Z]{3}$/.test(String(env.CURRENCY||'')))core.issues.push('CURRENCY must be three uppercase letters.');
  try{const db=new URL(env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(db.protocol)||!db.hostname||!db.pathname.slice(1))throw new Error();if(prod&&(!db.password||['novacart','postgres','password'].includes(decodeURIComponent(db.password))))core.issues.push('DATABASE_URL needs a non-default database password.');}catch{core.issues.push('DATABASE_URL must be a PostgreSQL connection URL.');}
  if(prod){
    const password=String(env.ADMIN_PASSWORD||'');
    if(password.length<Math.max(12,Number(env.ADMIN_PASSWORD_MIN)||12)||!/[A-Za-z]/.test(password)||!/\d/.test(password)||!/[^A-Za-z0-9]/.test(password))core.issues.push('ADMIN_PASSWORD must include at least 12 characters, a letter, number and symbol.');
    if(String(env.METRICS_TOKEN||'').length<32||placeholder(env.METRICS_TOKEN))core.issues.push('METRICS_TOKEN must be a private random token of at least 32 characters.');
    if(env.ADMIN_MFA_REQUIRED==='false')core.issues.push('ADMIN_MFA_REQUIRED must remain enabled for production.');
    if((env.ADMIN_MFA_METHOD||'totp')==='totp'&&!/^[A-Z2-7]{16,}$/.test(String(env.ADMIN_MFA_SECRET||'')))core.issues.push('ADMIN_MFA_SECRET must be a valid Base32 authenticator secret.');
    if(env.ENFORCE_ORIGIN_CHECK==='false')core.issues.push('ENFORCE_ORIGIN_CHECK must remain enabled for production.');
    if(enabled(env.SEED_DEMO_PRODUCTS))core.warnings.push('Demo product seeding is enabled. Disable it before opening the store.');
  }
  for(const k of ['TAX_RATES_JSON','SHIPPING_ZONES_JSON'])if(env[k]){try{const value=JSON.parse(env[k]);if(!value||Array.isArray(value)||typeof value!=='object')throw new Error();}catch{core.issues.push(`${k} must be a JSON object.`);}}
  const payments=group('stripe','Stripe payments',prod||Boolean(env.STRIPE_SECRET_KEY||env.STRIPE_WEBHOOK_SECRET),['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],prod);
  if(payments.enabled){
    if(env.STRIPE_SECRET_KEY&&!/^sk_(test|live)_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY))payments.issues.push('STRIPE_SECRET_KEY must be a Stripe secret API key.');
    if(env.STRIPE_WEBHOOK_SECRET&&!/^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET))payments.issues.push('STRIPE_WEBHOOK_SECRET must be the signing secret for this endpoint.');
    payments.mode=String(env.STRIPE_SECRET_KEY||'').startsWith('sk_live_')?'live':'test';
    if(payments.mode==='test')payments.warnings.push('Test mode: no real customer payments.');
    payments.warnings.push('Verify checkout, signed webhooks and refunds on the deployed store.');
  }
  const emailOtp=env.ADMIN_MFA_METHOD==='email';
  if(!['totp','email'].includes(env.ADMIN_MFA_METHOD||'totp'))core.issues.push('ADMIN_MFA_METHOD must be totp or email.');
  if(emailOtp&&env.ADMIN_MFA_REQUIRED!=='true')core.issues.push('Email OTP requires ADMIN_MFA_REQUIRED=true.');
  const smtp=group('email','Transactional email',prod||emailOtp||Boolean(env.SMTP_HOST||env.SMTP_USER||env.SMTP_PASS),['SMTP_HOST','SMTP_USER','SMTP_PASS','MAIL_FROM'],prod);
  if(smtp.enabled){
    const port=Number(env.SMTP_PORT||587);if(!Number.isInteger(port)||port<1||port>65535)smtp.issues.push('SMTP_PORT must be a valid port.');
    const from=String(env.MAIL_FROM||'').match(/<([^<>]+)>/)?.[1]||env.MAIL_FROM;if(!email(from))smtp.issues.push('MAIL_FROM must contain a valid sender email.');
    if(prod&&env.SMTP_REQUIRE_TLS==='false')smtp.issues.push('SMTP_REQUIRE_TLS must remain enabled in production.');
    smtp.warnings.push('SMTP authentication alone does not verify inbox delivery or domain authentication.');
  }
  const google=group('google','Google sign-in',enabled(env.ENABLE_OAUTH_GOOGLE),['OAUTH_GOOGLE_CLIENT_ID','OAUTH_GOOGLE_CLIENT_SECRET']);
  const apple=group('apple','Apple sign-in',enabled(env.ENABLE_OAUTH_APPLE),['OAUTH_APPLE_CLIENT_ID','OAUTH_APPLE_TEAM_ID','OAUTH_APPLE_KEY_ID','OAUTH_APPLE_PRIVATE_KEY']);
  if(apple.enabled){
    try{const key=crypto.createPrivateKey(String(env.OAUTH_APPLE_PRIVATE_KEY||'').replace(/\\n/g,'\n'));if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw new Error();}catch{apple.issues.push('OAUTH_APPLE_PRIVATE_KEY must be a valid P-256 private key.');}
    if(base?.protocol!=='https:'||/^(localhost|127\.|\[::1\])/.test(base?.hostname||''))apple.issues.push('Apple sign-in needs a public HTTPS callback domain.');
  }
  const vision=group('vision','Visual search',enabled(env.ENABLE_VISUAL_SEARCH),['GOOGLE_VISION_API_KEY']);
  if(vision.enabled&&(!Number.isInteger(Number(env.VISUAL_SEARCH_DAILY_LIMIT||200))||Number(env.VISUAL_SEARCH_DAILY_LIMIT||200)<1||Number(env.VISUAL_SEARCH_DAILY_LIMIT||200)>10000))vision.issues.push('VISUAL_SEARCH_DAILY_LIMIT must be an integer from 1 to 10000.');
  const amazon=group('amazon','Amazon MCF',enabled(env.ENABLE_AMAZON_SYNC)||enabled(env.ENABLE_AMAZON_FORWARDING),['AMAZON_MARKETPLACE_ID','AMAZON_LWA_CLIENT_ID','AMAZON_LWA_CLIENT_SECRET','AMAZON_REFRESH_TOKEN']);
  if(amazon.enabled&&!['na','eu','fe'].includes(env.AMAZON_SP_API_REGION||'na'))amazon.issues.push('AMAZON_SP_API_REGION must be na, eu or fe.');
  const ali=group('aliexpress','AliExpress',enabled(env.ENABLE_ALIEXPRESS_SYNC)||enabled(env.ENABLE_ALIEXPRESS_FORWARDING),['ALIEXPRESS_APP_KEY','ALIEXPRESS_APP_SECRET','ALIEXPRESS_ACCESS_TOKEN']);
  if(ali.enabled&&!['iop','top'].includes(env.ALIEXPRESS_PROTOCOL||'iop'))ali.issues.push('ALIEXPRESS_PROTOCOL must be iop or top.');
  for(const [item,prefix] of [[amazon,'AMAZON'],[ali,'ALIEXPRESS']]){
    if(enabled(env[`ENABLE_${prefix}_FORWARDING`])&&!enabled(env[`ENABLE_${prefix}_SYNC`]))item.issues.push(`ENABLE_${prefix}_SYNC must be enabled before forwarding.`);
    if(item.enabled)item.warnings.push('Provider approval, exact SKU mapping and a real accepted fulfillment request remain to be verified.');
  }
  for(const item of [google,apple,vision])if(item.enabled)item.warnings.push('Provider acceptance still requires a live functional check.');
  for(const item of checks)item.state=!item.enabled?'disabled':item.issues.length?'incomplete':'configured';
  return {version:'21.2.0',environment:prod?'production':'development',configurationPassed:checks.every(x=>!x.issues.length),liveVerified:false,checks};
}
export async function databaseReport(pool) {
  const tables=['users','sessions','products','orders','order_items','refunds','stripe_events','email_outbox','sellers','seller_orders','seller_payouts','seller_payout_items','seller_payout_refund_adjustments','seller_payout_refund_offsets','admin_email_challenges','oauth_states','oauth_accounts','integration_usage','visual_searches','supplier_products','supplier_orders'];
  const rows=(await pool.query("select tablename from pg_tables where schemaname='public' and tablename=any($1::text[])",[tables])).rows;
  const missing=tables.filter(t=>!rows.some(r=>r.tablename===t));
  const columns=(await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='refunds' and column_name in ('request_key','request_hash','request_payload','submission_state','submitted_at')")).rows;
  const ops=(await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name='supplier_orders' and column_name in ('fulfillment_status','supplier_payment_status','cancel_status','packages','last_sync_at','next_sync_at','sync_until')")).rows;
  return {connected:true,supplierOperationsMigrationApplied:ops.length===7,schemaCurrent:!missing.length&&columns.length===5&&ops.length===7,missingTables:missing,refundMigrationApplied:columns.length===5};
}
