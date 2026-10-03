# NovaCart 21.9 — Forma Motion Experience

Start with **START-HERE-v21.9.txt**. Hero reveals, product depth/zoom, scroll
entrances, cart/wishlist feedback and responsive overlay transitions are included.
A persistent Page animations toggle respects device reduced-motion preferences.

Run `npm.cmd run preview:ui` to view the actual isolated sample store. A recorded
walkthrough is in **preview/motion/Motion-Preview.mp4**. Read
**MOTION-EXPERIENCE-v21.9.md** for behavior, accessibility and upgrade details.

No database migration is added relative to v21.8. Older versions need its cumulative
migration. Deploy application/static files together, restart and refresh the browser.
Prior supplier, email OTP and security/payment fixes are included. No live deployment.

---

## Historical release notes

# NovaCart 21.8 — Supplier Operations + Admin Email OTP

Start with **START-HERE-v21.8.txt**, **SUPPLIER-OPERATIONS-v21.8.md** and
**EMAIL-OTP-SETUP.md**. Run the new database migration. This release adds supplier
tracking/stock scheduling, Amazon cancellation requests, AliExpress operational
status, provider-read checks, and email OTP admin login. Preserve private settings.

161 regression tests and 8 local Chromium browser checks passed. AliExpress
payment/buyer cancellation still need the provider account; actual API access,
real SMTP delivery and production deployment require your configuration and
verification. Earlier release notes below are historical.

# NovaCart 21.6 — Complete Sitemap Product Pages

Read **START-HERE-v21.6.txt** and **PRODUCT-PAGES-v21.6.md**. `/p/...` now serves the
full Forma product design, server-rendered content and interactive purchase
controls. Legacy product links redirect automatically; no extra product-page
click is needed. Canonical/social/structured metadata is included in the HTML.

Update source and static files together, preserve private settings, confirm
`PUBLIC_BASE_URL`, restart and hard refresh. No new schema after v21.3.
Run `npm run product-pages:check` or `npm test`. Browser evidence:
**preview/product-pages/**. No live deployment or search indexing is claimed.

Older release notes below are historical.

# NovaCart 21.5 — Admin / Seller Currency Fix

Start with **START-HERE-v21.5.txt** and **CURRENCY-FIX-v21.5.md**. Admin and seller
amounts now show explicit currency codes. Store prices and current-currency totals
follow configuration; historical orders/refunds/payouts retain their own currency.
Amounts in different currencies are not added together or silently converted.

Update source and static files together, keep existing private configuration,
restart and hard refresh both screens. No schema migration is added after v21.3.
Run `npm run currency:check` or `npm test`. Browser evidence for LKR/USD:
**preview/currency/**. No live deployment is claimed.

Earlier release notes below are historical.

# NovaCart 21.4 — Seller Dashboard

Start with **START-HERE-v21.4.txt**. Approved sellers can add/edit products and
variants, update available stock, hide/publish listings, search and paginate their
catalogue/orders, update shipping and request payouts from one dashboard.

Read **SELLER-DASHBOARD-v21.4.md** for controls, API compatibility, stock conflict
handling, upgrade instructions and validation. Local regression: **131 passed**;
10 browser checks passed at mobile/desktop sizes. Evidence:
**preview/seller-dashboard/** and **validation/tests-v21.4.txt**.

Back up your database, update source and static files together, keep existing
private configuration, run `npm run db:migrate`, restart and hard refresh the
seller page. No new schema is introduced after v21.3; older deployments still
need its cumulative migration. No live deployment is claimed.

Run `npm run seller-dashboard:check`, `npm test`, or `npm.cmd run preview:ui`
(Windows) for the isolated sample store. See **DEPLOYMENT-v20.1.md** for setup.
Payout requests require admin review and an externally completed transfer.

The following older release notes are retained as history; this entry point
supersedes their current-release claims and upgrade instructions.

# NovaCart 21.3 — Refund recovery after seller payouts

Start with **START-HERE-v21.3.txt**. Refunds on already paid orders become an
explicit recovery balance and are deducted from later eligible payouts. Sellers
can refresh balances and generate payouts; admins can reconcile refunds and
review the resulting transfer amount. Paid records stay unchanged.

**A database migration is required for this release.** Back up the existing
database, stop the old app, deploy source and static files together, migrate with
`npm run db:migrate`, and restart. Production startup runs the migration as well.
Keep the existing database and private settings.

Read **REFUND-PAYOUT-RECOVERY-v21.3.md** for calculations, examples, upgrade steps
and accounting limits. Run `npm run payout-refunds:check`, `npm test`, or
`npm run preview:ui` for the isolated sample store. Windows PowerShell also accepts
`npm.cmd run preview:ui`. Local regression: 120 passed. Browser evidence is in
**preview/payout-recovery/**. Live deployment/provider verification is not claimed.

The v21.2 tracking and v21.1 payment guard fixes remain included. Older versioned
notes are retained as history; this entry point supersedes their upgrade steps.

# NovaCart 21.1 — Seller payment guard

Start with **START-HERE-v21.1.txt**. Seller fulfillment now checks authoritative
payment/order state inside the same transaction as the update. Unpaid card orders
cannot be processed, packed or shipped. Confirmed paid orders and legitimate
cash-on-delivery orders remain supported.

Run `npm run seller-fulfillment:check` for the targeted regression checks, or
`npm test` for the complete suite. See **SELLER-PAYMENT-GUARD-v21.1.md** for the
behavior matrix, upgrade notes and validation evidence. No new database migration
is introduced by this patch. Existing production upgrades still follow
**DEPLOYMENT-v20.1.md**. The Forma UI and local preview remain available through
`npm run preview:ui`.

---

# NovaCart 21.0 — Forma UI

Start with **START-HERE-v21.0.txt**. The new Forma design includes an original
campaign image, sage/ink/lime palette, expressive typography, responsive product
cards, redesigned shopping surfaces, and coordinated login/admin screens.

Run `npm run preview:ui` for the isolated sample store. The local regression suite
passed all 87 tests; the browser review covered 14 views and 10 interaction flows.
See **DESIGN-v21.0.md**, **VALIDATION-v21.0.md**, and **preview/forma/**.

This UI release builds on v20.1. For production configuration and migrations use
**DEPLOYMENT-v20.1.md**; integrations use **INTEGRATIONS-v20.0.md**. Live deployment
and live provider acceptance have not been performed. This release adds no new
schema migration beyond the existing cumulative migration.

---

## Earlier release notes

# NovaCart 20.1 — Launch setup and refund reliability

Start with **START-HERE-v20.1.txt** and **DEPLOYMENT-v20.1.md**.
This release adds production Docker/HTTPS configuration, a private setup generator,
admin launch-readiness reporting, durable refund recovery and email-flow validation.
It preserves the Atelier design and the existing marketplace/provider fixes.

`npm run preview:ui` opens the isolated local design preview. `npm test` runs the
87-test local regression suite. See **VALIDATION-v20.1.md** for evidence and limits.
For provider setup, keep using **INTEGRATIONS-v20.0.md** alongside the new deployment guide.

Live deployment and provider acceptance remain pending your domain, hosting and
approved accounts. Automatic supplier payment, cancellation and tracking import
are not included. Back up and preserve your existing database/private settings
before applying this release's additive migration.

---

## Historical release notes

# NovaCart 20.0 — Atelier UI + provider integrations

Start with **START-HERE-v20.0.txt**. This release replaces the old presentation layers
with a complete responsive design, adds Google/Apple sign-in, real image analysis
and supplier sync/fulfillment adapters, and preserves the v19.1–v19.4 fixes.
Read **INTEGRATIONS-v20.0.md** for credentials, live activation and the AliExpress
API-contract verification still required for your approved account.

```bash
npm run preview:ui
```

The terminal prints the local preview URL and sample account logins. No Docker or
external database is required for this temporary design preview. For the real store,
keep your existing environment/database configuration and run `npm run db:migrate`
then `npm start`. See DESIGN-v20.0.md, VALIDATION-v20.0.md and the preview/ screenshots.

---

## Prior release notes

# NovaCart v19.4 — Payout ledger and complete catalog browsing

Start with `START-HERE-v19.4.txt` and run the database migration before starting this version. Read `FIXES-v19.4.md` and `VALIDATION-v19.4.md` for the current changes and results. This release retains all prior fixes. Run `npm test` for the regression suite. Older release notes below are not current verification results.

# NovaCart v13 — Production-Hardened Marketplace

NovaCart v13 is the hardened full-stack release of the NovaCart storefront, customer account area, checkout, order management and admin control center.

## Included
- Premium customer storefront, product details and motion system.
- Customer registration/login, secure sessions, email verification and password reset.
- Address book, customer profile, orders and local wishlist plus server-synced wishlist APIs.
- PostgreSQL schema with products, variants, images, inventory movements, orders, order timeline, refunds, reviews, coupons, audit logs and email outbox.
- Server-side product search, filtering, pagination and price/stock validation.
- Checkout idempotency using the `Idempotency-Key` header.
- Stripe Checkout with signed webhook verification and failed/expired payment stock recovery.
- COD checkout.
- Admin product create/edit/archive, variants, inventory adjustment, order timeline, refund workflow, customers, review moderation and audit log.
- Transactional email outbox with exponential retry when SMTP is configured.
- Security headers, rate limits, CSRF checks, origin checks, secure HttpOnly sessions, password hashing, request IDs and database timeouts.
- Health/readiness endpoints, dynamic sitemap, robots rules, backup helpers and deployment templates.

## Local Windows start
1. Copy `.env.example` to `.env` and set `DATABASE_URL` plus a private `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
2. Start Docker Desktop.
3. In this folder run:
   `docker compose up -d db`
4. Wait until `docker compose ps` shows `db` as `healthy`.
5. Run:
   `npm install`
   `npm run db:migrate`
   `npm run db:seed-admin`
6. Start the server:
   `npm start`
7. Open `http://localhost:3000` for the storefront or `http://localhost:3000/admin.html` for the admin center.

## Production start
Set all required secrets/configuration in your hosting provider. Then use:
`npm run start:prod`

Production preflight will intentionally refuse to start when mandatory production configuration is missing.

## External services
The application is ready for a real PostgreSQL provider, Stripe live mode, SMTP provider, custom domain and HTTPS. Those services still require accounts owned by the store operator and secrets must be entered in the provider's secret manager. Never commit `.env` or paste secrets into source control.

## QA
Run `npm run launch:check` after the database is reachable. With the server running, `npm run smoke` checks health/readiness, core pages and public endpoints.


# V13 hardening summary

V13 closes the reviewed application-side gaps: transactional coupon reservations, partial refunds, Stripe refund reconciliation, payment-intent failure recovery, customer cancellation/return requests, shipment events, invoice rendering, stronger address validation, marketing preferences, session/device controls, admin analytics, cost/margin tracking, product media management, SEO product landing routes, strict production placeholders, fail-closed admin MFA, CSP, metrics, load-test tooling, and backup verification.

External merchant configuration is intentionally not embedded: production Stripe/SMTP/database/domain credentials and the merchant's legal/tax/shipping rules must be supplied through the deployment secret manager.

## V14 Mega Marketplace
Adds seller center, seller onboarding/approval, seller orders/payouts schema, recommendations, browsing/search history, wishlist collections, notifications, loyalty, product Q&A, review media, support tickets, fraud events, visual-search adapter, marketplace admin controls, and stronger operations tooling.

## Local start
`npm start` now waits for PostgreSQL and automatically applies `schema.sql` migrations before starting NovaCart v15. This avoids starting the server against an older schema.

Validation for this release: **27 focused regression tests and 17 local Chromium browser checks passed.** No live deployment.
