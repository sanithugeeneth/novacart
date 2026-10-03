# Validation — NovaCart v19.2

The final local run passed all 27 automated regression tests (15 security/payment + 12 seller/design), with 0 failures or skipped tests. Runtime: Node.js v24.19.0. Database: isolated PGlite PostgreSQL using the project schema, including foreign keys. Test accounts and payment sessions are fixtures.

Run `npm test` to reproduce the automated suite. Use `npm run seller-design:check` or `npm run security-payment:check` to run a focused suite.

## Browser checks

Chromium 153.0.8010.0, desktop viewport 1440 × 1000 and mobile viewport 390 × 844:

- Signature CSS variables and page background applied; JS initialized, scroll state changed and reveal effects became visible.
- Both signature assets returned HTTP 200 on every checked page load.
- A real local seller login loaded the dashboard metrics, its own product and its own COD order.
- Primary button labels use white text on the dark signature background.
- The mobile storefront document width matched its 390px viewport, with no horizontal overflow.
- The seller application form sent JSON with CSRF, returned HTTP 201 and reset after submission.
- No JavaScript page errors were captured during these checks.

External images and Google Fonts responses were replaced with local placeholders for deterministic browser checks. Native alerts were captured by the test harness. The actual application HTML/CSS/JS, authentication, form handling and APIs ran against the local server. The server CSP separately passed a check permitting the configured Google Fonts stylesheet.

Live hosting, production data, real Stripe delivery and external font/image availability were not tested. This record covers the requested fixes; it is not a complete audit of every marketplace feature.

## Automated test output

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> novacart-production-marketplace@19.2.0 test
> node --test tests/*.test.js

✔ customer login cannot create an admin session even with a valid admin password (10172.967927ms)
✔ missing and malformed OTPs reject admin login (31.014067ms)
✔ valid password and current OTP create an MFA-verified admin session (45.738519ms)
✔ legacy password-only admin sessions fail closed when MFA is required (9.156563ms)
✔ customers cannot access administrator APIs (11.742434ms)
✔ missing MFA secret rejects admin login instead of bypassing verification (21.844348ms)
✔ valid raw Stripe signature confirms payment and exposes paid status to the customer (90.821164ms)
✔ forged Stripe signature cannot update an order (42.485618ms)
✔ duplicate signed events do not duplicate emails, points or paid history (45.599138ms)
Payment notification failed 94a983c8-79c9-4b36-a6ec-6c52bfb54cc3 Payment details do not match the order.
Payment notification failed 18d4e97e-f01c-431f-8fb0-8ba57156da7e Payment details do not match the order.
Payment notification failed 8491ca36-9f16-48b7-b88b-bddf967054f2 Payment details do not match the order.
✔ wrong payment amount, currency or reference cannot mark an order paid (156.652327ms)
✔ coupon checkout total exactly matches the amount verified in the webhook (45.503678ms)
✔ a declined card can be retried successfully without releasing reserved stock (67.870529ms)
✔ an unpaid completion waits for async payment success (53.44889ms)
✔ late notification recovery confirms a provider-paid order before releasing inventory (43.838964ms)
Payment reconciliation needs retry NC-MU6DI4L5-BC9BC4 Simulated provider outage
✔ unpaid expiry releases stock once, while a provider outage preserves the reservation (58.232913ms)
✔ approved sellers use their existing login cookie for every seller read endpoint (10619.345587ms)
✔ anonymous, invalid, revoked and expired sessions cannot access seller data (31.86867ms)
✔ customers and pending, rejected or suspended sellers are denied with 403 (121.916264ms)
✔ seller product create/edit requires CSRF and enforces user ownership (41.666545ms)
✔ public seller catalogs resolve products using the owner user ID (16.952152ms)
✔ mixed COD checkout assigns seller profiles and keeps order-item owner IDs (98.592495ms)
✔ seller orders accept their owner updates and reject another seller or missing CSRF (59.356959ms)
✔ seller card checkout still confirms payment through a signed Stripe webhook (44.913886ms)
✔ unavailable or missing seller profiles reject checkout and roll back order and inventory (87.802605ms)
✔ signature CSS and JS are served with correct MIME types and exact content (36.060942ms)
✔ customer pages reference the signature assets and allow their Google Fonts stylesheet (31.662729ms)
✔ serving signature assets does not expose server files or dependency sources (13.225023ms)
ℹ tests 27
ℹ suites 0
ℹ pass 27
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11997.353181
```
