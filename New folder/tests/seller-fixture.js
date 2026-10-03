import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createServer} from 'node:http';
import bcrypt from 'bcryptjs';
import Stripe from 'stripe';
import {database} from './database.js';
import {createApplication} from '../server.js';

// Local-only accounts and provider fixtures; never uses an external database or Stripe API.
export async function sellerFixture(options = {}) {
  const pool = await database();
  const accounts = {};
  const password = 'SellerFixture123!';
  const hash = await bcrypt.hash(password, 4);
  for (const [name, status] of Object.entries({alpha:'approved', beta:'approved', pending:'pending', suspended:'suspended', rejected:'rejected', buyer:null, orphan:null})) {
    const account = accounts[name] = {id:crypto.randomUUID(), email:`${name}@local.test`, status};
    await pool.query('insert into users(id,name,email,password_hash,email_verified,is_seller) values($1,$2,$3,$4,true,$5)', [account.id, name, account.email, hash, Boolean(status)]);
    if (status) {
      account.sellerId = crypto.randomUUID();
      await pool.query('insert into sellers(id,user_id,store_name,slug,status) values($1,$2,$3,$4,$5)', [account.sellerId, account.id, `${name} Store`, name, status]);
    }
  }
  for (const [id, owner, price] of [['alpha-product','alpha',25], ['beta-product','beta',40], ['pending-product','pending',10], ['suspended-product','suspended',10], ['orphan-product','orphan',10], ['platform-product',null,15]]) {
    await pool.query('insert into products(id,slug,title,cat,price,image,stock,seller_id) values($1,$1,$1,$2,$3,$4,30,$5)', [id, 'Tech', price, 'https://example.test/product.jpg', owner ? accounts[owner].id : null]);
  }
  await pool.query("insert into product_variants(id,product_id,sku,title,price,stock) values('alpha-variant','alpha-product','ALPHA-BLUE','Blue',30,20)");
  const secret = 'whsec_seller_regression_fixture';
  const stripe = new Stripe('sk_test_local_fixture_only');
  const sessions = new Map();
  stripe.checkout.sessions.create = async payload => {
    const id = `cs_fixture_${crypto.randomUUID()}`;
    const session = {...payload, id, currency:'usd', payment_status:'unpaid', status:'open', payment_intent:`pi_${id}`, amount_total:payload.line_items.reduce((n,x) => n+x.price_data.unit_amount*x.quantity,0), url:'https://checkout.stripe.com/local-fixture'};
    sessions.set(id,session);
    return session;
  };
  stripe.checkout.sessions.retrieve = async id => sessions.get(id);
  const server = createServer().listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const application = createApplication({pool, stripe, mailer:options.mailer, providerFetch:options.providerFetch, env:{NODE_ENV:'development', PUBLIC_BASE_URL:base, STRIPE_WEBHOOK_SECRET:secret,...options.env}});
  server.on('request',application.app);
  async function api(path, {method='GET', body, account, cookie=account?.cookie, csrf=account?.csrf, headers={}}={}) {
    const response = await fetch(base+path, {signal:AbortSignal.timeout(15000), method, headers:{...(body?{'content-type':'application/json'}:{}), ...(cookie?{cookie}:{}), ...(csrf?{'x-csrf-token':csrf}:{}), ...headers}, body:body?JSON.stringify(body):undefined});
    return {status:response.status, data:await response.json().catch(()=>({})), cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  for (const account of Object.values(accounts)) {
    const result = await api('/api/auth/login', {method:'POST', body:{email:account.email,password}});
    assert.equal(result.status,200);
    account.cookie = result.cookie;
    account.csrf = result.data.csrfToken;
  }
  async function checkout(items, paymentMethod='cod', key=crypto.randomUUID()) {
    return api('/api/checkout', {method:'POST', account:accounts.buyer, headers:{'idempotency-key':key}, body:{items,paymentMethod,email:accounts.buyer.email,phone:'+94770000000',shippingAddress:{fullName:'Test Buyer',line1:'10 Test Road',city:'Colombo',postalCode:'00100',country:'LK'}}});
  }
  async function pay(orderId) {
    const order = (await pool.query('select * from orders where id=$1',[orderId])).rows[0];
    const session = sessions.get(order.payment_session_id);
    const payload = JSON.stringify({id:`evt_${crypto.randomUUID()}`,type:'checkout.session.completed',data:{object:{...session,payment_status:'paid',status:'complete'}}});
    return fetch(base+'/api/stripe/webhook', {method:'POST',headers:{'content-type':'application/json','stripe-signature':Stripe.webhooks.generateTestHeaderString({payload,secret})},body:payload});
  }
  return {pool,stripe,application,secret,accounts,password,api,checkout,pay,base,async close(){await new Promise(resolve=>server.close(resolve));await pool.end();}};
}
