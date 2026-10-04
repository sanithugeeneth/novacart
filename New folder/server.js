import {adminEmailOtp} from './services/admin-email-otp.js';
import {publicProduct,productPath,renderProductPage} from './services/product-pages.js';
import {registerSellerProducts} from './services/seller-products.js';
import 'dotenv/config';
import { registerRefunds, recordProviderRefund } from './services/refunds.js';
import { registerPayouts } from './services/payouts.js';
import {refundBalance} from './services/payout-refunds.js';
import {customerShipments} from './services/customer-shipments.js';
import { registerOAuth } from './services/oauth.js';
import { registerVisualSearch } from './services/visual-search.js';
import { registerSuppliers, supplierCheckout } from './services/suppliers.js';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import Stripe from 'stripe';
import {createMailer} from './services/mailer.js';
import {configurationReport,databaseReport} from './services/readiness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export function createApplication(deps = {}) {
const env = deps.env || process.env;
const PORT = Number(env.PORT || 3000);
const BASE = (env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const isProd = String(env.NODE_ENV || 'development').toLowerCase() === 'production';
const SESSION_DAYS = Math.max(1, Number(env.SESSION_DAYS || 30));
const TAX_RATE = Math.max(0, Number(env.TAX_RATE || 0));
const STANDARD_SHIPPING_RATE = Math.max(0, Number(env.STANDARD_SHIPPING_RATE || 5.99));
const FREE_SHIPPING_THRESHOLD = Math.max(0, Number(env.FREE_SHIPPING_THRESHOLD || 75));
const EXPRESS_SHIPPING_RATE = Math.max(0, Number(env.EXPRESS_SHIPPING_RATE || 12.99));
const RETURNS_DAYS = Math.max(0, Number(env.RETURNS_DAYS || 30));
const SUPPORT_EMAIL = String(env.SUPPORT_EMAIL || 'support@example.com');
const BUSINESS_NAME = String(env.BUSINESS_NAME || 'NovaCart');
const BUSINESS_COUNTRY = String(env.BUSINESS_COUNTRY || '');
const BUSINESS_ADDRESS = String(env.BUSINESS_ADDRESS || '');
const SUPPORT_HOURS = String(env.SUPPORT_HOURS || '');
const METRICS_TOKEN = String(env.METRICS_TOKEN || '');
const REMEMBER_DAYS = Math.max(1, Number(env.REMEMBER_DAYS || 1));
const PRIVACY_EMAIL = String(env.PRIVACY_EMAIL || env.SUPPORT_EMAIL || '');
const DEFAULT_LANGUAGE = String(env.DEFAULT_LANGUAGE || 'en');
const PLATFORM_COMMISSION_BPS = Math.max(0, Math.min(5000, Number(env.PLATFORM_COMMISSION_BPS || 1000)));
const LOYALTY_POINTS_PER_CURRENCY = Math.max(0, Number(env.LOYALTY_POINTS_PER_CURRENCY || 1));
const FRAUD_REVIEW_SCORE = Math.max(0, Math.min(100, Number(env.FRAUD_REVIEW_SCORE || 70)));
const CURRENCY = String(env.CURRENCY || 'USD').trim().toLowerCase();
const REQUIRE_EMAIL_VERIFICATION = String(env.REQUIRE_EMAIL_VERIFICATION || 'false').toLowerCase() === 'true';
const ENFORCE_ORIGIN = String(env.ENFORCE_ORIGIN_CHECK || (isProd ? 'true' : 'false')).toLowerCase() === 'true';
const PASSWORD_MIN = Math.max(8, Number(env.PASSWORD_MIN || (isProd ? 12 : 8)));
const ADMIN_PASSWORD_MIN = Math.max(12, Number(env.ADMIN_PASSWORD_MIN || 12));
const ADMIN_MFA_REQUIRED = String(env.ADMIN_MFA_REQUIRED || (isProd ? 'true' : 'false')).toLowerCase() === 'true';
const ADMIN_MFA_METHOD=String(env.ADMIN_MFA_METHOD||'totp').toLowerCase();
if(!['totp','email'].includes(ADMIN_MFA_METHOD))throw new Error('ADMIN_MFA_METHOD must be totp or email.');
if(ADMIN_MFA_METHOD==='email'&&!ADMIN_MFA_REQUIRED)throw new Error('Email OTP requires ADMIN_MFA_REQUIRED=true.');
const ADMIN_MFA_SECRET = String(env.ADMIN_MFA_SECRET || '');
const SESSION_IDLE_MINUTES = Math.max(5, Number(env.SESSION_IDLE_MINUTES || 1440));
const ORDER_RETURN_WINDOW_DAYS = Math.max(0, Number(env.ORDER_RETURN_WINDOW_DAYS || RETURNS_DAYS));
let TAX_RATES = {}; try { TAX_RATES = JSON.parse(env.TAX_RATES_JSON || '{}'); } catch { TAX_RATES = {}; }
let SHIPPING_ZONES = {}; try { SHIPPING_ZONES = JSON.parse(env.SHIPPING_ZONES_JSON || '{}'); } catch { SHIPPING_ZONES = {}; }

if (isProd) {
  for (const key of ['DATABASE_URL', 'PUBLIC_BASE_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'BUSINESS_COUNTRY', 'BUSINESS_ADDRESS', 'SUPPORT_EMAIL']) {
    if (!env[key]) throw new Error(`${key} must be configured in production`);
  }
  if (!BASE.startsWith('https://')) throw new Error('PUBLIC_BASE_URL must use https:// in production');
  if (!passwordStrong(env.ADMIN_PASSWORD, ADMIN_PASSWORD_MIN)) throw new Error(`ADMIN_PASSWORD must be at least ${ADMIN_PASSWORD_MIN} characters and include a letter, number and symbol`);
  if (ADMIN_MFA_REQUIRED && ADMIN_MFA_METHOD==='totp' && !ADMIN_MFA_SECRET) throw new Error('ADMIN_MFA_SECRET is required when ADMIN_MFA_REQUIRED=true');
  if (!METRICS_TOKEN) throw new Error('METRICS_TOKEN is required in production');
  if (!/^[A-Z]{3}$/.test(CURRENCY.toUpperCase())) throw new Error('CURRENCY must be a 3-letter ISO code.');
  if (String(env.SUPPORT_EMAIL || '').includes('example.com') || String(env.MAIL_FROM || '').includes('example.com')) throw new Error('Production support/mail addresses must not use example.com.');
}

const pool = deps.pool || new Pool({
  connectionString: env.DATABASE_URL || 'postgres://novacart:novacart@localhost:5432/novacart',
  max: Number(env.DB_POOL_MAX || 15),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
  statement_timeout: 15_000,
});
const stripe = deps.stripe !== undefined ? deps.stripe : (env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY,{timeout:15000,maxNetworkRetries:1}) : null);

const mailer = deps.mailer || createMailer(env, {fetchImpl: deps.mailFetch});

const app = express();
// Webhook JSON must remain raw until its Stripe signature has been verified.
app.disable('x-powered-by');
app.set('trust proxy', Math.max(0, Number(env.TRUST_PROXY || (isProd ? 1 : 0))));
app.use((req, res, next) => { req.requestId = crypto.randomUUID(); res.setHeader('x-request-id', req.requestId); next(); });
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:', 'https:'],
      upgradeInsecureRequests: isProd ? [] : null
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(cookieParser());

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many authentication attempts. Please try again later.' } });
const checkoutLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many checkout attempts. Please try again later.' } });
app.use('/api', apiLimiter);
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use((req, res, next) => {
  if (req.path === '/api/stripe/webhook') return next();
  return express.json({ limit: req.path === '/api/visual-search' ? '4200kb' : '200kb' })(req, res, next);
});

function fail(res, status, message, extra = {}) { return res.status(status).json({ error: message, ...extra }); }
function ok(res, body = {}) { return res.status(200).json(body); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function newToken() { return crypto.randomBytes(32).toString('base64url'); }
function newId() { return crypto.randomUUID(); }
function orderId() { return `NC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function emailOk(v) { return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); }
function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }
function money(n) { return Math.round(Number(n) * 100) / 100; }
function safeText(v, max = 500) { return String(v ?? '').trim().slice(0, max); }
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]||c));}
function toPositiveInt(v, fallback = 0, max = 1000000) { const n = Number(v); return Number.isInteger(n) ? Math.max(0, Math.min(max, n)) : fallback; }
function cookieOptions() { return { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400000 }; }
function isValidIdempotencyKey(v) { return typeof v === 'string' && /^[A-Za-z0-9._:-]{8,120}$/.test(v); }
function passwordStrong(v,min){const p=String(v||'');return p.length>=min && /[A-Za-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);}
function normalizeCountry(v){return safeText(v,80).trim().toUpperCase();}
function phoneOk(v){const p=safeText(v,40);return !p || /^\+?[0-9 ()\-]{7,25}$/.test(p);}
function postalOk(v,country){const p=safeText(v,20); if(!p) return false; if(country==='LK') return /^\d{5}$/.test(p); return /^[A-Za-z0-9 -]{3,12}$/.test(p);}
function urlOk(v){try{const u=new URL(String(v));return ['http:','https:'].includes(u.protocol);}catch{return false;}}
function userAgentHash(req) { return crypto.createHash('sha256').update(String(req.get('user-agent') || '')).digest('hex').slice(0, 24); }
function base32Decode(secret){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';const s=String(secret||'').toUpperCase().replace(/=|\s+/g,'');let bits='';for(const ch of s){const i=alphabet.indexOf(ch);if(i<0)throw new Error('Invalid TOTP secret');bits+=i.toString(2).padStart(5,'0')}const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));return Buffer.from(bytes);}
function totp(secret,window=0){const key=base32Decode(secret);const counter=Math.floor(Date.now()/30000)+window;const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(counter));const h=crypto.createHmac('sha1',key).update(b).digest();const off=h[h.length-1]&15;const n=((h[off]&127)<<24)|(h[off+1]<<16)|(h[off+2]<<8)|h[off+3];return String(n%1000000).padStart(6,'0');}
function verifyTotp(secret,code){if(!secret)return false;const c=String(code||'');if(!/^\d{6}$/.test(c))return false;return [-1,0,1].some(w=>crypto.timingSafeEqual(Buffer.from(totp(secret,w)),Buffer.from(c)));}

function originAllowed(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
  if (req.path === '/api/stripe/webhook' || req.path === '/api/oauth/apple/callback') return true;
  const origin = req.get('origin');
  const referer = req.get('referer');
  if (origin) return origin === BASE;
  if (referer) return referer.startsWith(`${BASE}/`) || referer === BASE;
  return !ENFORCE_ORIGIN;
}
app.use((req, res, next) => originAllowed(req) ? next() : fail(res, 403, 'Request origin not allowed.'));

async function getSession(req) {
  const raw = req.cookies.nc_session;
  if (!raw) return null;
  const tokenHash = hashToken(raw);
  const { rows } = await pool.query(`
    select s.id as session_id,s.user_id,s.csrf_token,s.expires_at,s.last_seen_at,s.mfa_verified,
           u.id as uid,u.name,u.email,u.phone,u.is_admin,u.email_verified,u.marketing_opt_in
      from sessions s join users u on u.id=s.user_id
     where s.token_hash=$1 and s.revoked_at is null and s.expires_at>now()
  `, [tokenHash]);
  if (!rows[0]) return null;
  if (Date.now() - new Date(rows[0].last_seen_at).getTime() > SESSION_IDLE_MINUTES * 60_000) { await pool.query('update sessions set revoked_at=now() where id=$1',[rows[0].session_id]); return null; }
  if (!rows[0].last_seen_at || Date.now() - new Date(rows[0].last_seen_at).getTime() > 5 * 60_000) {
    await pool.query('update sessions set last_seen_at=now() where id=$1', [rows[0].session_id]).catch(() => {});
  }
  return rows[0];
}

async function createSession(req, res, userId, remember = true, mfaVerified = false) {
  const token = newToken();
  const csrf = newToken();
  const days = remember ? SESSION_DAYS : Math.min(SESSION_DAYS, REMEMBER_DAYS);
  const expires = new Date(Date.now() + days * 86400000);
  await pool.query(`insert into sessions(id,user_id,token_hash,csrf_token,expires_at,user_agent_hash,mfa_verified) values($1,$2,$3,$4,$5,$6,$7)`, [newId(), userId, hashToken(token), csrf, expires, userAgentHash(req), mfaVerified]);
  res.cookie('nc_session', token, { ...cookieOptions(), maxAge: days * 86400000 });
  return csrf;
}

async function destroySession(req, res) {
  const raw = req.cookies.nc_session;
  if (raw) await pool.query('update sessions set revoked_at=now() where token_hash=$1', [hashToken(raw)]).catch(() => {});
  res.clearCookie('nc_session', { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' });
}

async function auth(req, res, next) {
  try {
    const session = await getSession(req);
    if (!session) return fail(res, 401, 'Please sign in to continue.');
    req.session = session;
    return next();
  } catch (e) { return fail(res, 503, 'Authentication service unavailable.'); }
}

async function adminOnly(req, res, next) {
  return auth(req, res, () => {
    if (!req.session.is_admin) return fail(res,403,'Admin access required.');
    if (ADMIN_MFA_REQUIRED && !req.session.mfa_verified) return fail(res,403,'Please sign in through Admin verification.');
    return next();
  });
}

function csrfOk(req) {
  if (!req.session) return true;
  const supplied = req.get('x-csrf-token');
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied); const b = Buffer.from(String(req.session.csrf_token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function audit(actorUserId, action, entityType, entityId, details = {}) {
  await pool.query(`insert into audit_logs(actor_user_id,action,entity_type,entity_id,details) values($1,$2,$3,$4,$5)`, [actorUserId || null, action, entityType || '', entityId || '', details]).catch(e => console.error('Audit log failed:', e.message));
}

async function queueMail(to, subject, html, text) {
  if (!to || !mailer) return false;
  await pool.query(`insert into email_outbox(to_email,subject,html,text_body) values($1,$2,$3,$4)`, [to, subject, html, text]);
  return true;
}

async function processEmailOutbox() {
  if (!mailer) return;
  const lockToken = crypto.randomUUID();
  let rows=[];
  const client = await pool.connect();
  try {
    await client.query('begin');
    const picked = await client.query(`
      with picked as (
        select id from email_outbox
         where sent_at is null
           and next_attempt_at <= now()
           and (locked_at is null or locked_at < now() - interval '10 minutes')
         order by id
         for update skip locked
         limit 10
      )
      update email_outbox e
         set locked_at=now(), lock_token=$1
        from picked
       where e.id=picked.id
      returning e.id,e.to_email,e.subject,e.html,e.text_body,e.attempts
    `,[lockToken]);
    rows=picked.rows;
    await client.query('commit');
  } catch(e) {
    await client.query('rollback').catch(()=>{});
    console.error('Email worker failed while claiming messages:', e.message);
    return;
  } finally { client.release(); }

  for (const row of rows) {
    try {
      await mailer.sendMail({ from: env.MAIL_FROM || 'NovaCart <no-reply@example.com>', to: row.to_email, subject: row.subject, html: row.html, text: row.text_body });
      await pool.query('update email_outbox set sent_at=now(),locked_at=null,lock_token=null,last_error=\'\' where id=$1 and lock_token=$2', [row.id, lockToken]);
    } catch (e) {
      const attempts = row.attempts + 1;
      const delaySeconds = Math.min(3600, 30 * (2 ** Math.min(attempts, 7)));
      await pool.query('update email_outbox set attempts=$1,next_attempt_at=now()+make_interval(secs=>$2),last_error=$3,locked_at=null,lock_token=null where id=$4 and lock_token=$5', [attempts, delaySeconds, safeText(e.message, 500), row.id, lockToken]).catch(err=>console.error('Email retry update failed:',err.message));
    }
  }
}

async function ensureAdmin() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return;
  const email = normalizeEmail(env.ADMIN_EMAIL);
  const existing = await pool.query('select id,is_admin from users where email=$1', [email]);
  if (!existing.rowCount) {
    const hash = await bcrypt.hash(String(env.ADMIN_PASSWORD), 12);
    await pool.query('insert into users(id,name,email,password_hash,email_verified,is_admin) values($1,$2,$3,$4,true,true)', [newId(), 'NovaCart Admin', email, hash]);
    return;
  }
  if (String(env.SYNC_ADMIN_FROM_ENV || 'false').toLowerCase() === 'true') {
    const hash = await bcrypt.hash(String(env.ADMIN_PASSWORD), 12);
    await pool.query('update users set password_hash=$1,is_admin=true,email_verified=true,updated_at=now() where email=$2', [hash, email]);
  } else if (!existing.rows[0].is_admin) {
    await pool.query('update users set is_admin=true,email_verified=true,updated_at=now() where email=$1', [email]);
  }
}

function seedProducts() {
  return [
    ['p1','aerosound-pro-wireless-headphones-p1','TECH-AERO-001','Tech','AeroSound Pro Wireless Headphones',89.99,119.99,4.9,1248,'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1200&q=90','BESTSELLER',26,'Immersive everyday headphones with adaptive sound, soft memory-foam cushions and up to 40 hours of battery life.'],
    ['p2','nova-rgb-mechanical-keyboard-p2','TECH-KEY-002','Tech','Nova RGB Mechanical Keyboard',44.99,69.99,4.8,842,'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=1200&q=90','HOT DEAL',18,'Fast tactile switches, vivid RGB lighting and a compact aluminum frame for a cleaner desk setup.'],
    ['p3','halo-smart-desk-lamp-p3','HOME-LAMP-003','Home','Halo Smart Desk Lamp',31.99,49.99,4.7,617,'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1200&q=90','TRENDING',41,'Minimal smart lighting with adjustable warmth, brightness scenes and a focused reading mode.'],
    ['p4','metro-carry-crossbody-bag-p4','LIFE-BAG-004','Lifestyle','Metro Carry Crossbody Bag',38.50,55,4.8,503,'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?auto=format&fit=crop&w=1200&q=90','NEW',33,'A lightweight daily carry with a structured shape, quick-access pocket and water-resistant finish.'],
    ['p5','pureflow-portable-bottle-p5','HOME-BOT-005','Home','PureFlow Portable Bottle',24.90,34.90,4.8,914,'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=1200&q=90','BESTSELLER',52,'Double-wall insulated bottle designed to keep drinks cold or warm through long days.'],
    ['p6','pocketbeam-mini-projector-p6','GAD-PROJ-006','Gadgets','PocketBeam Mini Projector',129,179,4.6,289,'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=1200&q=90','LIMITED',9,'Compact projector with crisp HD playback for movie nights, travel and casual presentations.'],
    ['p7','pulse-mini-smart-speaker-p7','TECH-SPK-007','Tech','Pulse Mini Smart Speaker',54.99,74.99,4.7,430,'https://images.unsplash.com/photo-1589003077984-894e133dabab?auto=format&fit=crop&w=1200&q=90','TOP RATED',23,'Room-filling sound in a compact body with voice controls and multi-room pairing.'],
    ['p8','cloudstep-everyday-sneakers-p8','LIFE-SNK-008','Lifestyle','CloudStep Everyday Sneakers',59.99,89.99,4.8,1180,'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=90','BESTSELLER',17,'Lightweight everyday sneakers with a cushioned sole and clean, versatile silhouette.'],
    ['p9','mistglow-aroma-diffuser-p9','HOME-DIF-009','Home','MistGlow Aroma Diffuser',28.99,42.99,4.7,351,'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=1200&q=90','NEW',38,'Quiet ultrasonic diffuser with a soft ambient glow and all-day mist cycle.'],
    ['p10','lumaskin-cooling-face-roller-p10','BEA-ROL-010','Beauty','LumaSkin Cooling Face Roller',19.99,29.99,4.6,276,'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1200&q=90','SELF CARE',44,'A refreshing facial roller designed for a calm, cooling skincare routine.'],
    ['p11','orbit-magnetic-phone-stand-p11','GAD-STD-011','Gadgets','Orbit Magnetic Phone Stand',22.99,31.99,4.8,738,'https://images.unsplash.com/photo-1586953208448-b95a79798f07?auto=format&fit=crop&w=1200&q=90','SMART PICK',60,'A sturdy magnetic stand for desks and nightstands with easy one-hand viewing.'],
    ['p12','dailycarry-travel-organizer-p12','LIFE-ORG-012','Lifestyle','DailyCarry Travel Organizer',26.50,39.50,4.7,329,'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1200&q=90','TRAVEL',29,'Organize chargers, cables and small essentials with smart compartments and a durable finish.']
  ];
}

async function seedIfEmpty() {
  const { rows } = await pool.query('select count(*)::int as count from products');
  if (rows[0].count > 0) return;
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const p of seedProducts()) {
      await client.query(`insert into products(id,slug,sku,cat,title,price,old_price,rating,reviews,image,badge,stock,description,currency) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict(id) do nothing`, [...p, CURRENCY.toUpperCase()]);
      await client.query(`insert into product_images(product_id,url,alt,sort_order) values($1,$2,$3,0) on conflict do nothing`, [p[0], p[9], p[4]]);
      const variants = p[4].includes('Headphones') ? [['v1','Midnight',p[5],p[6],12,{color:'Midnight'}],['v2','Silver',p[5],p[6],8,{color:'Silver'}],['v3','Starlight',p[5]+5,p[6],6,{color:'Starlight'}]] : [];
      for (const v of variants) await client.query(`insert into product_variants(id,product_id,sku,title,price,old_price,stock,options,image) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(id) do nothing`, [`${p[0]}-${v[0]}`,p[0],`${p[2]}-${v[0].toUpperCase()}`,v[1],v[2],v[3],v[4],v[5],p[9]]);
    }
    await client.query(`insert into coupons(code,percent_off,active,max_uses,minimum_subtotal) values('NOVA10',10,true,10000,0) on conflict(code) do nothing`);
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
}

async function releaseInventory(client, orderIdValue, actorUserId = null) {
  const lock = await client.query('select inventory_released from orders where id=$1 for update', [orderIdValue]);
  if (!lock.rowCount || lock.rows[0].inventory_released) return false;
  const { rows } = await client.query('select product_id,variant_id,qty from order_items where order_id=$1', [orderIdValue]);
  for (const item of rows) {
    if (item.variant_id) {
      await client.query('update product_variants set stock=stock+$1,updated_at=now() where id=$2', [item.qty, item.variant_id]);
    } else {
      await client.query('update products set stock=stock+$1,updated_at=now() where id=$2', [item.qty, item.product_id]);
    }
    await client.query('insert into inventory_movements(product_id,variant_id,change_qty,reason,order_id,created_by) values($1,$2,$3,$4,$5,$6)', [item.product_id,item.variant_id,item.qty,'release',orderIdValue,actorUserId]);
  }
  await client.query('update orders set inventory_released=true,updated_at=now() where id=$1', [orderIdValue]);
  return true;
}

async function releaseCoupon(client, orderIdValue, decrementApplied=false){const r=await client.query(`select id,coupon_code,status from coupon_redemptions where order_id=$1 for update`,[orderIdValue]);if(!r.rowCount)return false;const row=r.rows[0];if(row.status==='reserved'){await client.query(`update coupon_redemptions set status='released',released_at=now() where id=$1`,[row.id]);return true;}if(decrementApplied&&row.status==='applied'){await client.query(`update coupon_redemptions set status='released',released_at=now() where id=$1`,[row.id]);await client.query(`update coupons set uses_count=greatest(uses_count-1,0) where code=$1`,[row.coupon_code]);return true;}return false;}
async function applyReservedCoupon(client, orderIdValue){const r=await client.query(`select id,coupon_code,status from coupon_redemptions where order_id=$1 for update`,[orderIdValue]);if(!r.rowCount||r.rows[0].status!=='reserved')return false;await client.query(`update coupon_redemptions set status='applied',applied_at=now() where id=$1`,[r.rows[0].id]);await client.query(`update coupons set uses_count=uses_count+1 where code=$1`,[r.rows[0].coupon_code]);return true;}

async function reconcileExpiredReservations() {
 const c=await pool.connect();let count=0;
 try {
  await c.query('begin');
  const due=await c.query("select * from orders where status='pending_payment' and payment_status='unpaid' and reservation_expires_at<now() for update skip locked limit 25");
  for(const o of due.rows){
   if(stripe){
    try{
     if(!o.payment_session_id){console.error('Unlinked payment requires review',o.id);continue;}
     const ps=await stripe.checkout.sessions.retrieve(o.payment_session_id);
     if(ps.payment_status==='paid'){await applyStripePayment(c,ps);continue;}
     if(ps.status==='complete')continue;
     if(ps.status==='open')await stripe.checkout.sessions.expire(ps.id);
    }catch(e){
     // Only an explicit invalid expiry on a never-created session is conclusive.
     console.error('Payment reconciliation needs retry',o.id,e.message);continue;
    }
   }
   await expireOrder(c,o.id,'payment_expired','Payment reservation expired');count++;
  }
  await c.query("delete from sessions where expires_at<now() or revoked_at<now()-interval '30 days'");
  await c.query('commit');return count;
 }catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}
}

const validTransitions = {
  pending_payment: new Set(['paid','payment_failed','payment_expired','cancelled']),
  placed: new Set(['processing','cancelled','refunded','shipped']),
  paid: new Set(['processing','cancelled','refunded']),
  processing: new Set(['packed','cancelled','refunded']),
  packed: new Set(['shipped','cancelled','refunded']),
  shipped: new Set(['delivered','refunded']),
  delivered: new Set(['refunded']),
  payment_failed: new Set([]),
  payment_expired: new Set([]),
  cancelled: new Set([]),
  refunded: new Set([]),
};

async function transitionOrder(client, id, nextStatus, actorUserId, note = '') {
  const current = await client.query('select status from orders where id=$1 for update', [id]);
  if (!current.rowCount) throw new Error('Order not found.');
  const from = current.rows[0].status;
  if (from !== nextStatus && !validTransitions[from]?.has(nextStatus)) throw new Error(`Invalid order transition: ${from} → ${nextStatus}`);
  await client.query(`update orders set status=$1,updated_at=now(),cancelled_at=case when $1='cancelled' then now() else cancelled_at end,refunded_at=case when $1='refunded' then now() else refunded_at end where id=$2`, [nextStatus,id]);
  await client.query(`insert into order_status_history(order_id,from_status,to_status,note,changed_by) values($1,$2,$3,$4,$5)`, [id,from,nextStatus,note,actorUserId || null]);
}

async function getOrderById(id) { const { rows } = await pool.query('select * from orders where id=$1', [id]); return rows[0] || null; }

async function expireOrder(c,id,status,note){
 const r=await c.query("select * from orders where id=$1 and status='pending_payment' and payment_status='unpaid' for update",[id]);
 if(!r.rowCount)return;
 await transitionOrder(c,id,status,null,note);await releaseInventory(c,id);await releaseCoupon(c,id);
 await c.query("update orders set payment_status='failed',reservation_expires_at=null where id=$1",[id]);
}
async function applyStripePayment(c,ps){
 const id=ps.metadata?.order_id;if(!id)return;
 const r=await c.query('select * from orders where id=$1 for update',[id]);if(!r.rowCount)throw new Error('Unknown payment order.');
 const o=r.rows[0];
 if(ps.mode!=='payment'||ps.payment_status!=='paid'||String(ps.currency).toLowerCase()!==String(o.currency).trim().toLowerCase()||Number(ps.amount_total)!==Math.round(Number(o.total)*100)||ps.client_reference_id!==o.idempotency_key||(o.payment_session_id&&ps.id!==o.payment_session_id))throw new Error('Payment details do not match the order.');
 if(o.payment_status==='paid'||['partially_refunded','refunded'].includes(o.payment_status))return;
 if(o.status!=='pending_payment'||o.inventory_released)throw new Error('Payment received for a closed reservation; manual reconciliation required.');
 await c.query("update orders set status='paid',payment_status='paid',payment_intent_id=$2,payment_session_id=$3,paid_at=now(),reservation_expires_at=null,updated_at=now() where id=$1",[id,ps.payment_intent,ps.id]);
 await c.query("update seller_orders set status='paid',updated_at=now() where order_id=$1",[id]);
 await applyReservedCoupon(c,id);
 await c.query("insert into order_status_history(order_id,from_status,to_status,note) values($1,'pending_payment','paid','Verified payment received')",[id]);
 if(o.user_id){const points=Math.floor(Number(o.total)*LOYALTY_POINTS_PER_CURRENCY);await c.query('insert into loyalty_ledger(user_id,points,reason,order_id) values($1,$2,$3,$4)',[o.user_id,points,'Purchase',id]);await c.query('update users set loyalty_points=loyalty_points+$1 where id=$2',[points,o.user_id]);}
 const url=`${BASE}/orders.html?order=${encodeURIComponent(id)}`;
 await c.query('insert into email_outbox(to_email,subject,html,text_body) values($1,$2,$3,$4)',[o.customer_email,`Order ${id} confirmed`,`<p>Your payment was received.</p><p><a href="${escapeHtml(url)}">View your order</a></p>`,`Payment received. View your order: ${url}`]);
}
app.post('/api/stripe/webhook',express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{
 if(!stripe||!env.STRIPE_WEBHOOK_SECRET)return fail(res,503,'Payment notifications unavailable.');
 let event;try{event=stripe.webhooks.constructEvent(req.body,req.get('stripe-signature'),env.STRIPE_WEBHOOK_SECRET);}catch{return fail(res,400,'Invalid payment notification signature.');}
 const c=await pool.connect();
 try{
  await c.query('begin');await c.query('select pg_advisory_xact_lock(hashtext($1))',['stripe:'+event.id]);
  const old=await c.query('select processed_at from stripe_events where id=$1',[event.id]);if(old.rows[0]?.processed_at){await c.query('rollback');return ok(res,{received:true,duplicate:true});}
  await c.query('insert into stripe_events(id,type) values($1,$2) on conflict(id) do nothing',[event.id,event.type]);
  const x=event.data.object;
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)){
   if(x.payment_status==='paid')await applyStripePayment(c,x);
  }else if(['checkout.session.expired','checkout.session.async_payment_failed'].includes(event.type)){
   if(x.metadata?.order_id)await expireOrder(c,x.metadata.order_id,event.type.endsWith('expired')?'payment_expired':'payment_failed',event.type);
  }else if(event.type==='payment_intent.payment_failed'){
   // A declined card can be retried in the same Checkout session.
   await c.query("update orders set payment_failure_code=$2,payment_failure_message=$3 where id=$1 and status='pending_payment'",[x.metadata?.order_id||'',safeText(x.last_payment_error?.code,120),safeText(x.last_payment_error?.message,500)]);
  }else if(['refund.created','refund.updated','refund.failed'].includes(event.type)){
   // Retrieve current provider state: events can arrive late or out of order.
   const rf=await stripe.refunds.retrieve(x.id);
   const intent=typeof rf.payment_intent==='object'?rf.payment_intent?.id:rf.payment_intent;
   const r=await c.query('select * from orders where payment_intent_id=$1 for update',[intent]);
   if(r.rowCount){const o=r.rows[0];await recordProviderRefund(c,o,rf);
    const sum=await c.query("select coalesce(sum(amount),0) amount from refunds where order_id=$1 and status='succeeded'",[o.id]);
    const refunded=Math.round(Number(sum.rows[0].amount)*100),status=refunded>=Math.round(Number(o.total)*100)?'refunded':refunded>0?'partially_refunded':'paid';
    if(status==='refunded'&&o.status!=='refunded')await transitionOrder(c,o.id,'refunded',null,'Refund reconciled');
    await c.query('update orders set payment_status=$1,updated_at=now() where id=$2',[status,o.id]);
   }
  }else if(event.type==='charge.refunded'){
   const r=await c.query('select * from orders where payment_intent_id=$1 for update',[x.payment_intent]);
   if(r.rowCount){const o=r.rows[0];let after;do{const page=await stripe.refunds.list({payment_intent:x.payment_intent,limit:100,...(after?{starting_after:after}:{})});for(const rf of page.data)await recordProviderRefund(c,o,rf);after=page.has_more?page.data.at(-1)?.id:null;}while(after);
    const sum=await c.query("select coalesce(sum(amount),0) amount from refunds where order_id=$1 and status='succeeded'",[o.id]);const refunded=Number(sum.rows[0].amount);const status=refunded>=Number(o.total)?'refunded':refunded>0?'partially_refunded':'paid';
    if(status==='refunded'&&o.status!=='refunded')await transitionOrder(c,o.id,'refunded',null,'Refund reconciled');
    await c.query('update orders set payment_status=$1,updated_at=now() where id=$2',[status,o.id]);
   }
  }
  await c.query("update stripe_events set processed_at=now(),error='' where id=$1",[event.id]);await c.query('commit');return ok(res,{received:true});
 }catch(e){await c.query('rollback').catch(()=>{});console.error('Payment notification failed',event.id,e.message);return fail(res,500,'Payment notification needs retry.');}finally{c.release();}
});

app.get('/api/ready', async (_req, res) => {
  try { await pool.query('select 1'); return ok(res,{ok:true,ready:true}); } catch { return fail(res,503,'Service not ready.'); }
});
app.get('/api/health', async (_req,res) => {
  try {
    const start = Date.now(); await pool.query('select 1');
    return ok(res,{ok:true,service:'novacart',version:'21.8.0',dbLatencyMs:Date.now()-start,stripeConfigured:Boolean(stripe),mailConfigured:Boolean(mailer),currency:CURRENCY.toUpperCase(),returnsDays:RETURNS_DAYS,supportEmail:SUPPORT_EMAIL});
  } catch { return fail(res,503,'Database unavailable.'); }
});
app.get('/api/store-config', (_req,res)=>ok(res,{name:BUSINESS_NAME,currency:CURRENCY.toUpperCase(),returnsDays:RETURNS_DAYS,supportEmail:SUPPORT_EMAIL,businessCountry:BUSINESS_COUNTRY,cardPayments:Boolean(stripe),codAvailable:true,shipping:{standard:STANDARD_SHIPPING_RATE,freeThreshold:FREE_SHIPPING_THRESHOLD,express:EXPRESS_SHIPPING_RATE},taxRate:TAX_RATE,features:{serverWishlist:true,dynamicCoupons:true,recommendations:true,productQuestions:true,sellerPayoutLedger:true}}));

app.get('/api/categories',async(_req,res)=>{
  const {rows}=await pool.query("select min(cat) as name from products where active=true and trim(cat)<>'' group by lower(cat) order by lower(min(cat))");
  return ok(res,{categories:rows.map(row=>row.name)});
});
app.get('/api/products', async (req,res) => {
  const q=safeText(req.query.q,100).toLowerCase();
  const cat=safeText(req.query.cat,60).toLowerCase();
  const sort=['featured','low','high','rating','new'].includes(req.query.sort)?String(req.query.sort):'featured';
  const page=Number(req.query.page??1),limit=Number(req.query.limit??24),offset=(page-1)*limit;
  if(!Number.isSafeInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>48||!Number.isSafeInteger(offset))return fail(res,400,'Invalid product page or page size.');
  const where=[]; const params=[];
  if(q){params.push(`%${q}%`);where.push(`(lower(title) like $${params.length} or lower(description) like $${params.length} or lower(cat) like $${params.length} or lower(brand) like $${params.length} or lower(search_keywords) like $${params.length})`)}
  if(cat && cat!=='all'){params.push(cat);where.push(`lower(cat)=$${params.length}`)}
  const order=sort==='low'?'price asc':sort==='high'?'price desc':sort==='rating'?'rating desc,reviews desc':sort==='new'?'created_at desc':'(case when badge in (\'BESTSELLER\',\'HOT DEAL\',\'TRENDING\') then 0 else 1 end),created_at desc';
  const clause=where.length?`where active=true and ${where.join(' and ')}`:'where active=true';
  const count=await pool.query(`select count(*)::int as count from products ${clause}`,params);
  params.push(limit,offset);
  const {rows}=await pool.query(`select id,slug,sku,cat,title,price,old_price as "oldPrice",rating,reviews,image,badge,stock,description,currency,seo_title as "seoTitle",seo_description as "seoDescription" from products ${clause} order by ${order},id asc limit $${params.length-1} offset $${params.length}`,params);
  return ok(res,{products:rows.map(r=>({...r,price:Number(r.price),oldPrice:r.oldPrice==null?undefined:Number(r.oldPrice),rating:Number(r.rating)})),pagination:{page,limit,total:count.rows[0].count,pages:Math.ceil(count.rows[0].count/limit)}});
});

app.get('/api/products/:id',async(req,res)=>{
 const product=await publicProduct(pool,req.params.id,{currency:CURRENCY,returnsDays:RETURNS_DAYS});
 if(!product)return fail(res,404,'Product not found.');return ok(res,{product});
});

app.get('/api/products/:id/reviews', async (req,res)=>{
  const {rows}=await pool.query(`select r.id,r.rating,r.title,r.body,r.created_at as "createdAt",u.name from reviews r join users u on u.id=r.user_id where r.product_id=$1 and r.status='approved' order by r.created_at desc limit 100`,[safeText(req.params.id,100)]);
  return ok(res,{reviews:rows});
});

app.get('/api/auth/me',auth,async(req,res)=>ok(res,{user:{id:req.session.uid,name:req.session.name,email:req.session.email,phone:req.session.phone,emailVerified:req.session.email_verified,isAdmin:req.session.is_admin,marketingOptIn:req.session.marketing_opt_in}}));
app.get('/api/auth/csrf',auth,(req,res)=>ok(res,{csrfToken:req.session.csrf_token}));

app.get('/api/auth/sessions',auth,async(req,res)=>{const{rows}=await pool.query(`select id,created_at,last_seen_at,expires_at,user_agent_hash,(id=$2) as current from sessions where user_id=$1 and revoked_at is null and expires_at>now() order by last_seen_at desc`,[req.session.uid,req.session.session_id]);return ok(res,{sessions:rows});});
app.delete('/api/auth/sessions/:id',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=safeText(req.params.id,100);const r=await pool.query('update sessions set revoked_at=now() where id=$1 and user_id=$2 and revoked_at is null returning id',[id,req.session.uid]);if(!r.rowCount)return fail(res,404,'Session not found.');return ok(res,{ok:true});});
app.post('/api/auth/sessions/revoke-all',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');await pool.query('update sessions set revoked_at=now() where user_id=$1 and id<>$2 and revoked_at is null',[req.session.uid,req.session.session_id]);return ok(res,{ok:true});});
app.get('/api/customer/preferences',auth,async(req,res)=>ok(res,{marketingOptIn:Boolean(req.session.marketing_opt_in)}));
app.put('/api/customer/preferences',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const opt=Boolean(req.body?.marketingOptIn);await pool.query('update users set marketing_opt_in=$1,updated_at=now() where id=$2',[opt,req.session.uid]);return ok(res,{ok:true,marketingOptIn:opt});});

app.post('/api/auth/register',authLimiter,async(req,res)=>{
  const name=safeText(req.body?.name,100); const email=normalizeEmail(req.body?.email); const password=String(req.body?.password||'');
  if(name.length<2)return fail(res,400,'Enter your full name.');
  if(!emailOk(email))return fail(res,400,'Enter a valid email address.');
  if(!passwordStrong(password,PASSWORD_MIN))return fail(res,400,`Password must be at least ${PASSWORD_MIN} characters and include a letter, number and symbol.`);
  if(REQUIRE_EMAIL_VERIFICATION && !mailer && isProd)return fail(res,503,'Email verification is temporarily unavailable. Please try again later.');
  const exists=await pool.query('select id from users where email=$1',[email]); if(exists.rowCount)return fail(res,409,'An account with that email already exists.');
  const hash=await bcrypt.hash(password,12); const id=newId();
  try { await pool.query('insert into users(id,name,email,password_hash,email_verified) values($1,$2,$3,$4,$5)',[id,name,email,hash,!REQUIRE_EMAIL_VERIFICATION]); }
  catch(e){ if(e?.code==='23505') return fail(res,409,'An account with that email already exists.'); throw e; }
  let csrfToken=null, verificationSent=false;
  if(REQUIRE_EMAIL_VERIFICATION){
    const token=newToken(); await pool.query("insert into email_verifications(id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '24 hours')",[newId(),id,hashToken(token)]);
    const url=`${BASE}/verify-email.html?token=${encodeURIComponent(token)}`;
    verificationSent=await queueMail(email,'Verify your NovaCart email',`<p>Welcome to NovaCart, ${escapeHtml(name)}.</p><p><a href="${url}">Verify your email</a></p><p>This link expires in 24 hours.</p>`, `Verify your NovaCart email: ${url}`);
  } else csrfToken=await createSession(req,res,id, req.body?.remember !== false);
  return res.status(201).json({user:{id,name,email,phone:'',emailVerified:!REQUIRE_EMAIL_VERIFICATION,marketingOptIn:false},csrfToken,verificationSent});
});

app.post('/api/auth/verify-email',authLimiter,async(req,res)=>{
  const token=String(req.body?.token||''); if(!token)return fail(res,400,'Verification token is required.');
  const client=await pool.connect();
  try{await client.query('begin');const r=await client.query(`select id,user_id from email_verifications where token_hash=$1 and used_at is null and expires_at>now() for update`,[hashToken(token)]);if(!r.rowCount){await client.query('rollback');return fail(res,400,'Verification link is invalid or expired.');}await client.query('update users set email_verified=true,updated_at=now() where id=$1',[r.rows[0].user_id]);await client.query('update email_verifications set used_at=now() where id=$1',[r.rows[0].id]);await client.query('commit');return ok(res,{ok:true});}
  catch(e){await client.query('rollback').catch(()=>{});return fail(res,500,'Could not verify email.');}finally{client.release();}
});

app.post('/api/auth/login',authLimiter,async(req,res)=>{
  const email=normalizeEmail(req.body?.email);const password=String(req.body?.password||'');
  if(!emailOk(email)||!password)return fail(res,400,'Email and password are required.');
  const r=await pool.query('select * from users where email=$1',[email]);const user=r.rows[0];
  if(!user||!(await bcrypt.compare(password,user.password_hash)))return fail(res,401,'Invalid email or password.');
  if(user.is_admin)return fail(res,403,'Admin accounts must use the Admin sign-in tab.',{adminLoginRequired:true});
  if(REQUIRE_EMAIL_VERIFICATION&&!user.email_verified)return fail(res,403,'Please verify your email before signing in.');
  await pool.query('update users set last_login_at=now(),updated_at=now() where id=$1',[user.id]);
  const csrfToken=await createSession(req,res,user.id, req.body?.remember !== false);
  return ok(res,{user:{id:user.id,name:user.name,email:user.email,phone:user.phone,emailVerified:user.email_verified,isAdmin:user.is_admin,marketingOptIn:user.marketing_opt_in},csrfToken});
});

app.post('/api/auth/logout',async(req,res)=>{await destroySession(req,res);return ok(res,{ok:true});});
app.post('/api/auth/forgot',authLimiter,async(req,res)=>{
  const generic={ok:true,message:'If an account exists, password reset instructions have been sent.'};const email=normalizeEmail(req.body?.email);if(!emailOk(email))return ok(res,generic);
  const r=await pool.query('select id,name from users where email=$1',[email]);if(!r.rowCount)return ok(res,generic);
  if(!mailer&&isProd)return ok(res,generic);
  const token=newToken();await pool.query("insert into password_resets(id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '30 minutes')",[newId(),r.rows[0].id,hashToken(token)]);
  const url=`${BASE}/reset-password.html?token=${encodeURIComponent(token)}`;
  await queueMail(email,'Reset your NovaCart password',`<p>Hi ${escapeHtml(r.rows[0].name)},</p><p><a href="${url}">Reset your password</a></p><p>This link expires in 30 minutes.</p>`,`Reset your NovaCart password: ${url}`);
  return ok(res,generic);
});
app.post('/api/auth/reset',authLimiter,async(req,res)=>{
  const token=String(req.body?.token||'');const password=String(req.body?.password||'');if(!token||!passwordStrong(password,PASSWORD_MIN))return fail(res,400,'Invalid token or password.');
  const client=await pool.connect();
  try{await client.query('begin');const r=await client.query(`select id,user_id from password_resets where token_hash=$1 and used_at is null and expires_at>now() for update`,[hashToken(token)]);if(!r.rowCount){await client.query('rollback');return fail(res,400,'Reset link is invalid or expired.');}const hash=await bcrypt.hash(password,12);await client.query('update users set password_hash=$1,updated_at=now() where id=$2',[hash,r.rows[0].user_id]);await client.query('update password_resets set used_at=now() where id=$1',[r.rows[0].id]);await client.query('update sessions set revoked_at=now() where user_id=$1 and revoked_at is null',[r.rows[0].user_id]);await client.query('commit');return ok(res,{ok:true});}
  catch(e){await client.query('rollback').catch(()=>{});return fail(res,500,'Could not reset password.');}finally{client.release();}
});

app.get('/api/customer',auth,async(req,res)=>{
  const addresses=await pool.query(`select id,label,"full_name" as "fullName",line1,line2,city,state,"postal_code" as "postalCode",country,phone,"is_default" as "isDefault" from addresses where user_id=$1 order by is_default desc,created_at desc`,[req.session.uid]);
  return ok(res,{customer:{id:req.session.uid,name:req.session.name,email:req.session.email,phone:req.session.phone,addresses:addresses.rows}});
});
app.put('/api/customer',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const name=safeText(req.body?.name,100);const phone=safeText(req.body?.phone,50);if(name.length<2)return fail(res,400,'Enter your full name.');if(!phoneOk(phone))return fail(res,400,'Invalid phone number.');await pool.query('update users set name=$1,phone=$2,updated_at=now() where id=$3',[name,phone,req.session.uid]);return ok(res,{ok:true});});
app.post('/api/customer',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const name=safeText(req.body?.name,100);const phone=safeText(req.body?.phone,50);const addresses=Array.isArray(req.body?.addresses)?req.body.addresses.slice(0,8):null;if(name.length<2)return fail(res,400,'Enter your full name.');if(!phoneOk(phone))return fail(res,400,'Invalid phone number.');if(addresses){for(const a of addresses){if(!a)continue;for(const k of ['fullName','line1','city','postalCode','country'])if(!safeText(a[k],250))return fail(res,400,`Address ${k} is required.`);const c=normalizeCountry(a.country);if(!phoneOk(a.phone||phone)||!postalOk(a.postalCode,c))return fail(res,400,'One of the saved addresses is invalid.');}}const client=await pool.connect();try{await client.query('begin');await client.query('update users set name=$1,phone=$2,updated_at=now() where id=$3',[name,phone,req.session.uid]);if(addresses){await client.query('delete from addresses where user_id=$1',[req.session.uid]);for(let i=0;i<addresses.length;i++){const a=addresses[i];await client.query(`insert into addresses(id,user_id,label,full_name,line1,line2,city,state,postal_code,country,phone,is_default) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[newId(),req.session.uid,safeText(a.label||`Address ${i+1}`,60),safeText(a.fullName,100),safeText(a.line1,200),safeText(a.line2,200),safeText(a.city,100),safeText(a.state,100),safeText(a.postalCode,30),normalizeCountry(a.country),safeText(a.phone||phone,50),i===0]);}}await client.query('commit');return ok(res,{ok:true});}catch(e){await client.query('rollback').catch(()=>{});return fail(res,400,'Could not update customer.');}finally{client.release();}});
app.post('/api/customer/addresses',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const a=req.body||{};for(const k of ['fullName','line1','city','postalCode','country'])if(!safeText(a[k],200))return fail(res,400,`Address ${k} is required.`);const country=normalizeCountry(a.country);if(!phoneOk(a.phone||req.session.phone))return fail(res,400,'Invalid phone number.');if(!postalOk(a.postalCode,country))return fail(res,400,'Invalid postal code.');const client=await pool.connect();try{await client.query('begin');if(a.isDefault)await client.query('update addresses set is_default=false,updated_at=now() where user_id=$1',[req.session.uid]);const id=newId();await client.query(`insert into addresses(id,user_id,label,full_name,line1,line2,city,state,postal_code,country,phone,is_default) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,req.session.uid,safeText(a.label||'Address',60),safeText(a.fullName,100),safeText(a.line1,200),safeText(a.line2,200),safeText(a.city,100),safeText(a.state,100),safeText(a.postalCode,30),safeText(a.country,80),safeText(a.phone||req.session.phone,50),Boolean(a.isDefault)]);await client.query('commit');return ok(res,{ok:true,id});}catch(e){await client.query('rollback').catch(()=>{});return fail(res,400,'Could not save address.');}finally{client.release();}}
);
app.patch('/api/customer/addresses/:id',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=safeText(req.params.id,100);const a=req.body||{};const allowed=['label','fullName','line1','line2','city','state','postalCode','country','phone','isDefault'];if(Object.keys(a).some(k=>!allowed.includes(k)))return fail(res,400,'Invalid address fields.');const client=await pool.connect();try{await client.query('begin');if(a.isDefault)await client.query('update addresses set is_default=false,updated_at=now() where user_id=$1',[req.session.uid]);const r=await client.query(`update addresses set label=$1,full_name=$2,line1=$3,line2=$4,city=$5,state=$6,postal_code=$7,country=$8,phone=$9,is_default=coalesce($10,is_default),updated_at=now() where id=$11 and user_id=$12 returning id`,[safeText(a.label,60),safeText(a.fullName,100),safeText(a.line1,200),safeText(a.line2,200),safeText(a.city,100),safeText(a.state,100),safeText(a.postalCode,30),safeText(a.country,80),safeText(a.phone,50),a.isDefault, id, req.session.uid]);if(!r.rowCount){await client.query('rollback');return fail(res,404,'Address not found.');}await client.query('commit');return ok(res,{ok:true});}catch(e){await client.query('rollback').catch(()=>{});return fail(res,400,'Could not update address.');}finally{client.release();}});
app.delete('/api/customer/addresses/:id',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const r=await pool.query('delete from addresses where id=$1 and user_id=$2 returning id',[safeText(req.params.id,100),req.session.uid]);if(!r.rowCount)return fail(res,404,'Address not found.');return ok(res,{ok:true});});

app.get('/api/orders',auth,async(req,res)=>{const{rows}=await pool.query(`select o.*,coalesce(json_agg(json_build_object('productId',oi.product_id,'variantId',oi.variant_id,'title',oi.title,'image',oi.image,'qty',oi.qty,'unitPrice',oi.unit_price,'options',oi.options)) filter(where oi.id is not null),'[]') as items from orders o left join order_items oi on oi.order_id=o.id where o.user_id=$1 group by o.id order by o.created_at desc limit 200`,[req.session.uid]);const fulfillment=await customerShipments(pool,rows,BUSINESS_NAME);res.set('Cache-Control','private, no-store');return ok(res,{orders:rows.map(o=>({...o,...fulfillment.get(o.id),total:Number(o.total),subtotal:Number(o.subtotal),discount:Number(o.discount),shipping:Number(o.shipping),tax:Number(o.tax),items:o.items.map(i=>({...i,unitPrice:Number(i.unitPrice)}))}))});});

function normalizeItems(items){if(!Array.isArray(items)||!items.length||items.length>100)return null;return items.map(x=>({id:safeText(x?.id,100),variantId:safeText(x?.variantId,100),qty:Math.max(1,Math.min(20,Number(x?.qty)||1))}));}

async function calculateCheckout(input,client){
  const normalized=normalizeItems(input.items);if(!normalized)throw new Error('Cart is empty.');
  const items=[];
  for(const line of normalized){
    let p;
    if(line.variantId){
      const r=await client.query(`select v.*,p.title as parent_title,p.image as parent_image,p.cat from product_variants v join products p on p.id=v.product_id where v.id=$1 and v.active=true and p.active=true for update`,[line.variantId]);
      p=r.rows[0];if(!p)throw new Error('A product variant in your cart is unavailable.');
      if(Number(p.stock)<line.qty)throw new Error(`${p.title} has only ${p.stock} left in stock.`);
      items.push({productId:p.product_id,variantId:p.id,title:`${p.parent_title} — ${p.title}`,image:p.image||p.parent_image,qty:line.qty,unitPrice:Number(p.price),options:p.options||{}});
    }else{
      const r=await client.query(`select * from products where id=$1 and active=true for update`,[line.id]);p=r.rows[0];if(!p)throw new Error('A product in your cart is unavailable.');
      if(Number(p.stock)<line.qty)throw new Error(`${p.title} has only ${p.stock} left in stock.`);
      items.push({productId:p.id,variantId:null,title:p.title,image:p.image,qty:line.qty,unitPrice:Number(p.price),options:{}});
    }
  }
  const subtotal=money(items.reduce((s,x)=>s+x.unitPrice*x.qty,0));let discount=0;const coupon=safeText(input.coupon,40).toUpperCase();
  if(coupon){const c=await client.query(`select * from coupons where code=$1 and active=true and (expires_at is null or expires_at>now()) and (max_uses is null or uses_count<max_uses) for update`,[coupon]);if(!c.rowCount)throw new Error('Invalid or expired coupon.');const row=c.rows[0];if(subtotal<Number(row.minimum_subtotal||0))throw new Error(`Minimum subtotal for this coupon is ${Number(row.minimum_subtotal).toFixed(2)}.`);discount=row.percent_off?money(subtotal*Number(row.percent_off)/100):Math.min(subtotal,money(Number(row.fixed_off||0)));}
  const delivery=input.delivery==='express'?'express':'standard'; const country=safeText((input.shippingAddress||{}).country,80).toUpperCase(); const zone=SHIPPING_ZONES[country]||{}; const standardRate=Number(zone.standard ?? STANDARD_SHIPPING_RATE); const expressRate=Number(zone.express ?? EXPRESS_SHIPPING_RATE); const freeThreshold=Number(zone.freeThreshold ?? FREE_SHIPPING_THRESHOLD); const taxRate=Number(TAX_RATES[country] ?? TAX_RATE); const shipping=delivery==='express'?Math.max(0,expressRate):(subtotal-discount>=freeThreshold?0:Math.max(0,standardRate));const taxable=Math.max(0,subtotal-discount);const tax=money(taxable*Math.max(0,taxRate));const total=money(taxable+shipping+tax);return{items,subtotal,discount,shipping,tax,total,delivery,coupon};
}

function stripeLineItems(calc) {
 // Allocate the discount in integer cents, then split quantities when needed.
 const gross=calc.items.map(i=>Math.round(i.unitPrice*100)*i.qty);
 const total=gross.reduce((a,b)=>a+b,0), discount=Math.min(total,Math.round(calc.discount*100));
 const allocations=gross.map(v=>total?Math.floor(discount*v/total):0);
 let left=discount-allocations.reduce((a,b)=>a+b,0);
 const order=gross.map((v,i)=>({i,remainder:total?(discount*v)%total:0})).sort((a,b)=>b.remainder-a.remainder);
 for(let n=0;n<left;n++)allocations[order[n%order.length].i]++;
 const out=[];
 const add=(name,cents,qty)=>{if(qty>0)out.push({price_data:{currency:CURRENCY,unit_amount:cents,product_data:{name}},quantity:qty});};
 calc.items.forEach((i,n)=>{const net=gross[n]-allocations[n], unit=Math.floor(net/i.qty), extra=net%i.qty;add(i.title,unit,i.qty-extra);add(i.title,unit+1,extra);});
 if(calc.shipping)add('Delivery',Math.round(calc.shipping*100),1);
 if(calc.tax)add('Tax',Math.round(calc.tax*100),1);
 return out;
}
app.post('/api/checkout',checkoutLimiter,async(req,res)=>{
  const session=await getSession(req);if(session){req.session=session;if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');}
  const key=req.get('idempotency-key');if(!isValidIdempotencyKey(key))return fail(res,400,'A valid Idempotency-Key is required for checkout.');
  const input=req.body||{};const email=normalizeEmail(input.email||session?.email);if(!emailOk(email))return fail(res,400,'Enter a valid email address.');
  const address=input.shippingAddress||{};for(const k of ['fullName','line1','city','postalCode','country'])if(!safeText(address[k],200))return fail(res,400,`Shipping ${k} is required.`);const checkoutCountry=normalizeCountry(address.country);if(!phoneOk(input.phone||''))return fail(res,400,'Invalid phone number.');if(!postalOk(address.postalCode,checkoutCountry))return fail(res,400,'Invalid postal code.');
  const paymentMethod=input.paymentMethod==='cod'?'cod':'stripe';if(paymentMethod==='stripe'&&!stripe)return fail(res,503,'Card payment is not configured yet.');
  const client=await pool.connect();
  try{
    await client.query('begin');
    const existing=await client.query('select id,status,payment_status,payment_session_id from orders where idempotency_key=$1 for update',[key]);
    if(existing.rowCount){
      await client.query('commit');const o=existing.rows[0];if(o.payment_session_id&&stripe&&o.payment_status==='unpaid'){const s=await stripe.checkout.sessions.retrieve(o.payment_session_id);return ok(res,{id:o.id,mode:'stripe',url:s.url});}return ok(res,{id:o.id,mode:paymentMethod,orderId:o.id});
    }
    const calc=await calculateCheckout(input,client); const id=orderId();
    await supplierCheckout(client,calc.items,checkoutCountry,paymentMethod,env);
    if(calc.coupon){const c=await client.query(`select * from coupons where code=$1 and active=true and (expires_at is null or expires_at>now()) for update`,[calc.coupon]);if(!c.rowCount)throw new Error('Invalid or expired coupon.');const row=c.rows[0];if(Number(row.max_uses||0)>0){const pending=await client.query(`select count(*)::int as n from coupon_redemptions where coupon_code=$1 and status='reserved'`,[calc.coupon]);if(Number(row.uses_count)+Number(pending.rows[0].n)>=Number(row.max_uses))throw new Error('That coupon was just used up. Please try another code.');}}
    for(const item of calc.items){
      if(item.variantId){const r=await client.query('update product_variants set stock=stock-$1,updated_at=now() where id=$2 and stock>=$1 returning stock',[item.qty,item.variantId]);if(!r.rowCount)throw new Error('Inventory changed. Please review your cart.');}
      else{const r=await client.query('update products set stock=stock-$1,updated_at=now() where id=$2 and stock>=$1 returning stock',[item.qty,item.productId]);if(!r.rowCount)throw new Error('Inventory changed. Please review your cart.');}
      await client.query('insert into inventory_movements(product_id,variant_id,change_qty,reason,order_id,created_by) values($1,$2,$3,$4,$5,$6)',[item.productId,item.variantId,-item.qty,'reserve',id,session?.uid||null]);
    }
    const status=paymentMethod==='cod'?'placed':'pending_payment';const pstatus=paymentMethod==='cod'?'cod':'unpaid';
    await client.query(`insert into orders(id,user_id,customer_email,customer_name,phone,status,payment_status,payment_method,currency,subtotal,discount,shipping,tax,total,delivery,shipping_address,idempotency_key,reservation_expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,[id,session?.uid||null,email,safeText(input.customerName||address.fullName,100),safeText(input.phone,50),status,pstatus,paymentMethod,CURRENCY,calc.subtotal,calc.discount,calc.shipping,calc.tax,calc.total,calc.delivery,{fullName:safeText(address.fullName,100),line1:safeText(address.line1,200),line2:safeText(address.line2,200),city:safeText(address.city,100),state:safeText(address.state,100),postalCode:safeText(address.postalCode,30),country:safeText(address.country,80)},key,paymentMethod==='stripe'?new Date(Date.now()+35*60_000):null]);
    for(const item of calc.items)await client.query('insert into order_items(order_id,product_id,variant_id,title,image,qty,unit_price,options,supplier_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,item.productId,item.variantId,item.title,item.image,item.qty,item.unitPrice,item.options,item.supplierSnapshot?JSON.stringify(item.supplierSnapshot):null]);
    const sellerTotals=new Map();
    for(const item of calc.items){
      // Products/order_items reference users; seller_orders reference seller profiles.
      const sr=await client.query(`select p.seller_id as owner_id,s.id as profile_id,s.status
        from products p left join sellers s on s.user_id=p.seller_id where p.id=$1`,[item.productId]);
      const seller=sr.rows[0];
      if(!seller?.owner_id)continue;
      if(!seller.profile_id||seller.status!=='approved')throw new Error('A seller in your cart is currently unavailable.');
      sellerTotals.set(seller.profile_id,(sellerTotals.get(seller.profile_id)||0)+Number(item.unitPrice)*Number(item.qty));
      await client.query('update order_items set seller_id=$1 where order_id=$2 and product_id=$3 and variant_id is not distinct from $4',[seller.owner_id,id,item.productId,item.variantId]);
    }
    for(const [sellerId,gross] of sellerTotals){const commission=money(gross*(PLATFORM_COMMISSION_BPS/10000));await client.query('insert into seller_orders(order_id,seller_id,subtotal,commission,seller_net,status) values($1,$2,$3,$4,$5,$6) on conflict(order_id,seller_id) do update set subtotal=excluded.subtotal,commission=excluded.commission,seller_net=excluded.seller_net',[id,sellerId,money(gross),commission,money(gross-commission),paymentMethod==='cod'?'placed':'pending_payment']);}
    if(calc.coupon) await client.query(`insert into coupon_redemptions(id,coupon_code,order_id,user_id,status) values($1,$2,$3,$4,$5)`,[newId(),calc.coupon,id,session?.uid||null,paymentMethod==='cod'?'applied':'reserved']);
    if(calc.coupon&&paymentMethod==='cod') await client.query('update coupons set uses_count=uses_count+1 where code=$1',[calc.coupon]);
    if(paymentMethod==='stripe'){
      const checkout=await stripe.checkout.sessions.create({
        mode:'payment',payment_method_types:['card'],
        success_url:`${BASE}/orders.html?success=1&order=${encodeURIComponent(id)}`,
        cancel_url:`${BASE}/?cancel=1&order=${encodeURIComponent(id)}`,
        customer_email:email,line_items:stripeLineItems(calc),
        metadata:{order_id:id},client_reference_id:key,
        expires_at:Math.floor(Date.now()/1000)+31*60,
        payment_intent_data:{metadata:{order_id:id}}
      },{idempotencyKey:`checkout:${id}`});
      await client.query('update orders set payment_session_id=$1 where id=$2',[checkout.id,id]);
      await client.query(`insert into order_status_history(order_id,from_status,to_status,note) values($1,null,'pending_payment','Stripe checkout created')`,[id]);
      await client.query('commit');return ok(res,{id,mode:'stripe',url:checkout.url});
    }
    await client.query(`insert into order_status_history(order_id,from_status,to_status,note) values($1,null,'placed','Cash on delivery order placed')`,[id]);await client.query('update orders set inventory_released=false where id=$1',[id]);await client.query('commit');if(session?.uid)await awardLoyalty(session.uid,Math.floor(Number(calc.total)*LOYALTY_POINTS_PER_CURRENCY),'Purchase',id);if(session?.uid)await notify(session.uid,'order','Order placed',`Your order ${id} has been placed.`,'/orders.html');await queueMail(email,`NovaCart order ${id}`,`<h2>Order received</h2><p>Your cash-on-delivery order <b>${id}</b> has been placed.</p>`,`NovaCart order ${id} has been placed.`);return ok(res,{mode:'cod',orderId:id});
  }catch(e){await client.query('rollback').catch(()=>{});return fail(res,400,e.message||'Checkout failed.');}finally{client.release();}
});

app.post('/api/products/:id/reviews',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const productId=safeText(req.params.id,100);const rating=Number(req.body?.rating);const title=safeText(req.body?.title,120);const body=safeText(req.body?.body,1000);if(!Number.isInteger(rating)||rating<1||rating>5)return fail(res,400,'Rating must be between 1 and 5.');const verified=await pool.query(`select o.id from orders o join order_items oi on oi.order_id=o.id where o.user_id=$1 and oi.product_id=$2 and o.status in ('paid','processing','packed','shipped','delivered') order by o.created_at desc limit 1`,[req.session.uid,productId]);if(!verified.rowCount)return fail(res,403,'You can review products you have purchased.');try{await pool.query('insert into reviews(product_id,user_id,order_id,rating,title,body,status) values($1,$2,$3,$4,$5,$6,\'pending\')',[productId,req.session.uid,verified.rows[0].id,rating,title,body]);return res.status(201).json({ok:true,message:'Review submitted for approval.'});}catch{return fail(res,409,'You already reviewed this purchase.');}});



app.get('/api/orders/:id/shipment',auth,async(req,res)=>{
  const id=safeText(req.params.id,120);
  const r=await pool.query('select id,status,payment_status,tracking_number,courier,updated_at from orders where id=$1 and user_id=$2',[id,req.session.uid]);
  if(!r.rowCount)return fail(res,404,'Order not found.');
  const fulfillment=(await customerShipments(pool,r.rows,BUSINESS_NAME)).get(id);
  const{rows}=await pool.query('select status,location,note,occurred_at from shipment_events where order_id=$1 order by occurred_at desc',[id]);
  res.set('Cache-Control','private, no-store');
  return ok(res,{order:r.rows[0],...fulfillment,events:rows});
});
app.get('/api/orders/:id/invoice',auth,async(req,res)=>{const id=safeText(req.params.id,120);const safeFilename=id.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80);const r=await pool.query('select * from orders where id=$1 and user_id=$2',[id,req.session.uid]);if(!r.rowCount)return fail(res,404,'Order not found.');const o=r.rows[0];const items=await pool.query('select title,qty,unit_price from order_items where order_id=$1 order by id',[id]);res.type('html').set('Content-Disposition',`inline; filename=\"${safeFilename}.html\"`).send(`<!doctype html><html><head><meta charset=\"utf-8\"><title>Invoice ${escapeHtml(id)}</title><style>body{font-family:Arial;max-width:800px;margin:40px auto;padding:0 20px;color:#222}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}.total{font-size:22px;font-weight:700;text-align:right;margin-top:20px}</style></head><body><h1>${escapeHtml(BUSINESS_NAME)}</h1><h2>Invoice ${escapeHtml(id)}</h2><p>${escapeHtml(o.customer_name)} · ${escapeHtml(o.customer_email)}</p><p>${escapeHtml(o.shipping_address?.line1)}, ${escapeHtml(o.shipping_address?.city)}, ${escapeHtml(o.shipping_address?.country)}</p><table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th></tr></thead><tbody>${items.rows.map(i=>`<tr><td>${escapeHtml(i.title)}</td><td>${i.qty}</td><td>${Number(i.unit_price).toFixed(2)} ${escapeHtml(o.currency)}</td></tr>`).join('')}</tbody></table><div class=\"total\">Total: ${Number(o.total).toFixed(2)} ${escapeHtml(o.currency)}</div></body></html>`);});

app.post('/api/orders/:id/cancel',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=safeText(req.params.id,120);const client=await pool.connect();try{await client.query('begin');const r=await client.query(`select * from orders where id=$1 and user_id=$2 for update`,[id,req.session.uid]);if(!r.rowCount){await client.query('rollback');return fail(res,404,'Order not found.');}const o=r.rows[0];if(!['pending_payment','placed','paid','processing'].includes(o.status)){await client.query('rollback');return fail(res,409,'This order cannot be cancelled now.');}const dispatched=await client.query("select 1 from seller_orders where order_id=$1 and status in ('packed','shipped','delivered') limit 1",[id]);if(dispatched.rowCount){await client.query('rollback');return fail(res,409,'A shipment is already packed or dispatched. Please contact support.');}if(o.payment_status==='paid'&&o.payment_intent_id&&stripe){await client.query('rollback');return fail(res,409,'Paid orders require a refund/cancellation review. Please contact support.');}await transitionOrder(client,id,'cancelled',req.session.uid,'Customer requested cancellation');await releaseInventory(client,id,req.session.uid);await client.query("update orders set payment_status=case when payment_status in ('unpaid','cod') then 'cancelled' else payment_status end where id=$1",[id]);await client.query('commit');await audit(req.session.uid,'order_cancel','order',id);await queueMail(o.customer_email,`NovaCart order ${id} cancelled`,`<p>Your order <b>${id}</b> has been cancelled.</p>`,`Order ${id} cancelled.`);return ok(res,{ok:true});}catch(e){await client.query('rollback').catch(()=>{});return fail(res,400,e.message||'Unable to cancel order.');}finally{client.release();}});
app.post('/api/orders/:id/return-request',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=safeText(req.params.id,120);const reason=safeText(req.body?.reason,200);const note=safeText(req.body?.note,1000);const r=await pool.query(`select id,status,created_at,customer_email from orders where id=$1 and user_id=$2`,[id,req.session.uid]);if(!r.rowCount)return fail(res,404,'Order not found.');const o=r.rows[0];if(o.status!=='delivered')return fail(res,400,'Returns can be requested after delivery.');const delivered=await pool.query(`select created_at from order_status_history where order_id=$1 and to_status='delivered' order by created_at desc limit 1`,[id]);const deliveredAt=delivered.rows[0]?.created_at||o.created_at;if(Date.now()-new Date(deliveredAt).getTime()>ORDER_RETURN_WINDOW_DAYS*86400000)return fail(res,400,'The return window has expired.');if(!reason)return fail(res,400,'Return reason is required.');try{const rr=await pool.query(`insert into returns_requests(id,order_id,user_id,reason,note) values($1,$2,$3,$4,$5) returning *`,[newId(),id,req.session.uid,reason,note]);await audit(req.session.uid,'return_request_create','order',id,{reason});await queueMail(o.customer_email,`NovaCart return request ${id}`,`<p>We received your return request for <b>${id}</b>.</p>`,`Return request received for order ${id}.`);return res.status(201).json({ok:true,request:rr.rows[0]});}catch{return fail(res,409,'A return request is already active for this order.');}});
app.get('/api/returns',auth,async(req,res)=>{const{rows}=await pool.query(`select * from returns_requests where user_id=$1 order by created_at desc`,[req.session.uid]);return ok(res,{returns:rows});});

app.get('/api/wishlist',auth,async(req,res)=>{const {rows}=await pool.query(`select p.* from wishlists w join products p on p.id=w.product_id where w.user_id=$1 and p.active=true order by w.created_at desc`,[req.session.uid]);return ok(res,{products:rows.map(p=>({...p,price:Number(p.price),oldPrice:p.old_price==null?undefined:Number(p.old_price),rating:Number(p.rating)}))});});
app.put('/api/wishlist/:id',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=safeText(req.params.id,100);const product=await pool.query('select id from products where id=$1 and active=true',[id]);if(!product.rowCount)return fail(res,404,'Product not found.');await pool.query('insert into wishlists(user_id,product_id) values($1,$2) on conflict do nothing',[req.session.uid,id]);return ok(res,{ok:true});});
app.delete('/api/wishlist/:id',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');await pool.query('delete from wishlists where user_id=$1 and product_id=$2',[req.session.uid,safeText(req.params.id,100)]);return ok(res,{ok:true});});

app.post('/api/newsletter',checkoutLimiter,async(req,res)=>{const email=normalizeEmail(req.body?.email);if(!emailOk(email))return fail(res,400,'Enter a valid email.');await pool.query('insert into newsletter_subscribers(email) values($1) on conflict(email) do nothing',[email]);return ok(res,{ok:true});});

app.get('/api/search/suggestions',async(req,res)=>{const q=safeText(req.query.q,80);if(q.length<2)return ok(res,{suggestions:[]});const{rows}=await pool.query(`select title,slug,id from products where active=true and to_tsvector('simple',coalesce(title,'')||' '||coalesce(description,'')) @@ plainto_tsquery('simple',$1) order by rating desc,reviews desc limit 8`,[q]);return ok(res,{suggestions:rows});});
// Seller / marketplace helpers
async function sellerProfile(userId){const r=await pool.query('select s.* from sellers s where s.user_id=$1',[userId]);return r.rows[0]||null;}
async function sellerOnly(req,res,next){
  return auth(req,res,async()=>{
    const seller=await sellerProfile(req.session.uid);
    if(!seller||seller.status!=='approved')return fail(res,403,'Approved seller access required.');
    req.seller=seller;
    return next();
  });
}
async function notify(userId,type,title,body,link=''){if(!userId)return;await pool.query('insert into notifications(id,user_id,type,title,body,link) values($1,$2,$3,$4,$5,$6)',[newId(),userId,safeText(type,40),safeText(title,160),safeText(body,1000),safeText(link,300)]).catch(()=>{});}
async function awardLoyalty(userId,points,reason,orderIdValue=null){if(!userId||!Number.isInteger(points)||points===0)return;const c=await pool.connect();try{await c.query('begin');await c.query('insert into loyalty_ledger(user_id,points,reason,order_id) values($1,$2,$3,$4)',[userId,points,safeText(reason,200),orderIdValue]);await c.query('update users set loyalty_points=greatest(0,loyalty_points+$1) where id=$2',[points,userId]);await c.query('commit');}catch{await c.query('rollback').catch(()=>{});}finally{c.release();}}
function fraudScore({email,ip,total,itemsCount}){let score=0;if(Number(total)>1000)score+=20;if(Number(itemsCount)>20)score+=15;if(!emailOk(email))score+=30;if(String(ip||'').startsWith('127.'))score+=0;return score;}


registerPayouts({app,pool,sellerOnly,adminOnly,csrfOk,fail,ok,audit,currency:CURRENCY});

// Marketplace APIs
app.get('/api/sellers/:slug', async(req,res)=>{const slug=safeText(req.params.slug,120);const r=await pool.query(`select s.*,u.name as owner_name from sellers s join users u on u.id=s.user_id where s.slug=$1 and s.status='approved'`,[slug]);if(!r.rowCount)return fail(res,404,'Seller not found.');const products=await pool.query(`select id,slug,title,price,old_price,rating,reviews,image,stock,currency from products where seller_id=$1 and active=true order by created_at desc limit 200`,[r.rows[0].user_id]);return ok(res,{seller:r.rows[0],products:products.rows.map(p=>({...p,price:Number(p.price),oldPrice:p.old_price==null?undefined:Number(p.old_price),rating:Number(p.rating)}))});});
app.post('/api/seller/apply',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const storeName=safeText(req.body?.storeName,120);const slug=safeText(req.body?.slug,120).toLowerCase();if(storeName.length<2||!/^[-a-z0-9]{3,120}$/.test(slug))return fail(res,400,'Store name and valid slug are required.');const existing=await pool.query('select 1 from sellers where user_id=$1 or slug=$2',[req.session.uid,slug]);if(existing.rowCount)return fail(res,409,'Seller application/store already exists.');const id=newId();await pool.query(`insert into sellers(id,user_id,store_name,slug,description,business_email,business_phone,country,address,status,commission_bps) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)`,[id,req.session.uid,storeName,slug,safeText(req.body?.description,1000),safeText(req.body?.businessEmail,160),safeText(req.body?.businessPhone,40),normalizeCountry(req.body?.country),safeText(req.body?.address,300),PLATFORM_COMMISSION_BPS]);await pool.query('update users set is_seller=true where id=$1',[req.session.uid]);return res.status(201).json({ok:true,status:'pending'});});
app.get('/api/seller/me',auth,async(req,res)=>{const s=await sellerProfile(req.session.uid);if(!s)return fail(res,404,'Seller profile not found.');return ok(res,{seller:s});});
app.get('/api/seller/overview',sellerOnly,async(req,res)=>{const sid=req.seller.id;const [products,orders,payouts,rev]=await Promise.all([pool.query('select count(*)::int as count,coalesce(sum(stock),0)::int stock from products where seller_id=$1 and active=true',[req.session.uid]),pool.query(`select count(distinct so.order_id)::int count,coalesce(sum(so.subtotal) filter(where upper(trim(o.currency))=$2),0)::numeric gross,coalesce(sum(so.seller_net) filter(where upper(trim(o.currency))=$2),0)::numeric net from seller_orders so join orders o on o.id=so.order_id where so.seller_id=$1`,[sid,CURRENCY.toUpperCase()]),pool.query(`select coalesce(sum(net_amount),0)::numeric available from seller_payouts where seller_id=$1 and ledger_version=1 and status in ('available','pending') and upper(trim(currency))=$2`,[sid,CURRENCY.toUpperCase()]),pool.query(`select coalesce(avg(r.rating),0)::numeric rating,count(*)::int count from reviews r join products p on p.id=r.product_id where p.seller_id=$1 and r.status='approved'`,[req.session.uid])]);return ok(res,{currency:CURRENCY.toUpperCase(),products:products.rows[0],orders:{count:orders.rows[0].count,gross:Number(orders.rows[0].gross),net:Number(orders.rows[0].net)},payouts:{available:Number(payouts.rows[0].available)},reviews:{rating:Number(rev.rows[0].rating),count:rev.rows[0].count}});});
registerSellerProducts({app,pool,sellerOnly,csrfOk,fail,ok,currency:CURRENCY});
app.get('/api/seller/orders',sellerOnly,async(req,res)=>{
  const page=Number(req.query.page||1),limit=Number(req.query.limit||20),q=safeText(req.query.q,120),status=String(req.query.status||'all');
  if(!Number.isSafeInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100||!Number.isSafeInteger((page-1)*limit)||!['all','placed','paid','processing','packed','shipped','delivered','cancelled','refunded'].includes(status))return fail(res,400,'Invalid order filters.');
  const args=[req.seller.id],where=['so.seller_id=$1'];if(q){args.push('%'+q.toLowerCase()+'%');where.push(`(lower(so.order_id) like $${args.length} or lower(o.customer_name) like $${args.length})`);}if(status!=='all'){args.push(status);where.push(`so.status=$${args.length}`);}const clause=where.join(' and ');
  const total=(await pool.query(`select count(*)::int n from seller_orders so join orders o on o.id=so.order_id where ${clause}`,args)).rows[0].n;args.push(limit,(page-1)*limit);
  const rows=(await pool.query(`select so.*,o.customer_name,o.customer_email,o.phone as customer_phone,o.shipping_address,o.currency,o.status as order_status,o.payment_status,o.payment_method,o.paid_at,o.inventory_released,
    exists(select 1 from refunds r where r.order_id=o.id and r.status in ('pending','succeeded')) as refund_held
    from seller_orders so join orders o on o.id=so.order_id where ${clause} order by so.created_at desc,so.order_id limit $${args.length-1} offset $${args.length}`,args)).rows;
  const ids=rows.map(o=>o.order_id),items=ids.length?(await pool.query('select order_id,product_id,variant_id,title,qty,unit_price from order_items where order_id=any($1::text[]) and seller_id=$2 order by id',[ids,req.session.uid])).rows:[];
  return ok(res,{orders:rows.map(o=>({...o,subtotal:Number(o.subtotal),commission:Number(o.commission),seller_net:Number(o.seller_net),items:items.filter(i=>i.order_id===o.order_id).map(i=>({...i,unit_price:Number(i.unit_price)}))})),pagination:{page,limit,total,pages:Math.ceil(total/limit)}});
});
app.patch('/api/seller/orders/:id',sellerOnly,async(req,res)=>{
  if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');
  const id=safeText(req.params.id,120),status=safeText(req.body?.status,60).toLowerCase();
  if(!['processing','packed','shipped'].includes(status))return fail(res,400,'Invalid seller order status.');
  const reject=(message,code=409)=>Object.assign(new Error(message),{status:code});
  const client=await pool.connect();
  try{
    await client.query('begin');
    // Lock the parent before the seller allocation, as payment/refund handlers do.
    // The payment check and fulfillment write must see one consistent order state.
    const order=(await client.query(`select o.* from orders o
      where o.id=$1 and exists(select 1 from seller_orders so where so.order_id=o.id and so.seller_id=$2)
      for update of o`,[id,req.seller.id])).rows[0];
    if(!order)throw reject('Seller order not found.',404);
    const sellerOrder=(await client.query('select * from seller_orders where order_id=$1 and seller_id=$2 for update',[id,req.seller.id])).rows[0];
    if(!sellerOrder)throw reject('Seller order not found.',404);

    // Only persisted, server-confirmed payment state can authorize fulfillment.
    // COD is the explicit exception: collection happens after delivery.
    const confirmed=order.payment_status==='paid'&&Boolean(order.paid_at);
    const payable=order.payment_method==='stripe'?confirmed:
      order.payment_method==='cod'&&(order.payment_status==='cod'||confirmed);
    if(!payable)throw reject('Payment must be confirmed before processing, packing or shipping this order. Only cash-on-delivery orders may be fulfilled before collection.');
    if(order.inventory_released||!['placed','paid','processing','packed','shipped'].includes(order.status))
      throw reject('This order is closed or unavailable for seller fulfillment.');
    const held=await client.query("select 1 from refunds where order_id=$1 and status in ('pending','succeeded') limit 1",[id]);
    if(held.rowCount)throw reject('A refund is pending or recorded for this order. Resolve it before seller fulfillment.');

    const rank={placed:0,paid:0,processing:1,packed:2,shipped:3};
    if(!Object.hasOwn(rank,sellerOrder.status)||rank[status]<rank[sellerOrder.status])
      throw reject('This seller order cannot move to that fulfillment status.');
    const trackingNumber=Object.hasOwn(req.body||{},'trackingNumber')?safeText(req.body.trackingNumber,120):sellerOrder.tracking_number;
    const courier=Object.hasOwn(req.body||{},'courier')?safeText(req.body.courier,100):sellerOrder.courier;
    await client.query('update seller_orders set status=$1,tracking_number=$2,courier=$3,updated_at=now() where order_id=$4 and seller_id=$5',
      [status,trackingNumber,courier,id,req.seller.id]);
    // Store the audit record atomically: an unrecorded update must roll back.
    await client.query('insert into audit_logs(actor_user_id,action,entity_type,entity_id,details) values($1,$2,$3,$4,$5)',
      [req.session.uid,'seller_order_update','order',id,{sellerId:req.seller.id,fromStatus:sellerOrder.status,status,paymentMethod:order.payment_method,paymentStatus:order.payment_status,trackingNumber,courier}]);
    await client.query('commit');
    return ok(res,{ok:true});
  }catch(error){
    await client.query('rollback').catch(()=>{});
    if(error.status)return fail(res,error.status,error.message);
    console.error(`[${req.requestId}] Seller fulfillment update failed:`,error.message);
    return fail(res,500,'Could not update seller fulfillment. Please try again.');
  }finally{client.release();}
});

app.get('/api/seller/payouts',sellerOnly,async(req,res)=>{const{rows}=await pool.query('select * from seller_payouts where seller_id=$1 order by created_at desc limit 200',[req.seller.id]);return ok(res,{balance:await refundBalance(pool,req.seller.id,CURRENCY),payouts:rows.map(p=>({...p,grossAmount:Number(p.gross_amount),commissionAmount:Number(p.commission_amount),refundAmount:Number(p.refund_amount),netAmount:Number(p.net_amount)}))});});

app.get('/api/recommendations',async(req,res)=>{const uid=req.session?.uid||null;let rows=[];if(uid){const r=await pool.query(`select p.*,count(*) as score from browsing_events b join products p on p.id=b.product_id where b.user_id=$1 and b.event_type in ('view','wishlist','cart','purchase') and p.active=true group by p.id order by score desc,p.rating desc,p.reviews desc limit 12`,[uid]);rows=r.rows;}if(!rows.length){const r=await pool.query(`select p.* from products p where p.active=true order by p.rating desc,p.reviews desc limit 12`);rows=r.rows;}return ok(res,{products:rows.map(p=>({...p,price:Number(p.price),oldPrice:p.old_price==null?undefined:Number(p.old_price),rating:Number(p.rating)}))});});
app.post('/api/events',async(req,res)=>{const uid=req.session?.uid||null;const productId=req.body?.productId?safeText(req.body.productId,100):null;const type=['view','search','wishlist','cart','purchase'].includes(req.body?.eventType)?req.body.eventType:null;if(type){await pool.query('insert into browsing_events(user_id,product_id,event_type,metadata) values($1,$2,$3,$4)',[uid,productId,type,req.body?.metadata&&typeof req.body.metadata==='object'?req.body.metadata:{}]).catch(()=>{});}return ok(res,{ok:true});});
app.get('/api/search/history',auth,async(req,res)=>{const{rows}=await pool.query('select query,max(created_at) created_at from search_history where user_id=$1 group by query order by max(created_at) desc limit 20',[req.session.uid]);return ok(res,{history:rows});});
app.post('/api/search/history',auth,async(req,res)=>{const q=safeText(req.body?.query,100);if(!q)return fail(res,400,'Search query required.');await pool.query('insert into search_history(user_id,query) values($1,$2)',[req.session.uid,q]);return ok(res,{ok:true});});
app.delete('/api/search/history',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');await pool.query('delete from search_history where user_id=$1',[req.session.uid]);return ok(res,{ok:true});});

app.get('/api/notifications',auth,async(req,res)=>{const{rows}=await pool.query('select * from notifications where user_id=$1 order by created_at desc limit 100',[req.session.uid]);return ok(res,{notifications:rows});});
app.post('/api/notifications/read-all',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');await pool.query('update notifications set read_at=now() where user_id=$1 and read_at is null',[req.session.uid]);return ok(res,{ok:true});});
app.get('/api/loyalty',auth,async(req,res)=>{const u=await pool.query('select loyalty_points from users where id=$1',[req.session.uid]);const{rows}=await pool.query('select * from loyalty_ledger where user_id=$1 order by created_at desc limit 100',[req.session.uid]);return ok(res,{points:u.rows[0]?.loyalty_points||0,ledger:rows});});

app.get('/api/wishlist/collections',auth,async(req,res)=>{const{rows}=await pool.query('select * from wishlist_collections where user_id=$1 order by created_at desc',[req.session.uid]);return ok(res,{collections:rows});});
app.post('/api/wishlist/collections',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const name=safeText(req.body?.name,80);if(name.length<1)return fail(res,400,'Collection name required.');try{const id=newId();await pool.query('insert into wishlist_collections(id,user_id,name) values($1,$2,$3)',[id,req.session.uid,name]);return res.status(201).json({ok:true,id});}catch{return fail(res,409,'Collection already exists.');}});
app.put('/api/wishlist/collections/:id/:productId',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');await pool.query('insert into wishlist_collection_items(collection_id,product_id) select $1,p.id from products p where p.id=$2 and exists(select 1 from wishlist_collections c where c.id=$1 and c.user_id=$3) on conflict do nothing',[safeText(req.params.id,100),safeText(req.params.productId,100),req.session.uid]);return ok(res,{ok:true});});

app.get('/api/products/:id/questions',async(req,res)=>{const{rows}=await pool.query(`select q.*,u.name as user_name from product_questions q left join users u on u.id=q.user_id where q.product_id=$1 and q.status<>'hidden' order by q.created_at desc limit 200`,[safeText(req.params.id,100)]);return ok(res,{questions:rows});});
app.post('/api/products/:id/questions',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const q=safeText(req.body?.question,800);if(q.length<5)return fail(res,400,'Question is too short.');const id=await pool.query('insert into product_questions(product_id,user_id,question) values($1,$2,$3) returning id',[safeText(req.params.id,100),req.session.uid,q]);return res.status(201).json({ok:true,id:id.rows[0].id});});
app.post('/api/reviews/:id/media',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=Number(req.params.id);const url=safeText(req.body?.url,800);if(!Number.isInteger(id)||!urlOk(url))return fail(res,400,'Valid review and media URL required.');const own=await pool.query('select id from reviews where id=$1 and user_id=$2',[id,req.session.uid]);if(!own.rowCount)return fail(res,404,'Review not found.');await pool.query('insert into review_media(review_id,url,media_type,alt) values($1,$2,$3,$4)',[id,url,safeText(req.body?.mediaType,20)||'image',safeText(req.body?.alt,200)]);return ok(res,{ok:true});});

app.post('/api/support/tickets',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const subject=safeText(req.body?.subject,160);const body=safeText(req.body?.body,2000);if(subject.length<3||body.length<3)return fail(res,400,'Subject and message are required.');const id=newId();await pool.query('insert into support_tickets(id,user_id,order_id,subject,priority) values($1,$2,$3,$4,$5)',[id,req.session.uid,req.body?.orderId?safeText(req.body.orderId,120):null,subject,['low','normal','high','urgent'].includes(req.body?.priority)?req.body.priority:'normal']);await pool.query('insert into support_messages(ticket_id,sender_user_id,body) values($1,$2,$3)',[id,req.session.uid,body]);return res.status(201).json({ok:true,id});});
app.get('/api/support/tickets',auth,async(req,res)=>{const{rows}=await pool.query('select * from support_tickets where user_id=$1 order by created_at desc',[req.session.uid]);return ok(res,{tickets:rows});});
app.get('/api/support/tickets/:id',auth,async(req,res)=>{const id=safeText(req.params.id,100);const t=await pool.query('select * from support_tickets where id=$1 and user_id=$2',[id,req.session.uid]);if(!t.rowCount)return fail(res,404,'Ticket not found.');const{rows}=await pool.query('select * from support_messages where ticket_id=$1 order by created_at asc',[id]);return ok(res,{ticket:t.rows[0],messages:rows});});
app.post('/api/support/tickets/:id/messages',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=safeText(req.params.id,100);const body=safeText(req.body?.body,2000);const own=await pool.query('select id from support_tickets where id=$1 and user_id=$2',[id,req.session.uid]);if(!own.rowCount)return fail(res,404,'Ticket not found.');if(body.length<1)return fail(res,400,'Message required.');await pool.query('insert into support_messages(ticket_id,sender_user_id,body) values($1,$2,$3)',[id,req.session.uid,body]);await pool.query("update support_tickets set status=case when status='resolved' then 'open' else status end,updated_at=now() where id=$1",[id]);return ok(res,{ok:true});});

// Business Launch customer commerce helpers
app.post('/api/coupons/validate',async(req,res)=>{const code=safeText(req.body?.code,40).toUpperCase();const subtotal=Math.max(0,Number(req.body?.subtotal||0));if(!code)return fail(res,400,'Coupon code is required.');if(!Number.isFinite(subtotal))return fail(res,400,'Invalid subtotal.');const r=await pool.query(`select * from coupons where code=$1 and active=true and (expires_at is null or expires_at>now()) and (max_uses is null or uses_count<max_uses)`,[code]);if(!r.rowCount)return fail(res,404,'Invalid or expired coupon.');const c=r.rows[0];if(subtotal<Number(c.minimum_subtotal||0))return fail(res,400,`Minimum subtotal for this coupon is ${Number(c.minimum_subtotal).toFixed(2)}.`);const discount=c.percent_off!=null?money(subtotal*Number(c.percent_off)/100):Math.min(subtotal,money(Number(c.fixed_off||0)));return ok(res,{code,discount:Number(discount),remainingUses:c.max_uses==null?null:Math.max(0,Number(c.max_uses)-Number(c.uses_count))});});
app.get('/api/recommendations',async(req,res)=>{const seed=safeText(req.query.productId,100);let rows=[];if(seed){const base=await pool.query('select cat,brand from products where id=$1',[seed]);const cat=base.rows[0]?.cat||'';const brand=base.rows[0]?.brand||'';rows=(await pool.query(`select id,slug,sku,cat,title,price,old_price as "oldPrice",rating,reviews,image,badge,stock,description,currency from products where active=true and id<>$1 and ($2='' or cat=$2 or brand=$3) order by rating desc,reviews desc,created_at desc limit 12`,[seed,cat,brand])).rows;}else{rows=(await pool.query(`select id,slug,sku,cat,title,price,old_price as "oldPrice",rating,reviews,image,badge,stock,description,currency from products where active=true order by rating desc,reviews desc,created_at desc limit 12`)).rows;}return ok(res,{products:rows.map(p=>({...p,price:Number(p.price),oldPrice:p.oldPrice==null?undefined:Number(p.oldPrice),rating:Number(p.rating)}))});});
app.get('/api/wishlist',auth,async(req,res)=>{const{rows}=await pool.query(`select p.* from wishlists w join products p on p.id=w.product_id where w.user_id=$1 and p.active=true order by w.created_at desc`,[req.session.uid]);return ok(res,{products:rows.map(p=>({...p,price:Number(p.price),oldPrice:p.old_price==null?undefined:Number(p.old_price),rating:Number(p.rating)}))});});
app.put('/api/wishlist/:id',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=safeText(req.params.id,100);const exists=await pool.query('select id from products where id=$1 and active=true',[id]);if(!exists.rowCount)return fail(res,404,'Product not found.');await pool.query('insert into wishlists(user_id,product_id) values($1,$2) on conflict do nothing',[req.session.uid,id]);return ok(res,{ok:true});});
app.delete('/api/wishlist/:id',auth,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');await pool.query('delete from wishlists where user_id=$1 and product_id=$2',[req.session.uid,safeText(req.params.id,100)]);return ok(res,{ok:true});});


// Admin marketplace controls
app.get('/api/admin/sellers',adminOnly,async(_req,res)=>{const{rows}=await pool.query(`select s.*,u.email,u.name owner_name,(select count(*) from products p where p.seller_id=s.user_id)::int as product_count from sellers s join users u on u.id=s.user_id order by s.created_at desc limit 1000`);return ok(res,{sellers:rows});});
app.patch('/api/admin/sellers/:id',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=safeText(req.params.id,100);const status=['pending','approved','suspended','rejected'].includes(req.body?.status)?req.body.status:null;if(!status)return fail(res,400,'Invalid seller status.');const r=await pool.query('update sellers set status=$1,updated_at=now() where id=$2 returning user_id',[status,id]);if(!r.rowCount)return fail(res,404,'Seller not found.');await pool.query('update users set seller_verified=$1,is_seller=true where id=$2',[status==='approved',r.rows[0].user_id]);await notify(r.rows[0].user_id,'seller_status','Seller application update',`Your seller application is now ${status}.`,'/seller.html');await audit(req.session.uid,'seller_status_update','seller',id,{status});return ok(res,{ok:true});});
app.get('/api/admin/fraud',adminOnly,async(_req,res)=>{const{rows}=await pool.query('select * from fraud_events order by created_at desc limit 500');return ok(res,{events:rows});});
app.get('/api/admin/support',adminOnly,async(_req,res)=>{const{rows}=await pool.query(`select t.*,u.email,u.name from support_tickets t left join users u on u.id=t.user_id order by t.created_at desc limit 500`);return ok(res,{tickets:rows});});
app.patch('/api/admin/support/:id',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const status=['open','pending','resolved','closed'].includes(req.body?.status)?req.body.status:null;if(!status)return fail(res,400,'Invalid status.');const id=safeText(req.params.id,100);const r=await pool.query('update support_tickets set status=$1,updated_at=now() where id=$2 returning user_id',[status,id]);if(!r.rowCount)return fail(res,404,'Ticket not found.');if(req.body?.message)await pool.query('insert into support_messages(ticket_id,sender_user_id,body) values($1,$2,$3)',[id,req.session.uid,safeText(req.body.message,2000)]);await notify(r.rows[0].user_id,'support','Support ticket update',`Your support ticket ${id} is now ${status}.`,'/support.html');return ok(res,{ok:true});});

// Admin APIs
const verifyAdminEmail=adminEmailOtp({pool,mailer,env,isProd});
app.get('/api/admin/auth-method',(_req,res)=>res.set('Cache-Control','no-store').json({method:ADMIN_MFA_REQUIRED?ADMIN_MFA_METHOD:'none'}));
app.post('/api/admin/login',authLimiter,async(req,res)=>{const email=normalizeEmail(req.body?.email);const password=String(req.body?.password||'');const otp=String(req.body?.otp||'');if(!emailOk(email)||!password)return fail(res,400,'Email and password are required.');const {rows}=await pool.query('select * from users where email=$1 and is_admin=true',[email]);const user=rows[0];if(!user||!(await bcrypt.compare(password,user.password_hash)))return fail(res,401,'Invalid admin credentials.');if(ADMIN_MFA_REQUIRED&&ADMIN_MFA_METHOD==='email'){if(!await verifyAdminEmail(req,res,user))return;}else if(ADMIN_MFA_REQUIRED){if(!ADMIN_MFA_SECRET)return fail(res,503,'Admin MFA is misconfigured.');if(!verifyTotp(ADMIN_MFA_SECRET,otp))return fail(res,401,'Invalid verification code.');}const csrfToken=await createSession(req,res,user.id, false, ADMIN_MFA_REQUIRED);await pool.query('update users set last_login_at=now(),updated_at=now() where id=$1',[user.id]);await audit(user.id,'admin_login','user',user.id,{requestId:req.requestId,mfa:ADMIN_MFA_REQUIRED});return ok(res,{ok:true,csrfToken,user:{id:user.id,name:user.name,email:user.email,isAdmin:true}});});
app.get('/api/admin/metrics',adminOnly,async(req,res)=>{const [rev,refunds,orders,customers,products,low,reviews]=await Promise.all([pool.query(`select coalesce(sum(total),0)::numeric as value from orders where status not in ('cancelled','payment_failed','payment_expired','refunded') and upper(trim(currency))=$1`,[CURRENCY.toUpperCase()]),pool.query(`select coalesce(sum(amount),0)::numeric as value from refunds where status='succeeded' and upper(trim(currency))=$1`,[CURRENCY.toUpperCase()]),pool.query('select count(*)::int as count from orders'),pool.query('select count(*)::int as count from users where is_admin=false'),pool.query('select count(*)::int as count from products where active=true'),pool.query('select count(*)::int as count from products where active=true and stock<=5'),pool.query("select count(*)::int as count from reviews where status='pending'")]);return ok(res,{currency:CURRENCY.toUpperCase(),revenue:Number(rev.rows[0].value),refunds:Number(refunds.rows[0].value),orders:orders.rows[0].count,customers:customers.rows[0].count,products:products.rows[0].count,lowStock:low.rows[0].count,pendingReviews:reviews.rows[0].count});});
app.get('/api/admin/orders',adminOnly,async(req,res)=>{const q=safeText(req.query.q,100).toLowerCase();const params=[];const where=[];if(q){params.push(`%${q}%`);where.push(`(lower(o.id) like $1 or lower(o.customer_email) like $1)`)}const clause=where.length?`where ${where.join(' and ')}`:'';const{rows}=await pool.query(`select o.*,count(oi.id)::int as item_count,coalesce(json_agg(json_build_object('productId',oi.product_id,'variantId',oi.variant_id,'title',oi.title,'qty',oi.qty,'unitPrice',oi.unit_price)) filter(where oi.id is not null),'[]') as items from orders o left join order_items oi on oi.order_id=o.id ${clause} group by o.id order by o.created_at desc limit 500`,params);return ok(res,{orders:rows.map(o=>({...o,total:Number(o.total),subtotal:Number(o.subtotal),discount:Number(o.discount),shipping:Number(o.shipping),tax:Number(o.tax),itemCount:o.item_count}))});});
app.get('/api/admin/orders/:id',adminOnly,async(req,res)=>{const id=safeText(req.params.id,120);const o=await getOrderById(id);if(!o)return fail(res,404,'Order not found.');const [items,hist,refunds]=await Promise.all([pool.query('select * from order_items where order_id=$1 order by id',[id]),pool.query('select h.*,u.email as changed_by_email from order_status_history h left join users u on u.id=h.changed_by where h.order_id=$1 order by h.created_at desc',[id]),pool.query('select * from refunds where order_id=$1 order by created_at desc',[id])]);return ok(res,{order:{...o,total:Number(o.total),subtotal:Number(o.subtotal),discount:Number(o.discount),shipping:Number(o.shipping),tax:Number(o.tax),items:items.rows,statusHistory:hist.rows,refunds:refunds.rows}});});

function productPayload(p){const price=Number(p.price);const old= p.oldPrice==null||p.oldPrice===''?null:Number(p.oldPrice);const cost=p.costPrice==null||p.costPrice===''?0:Number(p.costPrice);const rating=Number(p.rating||0);if(!Number.isFinite(price)||price<0||old!==null&&(!Number.isFinite(old)||old<0)||!Number.isFinite(cost)||cost<0||!Number.isFinite(rating))throw new Error('Invalid numeric product fields.');if(p.image&&!urlOk(p.image))throw new Error('Product image URL must use http(s).');return[safeText(p.id,80)||`p-${crypto.randomBytes(5).toString('hex')}`,safeText(p.slug,160)||`${safeText(p.title,120).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}-${crypto.randomBytes(3).toString('hex')}`,safeText(p.sku,80),safeText(p.cat||'Other',60),safeText(p.title,160),price,old,Math.min(5,Math.max(0,Number(p.rating||0))),toPositiveInt(p.reviews,0,100000000),safeText(p.image,2000),safeText(p.badge||'NEW',50),toPositiveInt(p.stock,0,100000000),safeText(p.description,4000),safeText(p.seoTitle||'',200),safeText(p.seoDescription||'',300),Math.max(0,cost)];}
app.get('/api/admin/products',adminOnly,async(req,res)=>{const{rows}=await pool.query(`select id,slug,sku,cat,title,price,old_price as "oldPrice",rating,reviews,image,badge,stock,description,active,created_at,updated_at from products order by created_at desc limit 1000`);return ok(res,{products:rows.map(p=>({...p,currency:CURRENCY.toUpperCase(),price:Number(p.price),oldPrice:p.oldPrice==null?undefined:Number(p.oldPrice),rating:Number(p.rating)}))});});
app.get('/api/admin/products/:id',adminOnly,async(req,res)=>{const id=safeText(req.params.id,80);const p=await pool.query('select * from products where id=$1',[id]);if(!p.rowCount)return fail(res,404,'Product not found.');const [images,variants]=await Promise.all([pool.query('select id,url,alt,sort_order as "sortOrder" from product_images where product_id=$1 order by sort_order,id',[id]),pool.query('select * from product_variants where product_id=$1 order by created_at',[id])]);return ok(res,{product:{...p.rows[0],currency:CURRENCY.toUpperCase(),price:Number(p.rows[0].price),oldPrice:p.rows[0].old_price==null?undefined:Number(p.rows[0].old_price),rating:Number(p.rows[0].rating),images:images.rows,variants:variants.rows.map(v=>({...v,price:Number(v.price),oldPrice:v.old_price==null?undefined:Number(v.old_price)}))}});});
app.post('/api/admin/products/:id/images',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const productId=safeText(req.params.id,80);const exists=await pool.query('select id from products where id=$1',[productId]);if(!exists.rowCount)return fail(res,404,'Product not found.');const url=safeText(req.body?.url,2000);const alt=safeText(req.body?.alt,300);if(!url||!urlOk(url))return fail(res,400,'A valid http(s) image URL is required.');const r=await pool.query('insert into product_images(product_id,url,alt,sort_order) values($1,$2,$3,coalesce((select max(sort_order)+1 from product_images where product_id=$1),0)) returning *',[productId,url,alt]);await audit(req.session.uid,'product_image_add','product',productId,{url});return res.status(201).json({image:r.rows[0]});});

app.delete('/api/admin/products/:id/images/:imageId',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const r=await pool.query('delete from product_images where id=$1 and product_id=$2 returning id',[safeText(req.params.imageId,30),safeText(req.params.id,80)]);if(!r.rowCount)return fail(res,404,'Image not found.');await audit(req.session.uid,'product_image_delete','product',safeText(req.params.id,80),{imageId:req.params.imageId});return ok(res,{ok:true});});
app.patch('/api/admin/products/:id/images/:imageId',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const sort=toPositiveInt(req.body?.sortOrder,0,10000);const alt=safeText(req.body?.alt,300);const r=await pool.query('update product_images set sort_order=$1,alt=$2 where id=$3 and product_id=$4 returning *',[sort,alt,safeText(req.params.imageId,30),safeText(req.params.id,80)]);if(!r.rowCount)return fail(res,404,'Image not found.');return ok(res,{image:r.rows[0]});});
app.post('/api/admin/products',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const p=req.body||{};const [id,slug,sku,cat,title,price,oldPrice,rating,reviews,image,badge,stock,description,seoTitle,seoDescription,costPrice]=productPayload(p);if(title.length<2||!Number.isFinite(price)||price<0||!image||!urlOk(image))return fail(res,400,'Title, valid price and image URL are required.');const client=await pool.connect();try{await client.query('begin');const row=await client.query(`insert into products(id,slug,sku,cat,title,price,old_price,rating,reviews,image,badge,stock,description,currency,seo_title,seo_description,cost_price,active) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true) returning *`,[id,slug,sku||null,cat,title,price,oldPrice,rating,reviews,image,badge,stock,description,CURRENCY.toUpperCase(),seoTitle,seoDescription,costPrice]);await client.query('insert into product_images(product_id,url,alt,sort_order) values($1,$2,$3,0)',[id,image,title]);await client.query('commit');await audit(req.session.uid,'product_create','product',id,{title});return res.status(201).json({product:row.rows[0]});}catch(e){await client.query('rollback').catch(()=>{});return fail(res,e.code==='23505'?409:400,e.code==='23505'?'Product SKU/ID/slug already exists.':e.message);}finally{client.release();}});
app.patch('/api/admin/products/:id',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=safeText(req.params.id,80);const p=req.body||{};const fields=[];const params=[];const map={slug:['slug',160],sku:['sku',80],cat:['cat',60],title:['title',160],price:['price',0],oldPrice:['old_price',0],rating:['rating',0],reviews:['reviews',0],image:['image',2000],badge:['badge',50],stock:['stock',0],description:['description',4000],seoTitle:['seo_title',200],seoDescription:['seo_description',300],costPrice:['cost_price',0],active:['active',0]};for(const [k,[col,max]] of Object.entries(map)){if(!(k in p))continue;let v=p[k];if(typeof v==='string')v=safeText(v,max);if(['price','oldPrice','rating','costPrice'].includes(k)){if(v==='')v=null;else v=Number(v);if(v!==null&&!Number.isFinite(v))return fail(res,400,`Invalid ${k}.`);if(v!==null&&v<0)return fail(res,400,`Invalid ${k}.`);}if(['reviews','stock'].includes(k))v=toPositiveInt(v,0);if(k==='rating')v=Math.min(5,Math.max(0,v));if(k==='active'&&typeof v!=='boolean')return fail(res,400,'active must be boolean.');if(k==='image'&&v&&!urlOk(v))return fail(res,400,'Product image URL must use http(s).');fields.push(`${col}=$${params.length+1}`);params.push(v);}if(!fields.length)return fail(res,400,'No fields to update.');const client=await pool.connect();try{await client.query('begin');params.push(id);const r=await client.query(`update products set ${fields.join(',')},updated_at=now() where id=$${params.length} returning *`,params);if(!r.rowCount){await client.query('rollback');return fail(res,404,'Product not found.');}if('image' in p){const image=safeText(p.image,2000);const first=await client.query('select id from product_images where product_id=$1 order by sort_order,id limit 1',[id]);if(first.rowCount)await client.query('update product_images set url=$1,alt=$2 where id=$3',[image,safeText(p.title||r.rows[0].title,300),first.rows[0].id]);else await client.query('insert into product_images(product_id,url,alt,sort_order) values($1,$2,$3,0)',[id,image,safeText(p.title||r.rows[0].title,300)]);}await client.query('commit');await audit(req.session.uid,'product_update','product',id,{fields:Object.keys(p)});return ok(res,{product:r.rows[0]});}catch(e){await client.query('rollback').catch(()=>{});return fail(res,e.code==='23505'?409:400,e.code==='23505'?'Product SKU/ID/slug already exists.':e.message);}finally{client.release();}});
app.delete('/api/admin/products/:id',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=safeText(req.params.id,80);const r=await pool.query('update products set active=false,updated_at=now() where id=$1 returning id',[id]);if(!r.rowCount)return fail(res,404,'Product not found.');await audit(req.session.uid,'product_archive','product',id);return ok(res,{ok:true});});
app.post('/api/admin/products/:id/variants',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const p=req.body||{};const id=safeText(p.id,100)||`v-${crypto.randomBytes(5).toString('hex')}`;const productId=safeText(req.params.id,80);const exists=await pool.query('select id from products where id=$1',[productId]);if(!exists.rowCount)return fail(res,404,'Product not found.');const sku=safeText(p.sku,100);const title=safeText(p.title,120);const price=Number(p.price);if(!sku||!title||!Number.isFinite(price)||price<0)return fail(res,400,'Variant SKU, title and valid price are required.');try{const r=await pool.query(`insert into product_variants(id,product_id,sku,title,price,old_price,stock,options,image,barcode,weight_grams,dimensions) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,[id,productId,sku,title,price,p.oldPrice==null?null:Number(p.oldPrice),toPositiveInt(p.stock),p.options&&typeof p.options==='object'?p.options:{},safeText(p.image,2000),safeText(p.barcode,80),toPositiveInt(p.weightGrams),p.dimensions&&typeof p.dimensions==='object'?p.dimensions:{}]);await audit(req.session.uid,'variant_create','product_variant',id,{productId});return res.status(201).json({variant:r.rows[0]});}catch(e){return fail(res,409,'Could not create variant.');}});
app.patch('/api/admin/products/:id/variants/:variantId',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const v=req.body||{};const sets=[];const params=[];const add=(col,val)=>{sets.push(`${col}=$${params.length+1}`);params.push(val);};for(const[k]of Object.entries(v)){if(!['sku','title','price','oldPrice','stock','options','image','barcode','weightGrams','dimensions','active'].includes(k))continue;let val=v[k],col=k==='oldPrice'?'old_price':k;if(['sku','title','barcode','image'].includes(k)){if(typeof val!=='string')return fail(res,400,`${k} must be text.`);val=safeText(val,2000);if(k==='image'&&val&&!urlOk(val))return fail(res,400,'Variant image URL must use http(s).');}else if(['price','oldPrice'].includes(k)){if(val==='')val=null;else val=Number(val);if(val!==null&&(!Number.isFinite(val)||val<0))return fail(res,400,`Invalid ${k}.`);}else if(['stock','weightGrams'].includes(k)){if(!Number.isInteger(Number(val))||Number(val)<0)return fail(res,400,`Invalid ${k}.`);val=Number(val);}else if(k==='active'){if(typeof val!=='boolean')return fail(res,400,'active must be boolean.');}else if(['options','dimensions'].includes(k)){if(!val||typeof val!=='object'||Array.isArray(val))return fail(res,400,`${k} must be an object.`);}add(col,val);}if(!sets.length)return fail(res,400,'No variant fields to update.');params.push(safeText(req.params.variantId,120),safeText(req.params.id,80));try{const r=await pool.query(`update product_variants set ${sets.join(',')},updated_at=now() where id=$${params.length-1} and product_id=$${params.length} returning *`,params);if(!r.rowCount)return fail(res,404,'Variant not found.');await audit(req.session.uid,'variant_update','product_variant',safeText(req.params.variantId,120),{fields:Object.keys(v)});return ok(res,{variant:r.rows[0]});}catch(e){return fail(res,e.code==='23505'?409:400,e.code==='23505'?'Variant SKU already exists.':'Could not update variant.');}});

app.patch('/api/admin/orders/:id',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=safeText(req.params.id,120);const status=safeText(req.body?.status,40).toLowerCase();const tracking=safeText(req.body?.trackingNumber,120);const courier=safeText(req.body?.courier,120);const note=safeText(req.body?.note,500);if(status==='refunded')return fail(res,400,'Use the refund action to refund a payment.');const client=await pool.connect();try{await client.query('begin');const current=await client.query('select * from orders where id=$1 for update',[id]);if(!current.rowCount){await client.query('rollback');return fail(res,404,'Order not found.');}const old=current.rows[0].status;if(status==='cancelled'&&['paid','processing','packed','shipped','delivered'].includes(old)&&current.rows[0].payment_status==='paid'){await client.query('rollback');return fail(res,409,'Paid orders must be refunded before cancellation.');}await transitionOrder(client,id,status,req.session.uid,note);if(tracking||courier)await client.query('update orders set tracking_number=$1,courier=$2,updated_at=now() where id=$3',[tracking,courier,id]);if(status==='cancelled'){await releaseInventory(client,id,req.session.uid);if(current.rows[0].payment_status==='cod')await releaseCoupon(client,id,true);else await releaseCoupon(client,id);}await client.query('commit');const o=await getOrderById(id);await audit(req.session.uid,'order_status_update','order',id,{from:old,to:status,tracking,courier});await queueMail(o.customer_email,`NovaCart order ${id} updated`,`<p>Your order status is now <b>${escapeHtml(status)}</b>.</p>${tracking?`<p>Tracking: <b>${escapeHtml(tracking)}</b>${courier?` via ${escapeHtml(courier)}`:''}.</p>`:''}`,`Order ${id} status: ${status}.`);return ok(res,{ok:true,order:o});}catch(e){await client.query('rollback').catch(()=>{});return fail(res,400,e.message||'Could not update order.');}finally{client.release();}});
app.get('/api/admin/orders/:id/refunds',adminOnly,async(req,res)=>{const id=safeText(req.params.id,120);const{rows}=await pool.query('select * from refunds where order_id=$1 order by created_at desc',[id]);return ok(res,{refunds:rows});});

app.get('/api/admin/customers',adminOnly,async(req,res)=>{const{rows}=await pool.query(`select u.id,u.name,u.email,u.phone,u.email_verified,u.created_at,u.last_login_at,count(o.id)::int as orders,coalesce(sum(case when o.status not in ('cancelled','payment_failed','payment_expired','refunded') and upper(trim(o.currency))=$1 then o.total else 0 end),0)::numeric as lifetime_value from users u left join orders o on o.user_id=u.id where u.is_admin=false group by u.id order by u.created_at desc limit 1000`,[CURRENCY.toUpperCase()]);return ok(res,{customers:rows.map(c=>({...c,currency:CURRENCY.toUpperCase(),lifetimeValue:Number(c.lifetime_value)}))});});
app.get('/api/admin/reviews',adminOnly,async(req,res)=>{const{rows}=await pool.query(`select r.*,p.title as product_title,u.email from reviews r join products p on p.id=r.product_id join users u on u.id=r.user_id order by case when r.status='pending' then 0 else 1 end,r.created_at desc limit 500`);return ok(res,{reviews:rows});});
app.patch('/api/admin/reviews/:id',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const status=['pending','approved','rejected'].includes(req.body?.status)?req.body.status:null;if(!status)return fail(res,400,'Invalid review status.');const client=await pool.connect();try{await client.query('begin');const r=await client.query('update reviews set status=$1,updated_at=now() where id=$2 returning *',[status,Number(req.params.id)]);if(!r.rowCount){await client.query('rollback');return fail(res,404,'Review not found.');}const productId=r.rows[0].product_id;const agg=await client.query(`select coalesce(round(avg(rating)::numeric,2),0) as rating,count(*)::int as count from reviews where product_id=$1 and status='approved'`,[productId]);await client.query('update products set rating=$1,reviews=$2,updated_at=now() where id=$3',[Number(agg.rows[0].rating),agg.rows[0].count,productId]);await client.query('commit');await audit(req.session.uid,'review_moderation','review',String(req.params.id),{status,productId});return ok(res,{ok:true});}catch(e){await client.query('rollback').catch(()=>{});return fail(res,400,'Could not moderate review.');}finally{client.release();}});
app.get('/api/admin/inventory',adminOnly,async(req,res)=>{const{rows}=await pool.query(`select id,title,sku,stock,price,active from products order by stock asc, title asc`);return ok(res,{products:rows.map(x=>({...x,price:Number(x.price)}))});});
app.post('/api/admin/inventory/:id/adjust',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const change=Number(req.body?.changeQty);const reason=safeText(req.body?.reason||'manual_adjustment',120);if(!Number.isInteger(change)||change===0)return fail(res,400,'changeQty must be a non-zero integer.');const client=await pool.connect();try{await client.query('begin');const r=await client.query('update products set stock=stock+$1,updated_at=now() where id=$2 and stock+$1>=0 returning *',[change,safeText(req.params.id,80)]);if(!r.rowCount){await client.query('rollback');return fail(res,400,'Product not found or stock cannot go below zero.');}await client.query('insert into inventory_movements(product_id,change_qty,reason,created_by) values($1,$2,$3,$4)',[r.rows[0].id,change,reason,req.session.uid]);await client.query('commit');await audit(req.session.uid,'inventory_adjust','product',r.rows[0].id,{change,reason});return ok(res,{ok:true,stock:r.rows[0].stock});}catch(e){await client.query('rollback').catch(()=>{});return fail(res,400,'Could not adjust inventory.');}finally{client.release();}});

app.get('/api/admin/returns',adminOnly,async(_req,res)=>{const{rows}=await pool.query(`select rr.*,o.customer_email,o.total,o.currency from returns_requests rr join orders o on o.id=rr.order_id order by rr.created_at desc limit 1000`);return ok(res,{returns:rows});});
app.patch('/api/admin/returns/:id',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const status=['requested','approved','rejected','received','refunded'].includes(req.body?.status)?req.body.status:null;if(!status)return fail(res,400,'Invalid return status.');const id=safeText(req.params.id,100);const rr=await pool.query(`select rr.*,o.payment_status from returns_requests rr join orders o on o.id=rr.order_id where rr.id=$1`,[id]);if(!rr.rowCount)return fail(res,404,'Return request not found.');if(status==='refunded'&&rr.rows[0].payment_status!=='refunded')return fail(res,409,'Refund the order payment before marking the return refunded.');await pool.query(`update returns_requests set status=$1,updated_at=now() where id=$2`,[status,id]);await audit(req.session.uid,'return_status_update','return',id,{status});return ok(res,{ok:true});});
app.post('/api/admin/orders/:id/shipment-events',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const id=safeText(req.params.id,120);const status=safeText(req.body?.status,60).toLowerCase();const allowed=['label_created','in_transit','out_for_delivery','delivered','exception'];if(!allowed.includes(status))return fail(res,400,'Invalid shipment status.');const exists=await pool.query('select id from orders where id=$1',[id]);if(!exists.rowCount)return fail(res,404,'Order not found.');const r=await pool.query(`insert into shipment_events(order_id,status,location,note,occurred_at) values($1,$2,$3,$4,coalesce($5,now())) returning *`,[id,status,safeText(req.body?.location,120),safeText(req.body?.note,500),req.body?.occurredAt||null]);await audit(req.session.uid,'shipment_event_add','order',id,{status});return res.status(201).json({event:r.rows[0]});});
app.get('/api/admin/analytics',adminOnly,async(req,res)=>{const days=Math.max(1,Math.min(365,Number(req.query.days||30)));const params=[days,CURRENCY.toUpperCase()];const daily=await pool.query(`select date_trunc('day',created_at)::date as day, count(*)::int orders, coalesce(sum(total) filter(where status not in ('cancelled','payment_failed','payment_expired','refunded')),0)::numeric revenue from orders where upper(trim(currency))=$2 and created_at>=now()-make_interval(days=>$1) group by 1 order by 1`,params);const cats=await pool.query(`select p.cat,count(*)::int units,coalesce(sum(oi.unit_price*oi.qty),0)::numeric sales,coalesce(sum((oi.unit_price-p.cost_price)*oi.qty),0)::numeric gross_margin from order_items oi join orders o on o.id=oi.order_id join products p on p.id=oi.product_id where o.status not in ('cancelled','payment_failed','payment_expired','refunded') and upper(trim(o.currency))=$2 and o.created_at>=now()-make_interval(days=>$1) group by p.cat order by sales desc`,params);const summary=await pool.query(`select count(*)::int orders,coalesce(sum(total) filter(where status not in ('cancelled','payment_failed','payment_expired','refunded')),0)::numeric revenue,coalesce(avg(total) filter(where status not in ('cancelled','payment_failed','payment_expired','refunded')),0)::numeric aov from orders where upper(trim(currency))=$2 and created_at>=now()-make_interval(days=>$1)`,params);return ok(res,{days,currency:CURRENCY.toUpperCase(),daily:daily.rows.map(x=>({...x,revenue:Number(x.revenue)})),categories:cats.rows.map(x=>({...x,sales:Number(x.sales),grossMargin:Number(x.gross_margin)})),summary:{orders:summary.rows[0].orders,revenue:Number(summary.rows[0].revenue),aov:Number(summary.rows[0].aov)}});});
app.get('/api/metrics',async(req,res)=>{if(!METRICS_TOKEN||req.get('authorization')!==`Bearer ${METRICS_TOKEN}`)return fail(res,401,'Metrics authorization required.');const m=await pool.query(`select (select count(*) from users)::bigint users,(select count(*) from orders where created_at>=now()-interval '24 hours')::bigint orders_24h,(select coalesce(sum(total),0) from orders where created_at>=now()-interval '24 hours' and status not in ('cancelled','payment_failed','payment_expired','refunded'))::numeric revenue_24h`);res.type('text/plain').send(`# HELP novacart_users Total users\n# TYPE novacart_users gauge\nnovacart_users ${m.rows[0].users}\n# HELP novacart_orders_24h Orders in last 24 hours\n# TYPE novacart_orders_24h gauge\nnovacart_orders_24h ${m.rows[0].orders_24h}\n# HELP novacart_revenue_24h Revenue in last 24 hours\n# TYPE novacart_revenue_24h gauge\nnovacart_revenue_24h ${Number(m.rows[0].revenue_24h)}\n`);});
app.get('/api/admin/audit-logs',adminOnly,async(_req,res)=>{const{rows}=await pool.query(`select a.*,u.email from audit_logs a left join users u on u.id=a.actor_user_id order by a.created_at desc limit 500`);return ok(res,{logs:rows});});


app.get('/api/admin/support-tickets',adminOnly,async(_req,res)=>{const{rows}=await pool.query(`select t.*,u.email,u.name,coalesce(m.last_message,'') as last_message from support_tickets t left join users u on u.id=t.user_id left join lateral (select body as last_message from support_messages sm where sm.ticket_id=t.id order by created_at desc limit 1) m on true order by case when t.status='open' then 0 when t.status='pending' then 1 else 2 end,t.updated_at desc limit 1000`);return ok(res,{tickets:rows});});
app.patch('/api/admin/support-tickets/:id',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const status=['open','pending','resolved','closed'].includes(req.body?.status)?req.body.status:null;if(!status)return fail(res,400,'Invalid ticket status.');const id=safeText(req.params.id,100);const r=await pool.query('update support_tickets set status=$1,updated_at=now() where id=$2 returning id,user_id',[status,id]);if(!r.rowCount)return fail(res,404,'Support ticket not found.');if(req.body?.message&&r.rows[0].user_id)await pool.query('insert into support_messages(ticket_id,sender_user_id,body) values($1,$2,$3)',[id,req.session.uid,safeText(req.body.message,2000)]);await audit(req.session.uid,'support_ticket_update','support_ticket',id,{status});return ok(res,{ok:true});});
app.get('/api/admin/fraud-events',adminOnly,async(_req,res)=>{const{rows}=await pool.query(`select f.*,u.email from fraud_events f left join users u on u.id=f.user_id order by f.created_at desc limit 500`);return ok(res,{events:rows});});
app.get('/api/admin/questions',adminOnly,async(req,res)=>{const{rows}=await pool.query(`select q.*,p.title product_title,u.email user_email from product_questions q join products p on p.id=q.product_id left join users u on u.id=q.user_id order by case when q.status='open' then 0 else 1 end,q.created_at desc limit 500`);return ok(res,{questions:rows});});
app.patch('/api/admin/questions/:id',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const answer=safeText(req.body?.answer,1500);const status=answer?'answered':'hidden';const r=await pool.query(`update product_questions set answer=$1,status=$2,answered_by=$3,answered_at=case when $2='answered' then now() else null end where id=$4 returning id,user_id,product_id`,[answer,status,req.session.uid,Number(req.params.id)]);if(!r.rowCount)return fail(res,404,'Question not found.');if(r.rows[0].user_id&&answer)await notify(r.rows[0].user_id,'question_answer','Your product question was answered','Your product question has a new answer on NovaCart.','/');await audit(req.session.uid,'question_moderation','question',String(req.params.id),{status});return ok(res,{ok:true});});
app.get('/api/admin/payouts',adminOnly,async(req,res)=>{const{rows}=await pool.query(`select p.*,s.store_name from seller_payouts p join sellers s on s.id=p.seller_id order by p.created_at desc limit 500`);return ok(res,{payouts:rows});});

app.get('/api/admin/coupons',adminOnly,async(req,res)=>{const{rows}=await pool.query('select code,percent_off,fixed_off,active,expires_at,max_uses,uses_count,minimum_subtotal,created_at from coupons order by created_at desc');return ok(res,{coupons:rows});});
app.post('/api/admin/coupons',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const code=safeText(req.body?.code,40).toUpperCase();const percent=req.body?.percentOff===''||req.body?.percentOff==null?null:Number(req.body.percentOff);const fixed=req.body?.fixedOff===''||req.body?.fixedOff==null?null:Number(req.body.fixedOff);if(!/^[A-Z0-9_-]{3,40}$/.test(code))return fail(res,400,'Coupon code must be 3–40 letters/numbers.');if((percent==null)===(fixed==null))return fail(res,400,'Provide either percentOff or fixedOff.');if(percent!=null&&(!Number.isFinite(percent)||percent<=0||percent>100))return fail(res,400,'Percent discount must be between 0 and 100.');if(fixed!=null&&(!Number.isFinite(fixed)||fixed<=0))return fail(res,400,'Fixed discount must be positive.');try{await pool.query('insert into coupons(code,percent_off,fixed_off,active,expires_at,max_uses,minimum_subtotal,updated_at) values($1,$2,$3,true,$4,$5,$6,now())',[code,percent,fixed,req.body.expiresAt||null,req.body.maxUses?toPositiveInt(req.body.maxUses,0):null,Math.max(0,Number(req.body.minimumSubtotal||0))]);await audit(req.session.uid,'coupon_create','coupon',code);return res.status(201).json({ok:true});}catch(e){return fail(res,409,'Coupon already exists or is invalid.');}});
app.patch('/api/admin/coupons/:code',adminOnly,async(req,res)=>{if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const code=safeText(req.params.code,40).toUpperCase();const active=req.body?.active;const maxUses=req.body?.maxUses==null?null:toPositiveInt(req.body.maxUses,0);const r=await pool.query('update coupons set active=coalesce($1,active),max_uses=coalesce($2,max_uses),updated_at=now() where code=$3 returning code',[typeof active==='boolean'?active:null,maxUses,code]);if(!r.rowCount)return fail(res,404,'Coupon not found.');await audit(req.session.uid,'coupon_update','coupon',code,{active,maxUses});return ok(res,{ok:true});});

// One styled, server-rendered product page for visitors and crawlers alike.
app.get('/product.html',async(req,res,next)=>{
 if(!req.query.id){res.set('X-Robots-Tag','noindex');return next();}
 const product=await publicProduct(pool,req.query.id,{currency:CURRENCY,returnsDays:RETURNS_DAYS});
 if(!product)return res.status(404).set('X-Robots-Tag','noindex').type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/forma-ui.css"><title>Product not found</title></head><body><main class="not-found"><h1>Product not found</h1><a href="/">Back to shop</a></main></body></html>');
 return res.redirect(301,productPath(product));
});
app.get('/p/:slug',async(req,res)=>{
 const product=await publicProduct(pool,req.params.slug,{currency:CURRENCY,returnsDays:RETURNS_DAYS},'slug');
 if(!product)return res.status(404).set('X-Robots-Tag','noindex').type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/forma-ui.css"><title>Product not found</title></head><body><main class="not-found"><h1>Product not found</h1><a href="/">Back to shop</a></main></body></html>');
 const [reviews,related]=await Promise.all([
  pool.query(`select r.rating,r.title,r.body,u.name from reviews r join users u on u.id=r.user_id where r.product_id=$1 and r.status='approved' order by r.created_at desc limit 100`,[product.id]),
  pool.query('select id,slug,title,cat,price,image,rating,reviews from products where active=true and id<>$1 order by (cat=$2) desc,created_at desc,id limit 4',[product.id,product.cat])
 ]);
 res.set('Cache-Control','no-cache').type('html').send(renderProductPage(product,{base:BASE,businessName:BUSINESS_NAME,reviews:reviews.rows,related:related.rows}));
});
// Dynamic robots + sitemap. Sensitive/account areas are explicitly excluded.
app.get('/robots.txt',(_req,res)=>res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /account.html\nDisallow: /orders.html\nDisallow: /reset-password.html\nDisallow: /verify-email.html\nDisallow: /reset-password.html?*\nDisallow: /api/\n`));
app.get('/sitemap.xml',async(_req,res)=>{try{const{rows}=await pool.query("select coalesce(nullif(slug,''),id) as key from products where active=true order by created_at desc");const urls=[`${BASE}/`,`${BASE}/login.html`,...rows.map(r=>`${BASE}/p/${encodeURIComponent(r.key)}`)];return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${u.replace(/&/g,'&amp;')}</loc></url>`).join('')}</urlset>`);}catch{return res.type('application/xml').send(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${BASE}/</loc></url></urlset>`);}});



app.get('/api/admin/launch-readiness',adminOnly,async(req,res)=>{
  res.set('Cache-Control','no-store');
  const report=configurationReport(env);
  try{report.database=await databaseReport(pool);}catch{report.database={connected:false,schemaCurrent:false};}
  return ok(res,report);
});

registerRefunds({app,pool,stripe,adminOnly,csrfOk,fail,ok,audit,queueMail,transitionOrder});
const supplierOperations=registerSuppliers({app,pool,env,adminOnly,csrfOk,audit,fetcher:deps.providerFetch||fetch});
registerOAuth({app,pool,env,BASE,auth,authLimiter,csrfOk,getSession,createSession,audit,fetcher:deps.providerFetch||fetch});
registerVisualSearch({app,pool,env,getSession,csrfOk,fetcher:deps.providerFetch||fetch});

const staticFiles = new Set(["orders.js","forma-ui.css","assets/forma-campaign.png","launch.html","launch.js","oauth-ui.js","visual-search.js","integrations.html","integrations.js","integrations.css","assets/hero-living.jpg", "assets/instrument-serif-400-normal.ttf", "assets/category-lifestyle.jpg", "assets/dm-sans-500-normal.ttf", "assets/collection-home.jpg", "assets/dm-sans-400-normal.ttf", "assets/dm-sans-700-normal.ttf", "assets/dm-sans-600-normal.ttf", "assets/category-tech.jpg", "assets/instrument-serif-400-italic.ttf", "assets/category-home.jpg", "assets/LICENSE-dmsans.txt", "assets/category-beauty.jpg", "assets/collection-tech.jpg", "assets/LICENSE-instrumentserif.txt", "assets/fonts.css", "index.html", "styles.css", "app.js", "config.js", "favicon.svg", "admin.html", "admin.js", "admin-ultra.css", "admin-ultra.js", "ultra-ui.css", "ultra-ui.js", "login.html", "auth.css", "auth.js", "account.html", "orders.html", "product.html", "product.js", "seller.html", "seller.js", "seller-catalog.js", "workspace-money.js", "reset-password.html", "verify-email.html", "shipping-returns.html", "privacy.html", "terms.html", "contact.html", "support.html", "support.js", "motion.css", "motion.js", "signature-ui.css", "signature-ui.js", "assets/image-unavailable.svg", "assets/demo-headphones.jpg", "assets/demo-bottle.jpg", "assets/demo-fragrance.jpg", "assets/demo-bag.jpg", "assets/demo-sneakers.jpg", "assets/demo-lamp.jpg"]);
app.use((req,res,next)=>{if(req.method!=='GET')return next();const file=req.path==='/'?'index.html':req.path.slice(1);if(!staticFiles.has(file))return res.status(404).json({error:'Not found'});if(['launch.html','admin.html','integrations.html','account.html','orders.html','reset-password.html','verify-email.html'].includes(file))res.set('X-Robots-Tag','noindex,nofollow,noarchive');return res.sendFile(path.join(__dirname,file));});
app.use((err,req,res,_next)=>{console.error(`[${req.requestId}]`,err.message);if(err.type==='entity.too.large')return fail(res,413,'Request is too large.');if(err.type==='entity.parse.failed')return fail(res,400,'Invalid JSON.');return res.status(500).json({error:isProd?'Internal server error.':err.message});});

let server,emailTimer,maintenanceTimer,supplierTimer;
async function start(){
  await pool.query('select 1');await ensureAdmin();if(!isProd||String(env.SEED_DEMO_PRODUCTS||'false')==='true')await seedIfEmpty();
  if(mailer){await mailer.verify();emailTimer=setInterval(()=>processEmailOutbox().catch(console.error),30000);}
  if(supplierOperations.automation.enabled){supplierTimer=setInterval(()=>supplierOperations.runSync().catch(()=>console.error('Supplier sync cycle failed')),60000);supplierOperations.runSync().catch(()=>console.error('Supplier sync cycle failed'));}
  maintenanceTimer=setInterval(()=>reconcileExpiredReservations().catch(console.error),60000);
  server=await new Promise((resolve,reject)=>{const listener=app.listen(PORT,()=>resolve(listener));listener.once('error',reject);});
  console.log(`NovaCart v21.9 running at ${BASE}`);return server;
}
async function close(){clearInterval(emailTimer);clearInterval(maintenanceTimer);clearInterval(supplierTimer);if(server)await new Promise(resolve=>server.close(resolve));mailer?.close?.();await pool.end();}
return {app,pool,stripe,start,close,runSupplierSync:supplierOperations.runSync,reconcileExpiredReservations,processEmailOutbox};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const application=createApplication();application.start().catch(e=>{console.error('Startup failed:',e.message);process.exit(1);});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>application.close().then(()=>process.exit(0)));
}
