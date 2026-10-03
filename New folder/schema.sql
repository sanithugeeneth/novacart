create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  phone text not null default '',
  email_verified boolean not null default false,
  is_admin boolean not null default false,
  marketing_opt_in boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key,
  user_id uuid references users(id) on delete cascade,
  token_hash text not null unique,
  csrf_token text not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  user_agent_hash text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists sessions_token_idx on sessions(token_hash);
create index if not exists sessions_user_idx on sessions(user_id, expires_at desc);

create table if not exists addresses (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  label text not null default 'Address',
  full_name text not null,
  line1 text not null,
  line2 text not null default '',
  city text not null,
  state text not null default '',
  postal_code text not null,
  country text not null,
  phone text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists addresses_user_idx on addresses(user_id, is_default desc, created_at desc);
create unique index if not exists addresses_one_default_per_user_idx on addresses(user_id) where is_default;

create table if not exists products (
  id text primary key,
  slug text unique,
  sku text,
  cat text not null,
  title text not null,
  price numeric(12,2) not null check (price >= 0),
  old_price numeric(12,2),
  rating numeric(3,2) not null default 5 check (rating between 0 and 5),
  reviews integer not null default 0 check (reviews >= 0),
  image text not null,
  badge text not null default 'NEW',
  stock integer not null default 0 check (stock >= 0),
  description text not null default '',
  currency char(3) not null default 'USD',
  seo_title text not null default '',
  seo_description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_active_idx on products(active, created_at desc);
create index if not exists products_cat_idx on products(cat, active);
create index if not exists products_title_search_idx on products using gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'')));

create table if not exists product_images (
  id bigserial primary key,
  product_id text not null references products(id) on delete cascade,
  url text not null,
  alt text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists product_images_product_idx on product_images(product_id, sort_order, id);

create table if not exists product_variants (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  sku text not null unique,
  title text not null,
  price numeric(12,2) not null check (price >= 0),
  old_price numeric(12,2),
  stock integer not null default 0 check (stock >= 0),
  options jsonb not null default '{}'::jsonb,
  image text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_variants_product_idx on product_variants(product_id, active);

create table if not exists inventory_movements (
  id bigserial primary key,
  product_id text not null references products(id) on delete cascade,
  variant_id text references product_variants(id) on delete set null,
  change_qty integer not null,
  reason text not null,
  order_id text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_product_idx on inventory_movements(product_id, created_at desc);

create table if not exists orders (
  id text primary key,
  user_id uuid references users(id) on delete set null,
  customer_email text not null,
  customer_name text not null,
  phone text not null default '',
  status text not null,
  payment_status text not null default 'unpaid',
  payment_method text not null,
  payment_session_id text,
  payment_intent_id text,
  tracking_number text not null default '',
  courier text not null default '',
  currency char(3) not null default 'USD',
  subtotal numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  shipping numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  delivery text not null default 'standard',
  shipping_address jsonb not null,
  idempotency_key text,
  inventory_released boolean not null default false,
  paid_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  payment_failure_code text not null default '',
  payment_failure_message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists orders_idempotency_idx on orders(idempotency_key) where idempotency_key is not null;
create index if not exists orders_user_idx on orders(user_id, created_at desc);
create index if not exists orders_email_idx on orders(customer_email, created_at desc);
create index if not exists orders_payment_session_idx on orders(payment_session_id);
create index if not exists orders_payment_intent_idx on orders(payment_intent_id);

create table if not exists order_items (
  id bigserial primary key,
  order_id text not null references orders(id) on delete cascade,
  product_id text not null references products(id),
  variant_id text references product_variants(id) on delete set null,
  title text not null,
  image text not null,
  qty integer not null check (qty > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  options jsonb not null default '{}'::jsonb
);
create index if not exists order_items_order_idx on order_items(order_id);

create table if not exists order_status_history (
  id bigserial primary key,
  order_id text not null references orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text not null default '',
  changed_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists order_status_history_order_idx on order_status_history(order_id, created_at desc);

create table if not exists refunds (
  id uuid primary key,
  order_id text not null references orders(id) on delete cascade,
  stripe_refund_id text unique,
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null,
  status text not null,
  reason text not null default '',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists refunds_order_idx on refunds(order_id, created_at desc);

create table if not exists coupons (
  code text primary key,
  percent_off numeric(5,2),
  fixed_off numeric(12,2),
  active boolean not null default true,
  expires_at timestamptz,
  max_uses integer,
  uses_count integer not null default 0,
  minimum_subtotal numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  check ((percent_off is not null and fixed_off is null) or (percent_off is null and fixed_off is not null) or (percent_off is null and fixed_off is null))
);

alter table coupons add column if not exists updated_at timestamptz not null default now();

create table if not exists newsletter_subscribers (
  id bigserial primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists email_verifications (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists email_verifications_user_idx on email_verifications(user_id, expires_at desc);

create table if not exists password_resets (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz,
  error text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists reviews (
  id bigserial primary key,
  product_id text not null references products(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  order_id text not null references orders(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  title text not null default '',
  body text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, user_id, order_id)
);
create index if not exists reviews_product_idx on reviews(product_id, status, created_at desc);

create table if not exists wishlists (
  user_id uuid not null references users(id) on delete cascade,
  product_id text not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, product_id)
);

create table if not exists audit_logs (
  id bigserial primary key,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null default '',
  entity_id text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on audit_logs(created_at desc);
create index if not exists audit_logs_actor_idx on audit_logs(actor_user_id, created_at desc);

create table if not exists email_outbox (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  html text not null,
  text_body text not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text not null default '',
  locked_at timestamptz,
  lock_token text,
  created_at timestamptz not null default now()
);
create index if not exists email_outbox_pending_idx on email_outbox(next_attempt_at) where sent_at is null;
create index if not exists email_outbox_lock_idx on email_outbox(locked_at) where sent_at is null;

-- Safe upgrades for databases created by earlier NovaCart releases.
alter table users add column if not exists marketing_opt_in boolean not null default false;
alter table users add column if not exists last_login_at timestamptz;
alter table sessions add column if not exists last_seen_at timestamptz not null default now();
alter table sessions add column if not exists revoked_at timestamptz;
alter table sessions add column if not exists user_agent_hash text not null default '';
alter table addresses add column if not exists updated_at timestamptz not null default now();
alter table products add column if not exists slug text;
alter table products add column if not exists sku text;
alter table products add column if not exists currency char(3) not null default 'USD';
alter table products add column if not exists seo_title text not null default '';
alter table products add column if not exists seo_description text not null default '';
alter table products add column if not exists active boolean not null default true;
alter table orders add column if not exists idempotency_key text;
alter table orders add column if not exists inventory_released boolean not null default false;
alter table orders add column if not exists paid_at timestamptz;
alter table orders add column if not exists cancelled_at timestamptz;
alter table orders add column if not exists refunded_at timestamptz;
alter table orders add column if not exists payment_failure_code text not null default '';
alter table orders add column if not exists payment_failure_message text not null default '';
alter table orders add column if not exists reservation_expires_at timestamptz;
create index if not exists orders_reservation_expiry_idx on orders(status, reservation_expires_at) where status='pending_payment' and reservation_expires_at is not null;
alter table order_items add column if not exists variant_id text;
alter table order_items add column if not exists options jsonb not null default '{}'::jsonb;
alter table reviews add column if not exists updated_at timestamptz not null default now();
alter table stripe_events add column if not exists processed_at timestamptz;
alter table stripe_events add column if not exists error text not null default '';
alter table email_outbox add column if not exists locked_at timestamptz;
alter table email_outbox add column if not exists lock_token text;

-- Backfill safe slugs for existing products.
update products set slug = lower(regexp_replace(regexp_replace(trim(title), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')) || '-' || id
where slug is null or slug='';

create unique index if not exists products_slug_unique_idx on products(slug);
insert into coupons(code,percent_off,active) values('NOVA10',10,true) on conflict(code) do nothing;

-- V12 production hardening additions
alter table products add column if not exists cost_price numeric(12,2) not null default 0 check (cost_price >= 0);
alter table product_variants add column if not exists barcode text not null default '';
alter table product_variants add column if not exists weight_grams integer not null default 0 check (weight_grams >= 0);
alter table product_variants add column if not exists dimensions jsonb not null default '{}'::jsonb;
alter table users add column if not exists marketing_opt_in boolean not null default false;

create table if not exists coupon_redemptions (
  id uuid primary key,
  coupon_code text not null references coupons(code) on delete cascade,
  order_id text not null unique references orders(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  status text not null check (status in ('reserved','applied','released')),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  released_at timestamptz
);
create index if not exists coupon_redemptions_coupon_idx on coupon_redemptions(coupon_code,status,created_at desc);

create table if not exists returns_requests (
  id uuid primary key,
  order_id text not null references orders(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  reason text not null,
  note text not null default '',
  status text not null check (status in ('requested','approved','rejected','received','refunded')) default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists returns_one_active_per_order_idx on returns_requests(order_id) where status in ('requested','approved','received');
create index if not exists returns_user_idx on returns_requests(user_id,created_at desc);

create table if not exists shipment_events (
  id bigserial primary key,
  order_id text not null references orders(id) on delete cascade,
  status text not null,
  location text not null default '',
  note text not null default '',
  occurred_at timestamptz not null default now()
);
create index if not exists shipment_events_order_idx on shipment_events(order_id,occurred_at desc);

create table if not exists admin_security_events (
  id bigserial primary key,
  admin_user_id uuid references users(id) on delete set null,
  event_type text not null,
  ip text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists admin_security_events_created_idx on admin_security_events(created_at desc);

create table if not exists rate_limit_events (
  id bigserial primary key,
  key_hash text not null,
  route text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_events_created_idx on rate_limit_events(created_at desc);


-- V14 mega-marketplace additions
alter table users add column if not exists is_seller boolean not null default false;
alter table users add column if not exists seller_verified boolean not null default false;
alter table users add column if not exists loyalty_points integer not null default 0;

alter table products add column if not exists seller_id uuid references users(id) on delete set null;
alter table products add column if not exists brand text not null default '';
alter table products add column if not exists search_keywords text not null default '';
alter table products add column if not exists shipping_weight_grams integer not null default 0 check (shipping_weight_grams >= 0);
alter table products add column if not exists shipping_dimensions jsonb not null default '{}'::jsonb;
create index if not exists products_seller_idx on products(seller_id, active, created_at desc);
create index if not exists products_search_document_idx on products using gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(search_keywords,'')));

alter table order_items add column if not exists seller_id uuid references users(id) on delete set null;

create table if not exists sellers (
  id uuid primary key,
  user_id uuid not null unique references users(id) on delete cascade,
  store_name text not null,
  slug text not null unique,
  description text not null default '',
  logo_url text not null default '',
  banner_url text not null default '',
  business_email text not null default '',
  business_phone text not null default '',
  country text not null default '',
  address text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','suspended','rejected')),
  rating numeric(3,2) not null default 5 check (rating between 0 and 5),
  review_count integer not null default 0,
  response_rate numeric(5,2) not null default 100 check (response_rate between 0 and 100),
  followers integer not null default 0,
  commission_bps integer not null default 1000 check (commission_bps between 0 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sellers_status_idx on sellers(status, created_at desc);

create table if not exists seller_payouts (
  id uuid primary key,
  seller_id uuid not null references sellers(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  gross_amount numeric(12,2) not null default 0,
  commission_amount numeric(12,2) not null default 0,
  refund_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  currency char(3) not null default 'USD',
  status text not null default 'pending' check (status in ('pending','available','paid','failed')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists seller_payouts_seller_idx on seller_payouts(seller_id, created_at desc);

create table if not exists seller_orders (
  order_id text not null references orders(id) on delete cascade,
  seller_id uuid not null references sellers(id) on delete cascade,
  subtotal numeric(12,2) not null default 0,
  commission numeric(12,2) not null default 0,
  seller_net numeric(12,2) not null default 0,
  status text not null default 'pending',
  tracking_number text not null default '',
  courier text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(order_id, seller_id)
);
create index if not exists seller_orders_seller_idx on seller_orders(seller_id, created_at desc);

create table if not exists product_questions (
  id bigserial primary key,
  product_id text not null references products(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  question text not null,
  answer text not null default '',
  answered_by uuid references users(id) on delete set null,
  status text not null default 'open' check (status in ('open','answered','hidden')),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists product_questions_product_idx on product_questions(product_id, status, created_at desc);

create table if not exists review_media (
  id bigserial primary key,
  review_id bigint not null references reviews(id) on delete cascade,
  url text not null,
  media_type text not null default 'image',
  alt text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists wishlist_collections (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(user_id,name)
);
create table if not exists wishlist_collection_items (
  collection_id uuid not null references wishlist_collections(id) on delete cascade,
  product_id text not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(collection_id, product_id)
);

create table if not exists browsing_events (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  product_id text references products(id) on delete cascade,
  event_type text not null check (event_type in ('view','search','wishlist','cart','purchase')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists browsing_events_user_idx on browsing_events(user_id, created_at desc);
create index if not exists browsing_events_product_idx on browsing_events(product_id, event_type, created_at desc);

create table if not exists search_history (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  query text not null,
  created_at timestamptz not null default now()
);
create index if not exists search_history_user_idx on search_history(user_id, created_at desc);

create table if not exists notifications (
  id uuid primary key,
  user_id uuid references users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  link text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications(user_id, read_at, created_at desc);

create table if not exists loyalty_ledger (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  points integer not null,
  reason text not null,
  order_id text references orders(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_ledger_user_idx on loyalty_ledger(user_id, created_at desc);

create table if not exists support_tickets (
  id uuid primary key,
  user_id uuid references users(id) on delete set null,
  order_id text references orders(id) on delete set null,
  subject text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','pending','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists support_messages (
  id bigserial primary key,
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  sender_user_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists support_tickets_user_idx on support_tickets(user_id, created_at desc);
create index if not exists support_messages_ticket_idx on support_messages(ticket_id, created_at asc);

create table if not exists fraud_events (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  order_id text references orders(id) on delete set null,
  event_type text not null,
  risk_score integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fraud_events_created_idx on fraud_events(created_at desc);

create table if not exists oauth_accounts (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('google','apple')),
  provider_user_id text not null,
  created_at timestamptz not null default now(),
  unique(provider,provider_user_id)
);

create table if not exists visual_searches (
  id uuid primary key,
  user_id uuid references users(id) on delete set null,
  image_url text not null default '',
  query_text text not null default '',
  provider text not null default 'metadata-fallback',
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- seed an internal seller profile on the first non-admin user only when useful for demos

-- v19.1: existing sessions do not count as MFA-verified.
alter table sessions add column if not exists mfa_verified boolean not null default false;

-- v19.4: immutable order allocations, including failed payouts (retry the same record).
-- Existing rows remain version 0 and require review; no historical amounts are rewritten.
alter table seller_payouts add column if not exists ledger_version integer not null default 0;
alter table seller_payouts add column if not exists transfer_reference text not null default '';
alter table orders add column if not exists payment_reference text not null default '';
create unique index if not exists seller_payout_period_v1 on seller_payouts(seller_id,period_start,period_end) where ledger_version=1;
create unique index if not exists seller_payout_identity on seller_payouts(id,seller_id);
create table if not exists seller_payout_items (
  payout_id uuid not null,
  seller_id uuid not null,
  order_id text not null,
  gross_amount numeric(12,2) not null check(gross_amount>=0),
  commission_amount numeric(12,2) not null check(commission_amount>=0 and commission_amount<=gross_amount),
  net_amount numeric(12,2) not null check(net_amount=gross_amount-commission_amount),
  primary key(seller_id,order_id),
  foreign key(payout_id,seller_id) references seller_payouts(id,seller_id),
  foreign key(order_id,seller_id) references seller_orders(order_id,seller_id)
);
create index if not exists seller_payout_items_payout on seller_payout_items(payout_id);

-- v20: one-use OAuth transactions, bound to the initiating browser.
create table if not exists oauth_states (
 state_hash text primary key, provider text not null check(provider in ('google','apple')),
 binding_hash text not null, nonce text not null, pkce_verifier text not null default '',
 link_user_id uuid references users(id) on delete cascade,
 link_session_id uuid references sessions(id) on delete cascade, expires_at timestamptz not null
);
create index if not exists oauth_states_expiry_idx on oauth_states(expires_at);
create table if not exists integration_usage (
 service text not null, day date not null, requests integer not null default 0, primary key(service,day)
);

-- v20: durable supplier SKU mappings and one submission intent per order/provider.
create table if not exists supplier_products (
 id uuid primary key,provider text not null check(provider in ('amazon','aliexpress')),
 external_id text not null,external_sku text not null,product_id text not null unique references products(id),
 country text not null,marketplace text not null default '',logistics_service text not null default '',
 supplier_stock integer not null check(supplier_stock>=0),supplier_cost numeric(12,2),
 currency char(3) not null,last_synced_at timestamptz not null,
 unique(provider,external_id,external_sku)
);
alter table order_items add column if not exists supplier_snapshot jsonb;
create table if not exists supplier_orders (
 id uuid primary key,order_id text not null references orders(id),provider text not null check(provider in ('amazon','aliexpress')),
 reference text not null unique,status text not null check(status in ('prepared','submitting','submitted','unknown','rejected')),
 request_hash text not null,payload jsonb not null,external_ids jsonb not null default '[]',
 message text not null default '',expires_at timestamptz not null,
 created_by uuid references users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(order_id,provider)
);

-- v20.1: durable, idempotent refund intent also reserves pending payout amounts.
alter table refunds add column if not exists request_key text;
alter table refunds add column if not exists request_hash text;
alter table refunds add column if not exists request_payload jsonb;
alter table refunds add column if not exists submission_state text not null default 'recorded';
alter table refunds add column if not exists submitted_at timestamptz;
create unique index if not exists refunds_request_key_idx on refunds(request_key) where request_key is not null;

-- v21.3: refunds after settlement become auditable, reusable debit balances.
alter table seller_payouts drop constraint if exists seller_payouts_status_check;
alter table seller_payouts add constraint seller_payouts_status_check
  check(status in ('pending','available','paid','failed','settled'));
alter table seller_payouts add column if not exists settled_at timestamptz;
create unique index if not exists seller_payout_item_source on seller_payout_items(payout_id,seller_id,order_id);
create table if not exists seller_payout_refund_adjustments (
  seller_id uuid not null,
  order_id text not null,
  source_payout_id uuid not null,
  currency char(3) not null,
  original_net_amount numeric(12,2) not null check(original_net_amount>=0),
  refunded_amount numeric(12,2) not null check(refunded_amount>0),
  debit_amount numeric(12,2) not null check(debit_amount>0 and debit_amount<=original_net_amount),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(seller_id,order_id),
  foreign key(source_payout_id,seller_id,order_id) references seller_payout_items(payout_id,seller_id,order_id)
);
create table if not exists seller_payout_refund_offsets (
  payout_id uuid not null,
  seller_id uuid not null,
  order_id text not null,
  amount numeric(12,2) not null check(amount>0),
  created_at timestamptz not null default now(),
  primary key(payout_id,order_id),
  foreign key(payout_id,seller_id) references seller_payouts(id,seller_id),
  foreign key(seller_id,order_id) references seller_payout_refund_adjustments(seller_id,order_id)
);
create index if not exists seller_payout_refund_offsets_source on seller_payout_refund_offsets(seller_id,order_id);
alter table seller_payouts add column if not exists reconciliation_note text not null default '';

-- Email verification, retained from the v21.7 work.
create table if not exists admin_email_challenges (
 user_id uuid primary key references users(id) on delete cascade,
 token_hash text not null, code_hash text not null, expires_at timestamptz not null,
 sent_at timestamptz not null default now(), attempts integer not null default 0 check(attempts between 0 and 5),
 consumed boolean not null default false,delivered boolean not null default false
);

-- v21.8: supplier operational state is separate from customer payment state.
alter table supplier_orders add column if not exists fulfillment_status text not null default 'pending';
alter table supplier_orders add column if not exists supplier_payment_status text not null default 'unknown';
alter table supplier_orders add column if not exists cancel_status text not null default 'none';
alter table supplier_orders add column if not exists packages jsonb not null default '[]';
alter table supplier_orders add column if not exists provider_state jsonb not null default '[]';
alter table supplier_orders add column if not exists last_sync_at timestamptz;
alter table supplier_orders add column if not exists next_sync_at timestamptz not null default now();
alter table supplier_orders add column if not exists sync_error text not null default '';
alter table supplier_orders add column if not exists sync_attempts integer not null default 0;
alter table supplier_orders add column if not exists sync_token uuid;
alter table supplier_orders add column if not exists sync_until timestamptz;
alter table supplier_orders add column if not exists cancel_requested_at timestamptz;
alter table supplier_products add column if not exists next_sync_at timestamptz not null default now();
alter table supplier_products add column if not exists sync_token uuid;
alter table supplier_products add column if not exists sync_until timestamptz;
alter table supplier_products add column if not exists sync_error text not null default '';
