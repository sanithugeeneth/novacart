# Validation — NovaCart v19.3

The local automated suite passed 32 tests: 5 form submission tests plus all 27 existing security/payment and seller/design regression tests. No tests failed or were skipped.

## Form test method and results

The new tests execute the shipped support.js and seller.js handlers in an isolated JavaScript context with DOM/FormData/alert adapters. Requests go to the actual Express server and PGlite PostgreSQL schema. The test harness adds the session cookie and origin, but the application code must supply its own Content-Type and CSRF headers.

- Support with and without an order reference: 201, ticket and initial message persisted, correct owner and priority, success message, form reset and refreshed list.
- Seller application: 201, all supplied fields persisted to a pending profile, success message and form reset.
- Duplicate seller application: 409, one profile retained and entered form data preserved.
- Missing required fields: 400 with feedback and entered data preserved.
- Invalid CSRF: 403. Signed-out submission: 401.
- Another user cannot read the submitted support ticket.

The new suite reproduced the original support failure before the fix (2 failed, 3 passed). After the fix, all 5 passed.

## Browser and live testing limits

The Chromium runner failed before opening a page with SIGSEGV. No new desktop/mobile browser verification is claimed for v19.3. Prior v19.2 browser results remain historical results for that release. Browser form behavior still needs checking on the installed site, as described in START-HERE-v19.3.txt.

No production database, hosted deployment, external email delivery or live Stripe service was used. Local tests use fixture accounts and an isolated database. This release addresses the reported JSON header defect, not every remaining marketplace feature.

## Reproduce

Run `npm run forms:check` for the new form checks or `npm test` for all 32 tests. No live database credentials are required by the tests. The recorded run used Node.js v24.19.0.

## Recorded automated test output

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> novacart-production-marketplace@19.2.0 test
> node --test tests/*.test.js

✔ support form sends JSON and CSRF, saves its message and refreshes the ticket list (9705.544212ms)
✔ support form accepts a real order reference and the ticket stays private to its owner (74.813246ms)
✔ seller application sends all fields as JSON and saves a pending profile once (38.962985ms)
✔ both forms retain entered data and display errors for missing required fields (72.086418ms)
✔ both form submissions still enforce authentication and CSRF (71.848083ms)
✔ customer login cannot create an admin session even with a valid admin password (10090.782232ms)
✔ missing and malformed OTPs reject admin login (26.642901ms)
✔ valid password and current OTP create an MFA-verified admin session (27.949901ms)
✔ legacy password-only admin sessions fail closed when MFA is required (6.671111ms)
✔ customers cannot access administrator APIs (17.638383ms)
✔ missing MFA secret rejects admin login instead of bypassing verification (28.698507ms)
✔ valid raw Stripe signature confirms payment and exposes paid status to the customer (101.546775ms)
✔ forged Stripe signature cannot update an order (41.363045ms)
✔ duplicate signed events do not duplicate emails, points or paid history (108.309262ms)
Payment notification failed 7eeaf3c2-0766-486f-9d7d-32717642315f Payment details do not match the order.
Payment notification failed eb63d4c7-eef0-4099-9842-566f562c3c81 Payment details do not match the order.
Payment notification failed 9d74f5af-3520-4315-9066-82bec750b331 Payment details do not match the order.
✔ wrong payment amount, currency or reference cannot mark an order paid (110.66629ms)
✔ coupon checkout total exactly matches the amount verified in the webhook (57.040597ms)
✔ a declined card can be retried successfully without releasing reserved stock (69.967405ms)
✔ an unpaid completion waits for async payment success (47.890254ms)
✔ late notification recovery confirms a provider-paid order before releasing inventory (40.089192ms)
Payment reconciliation needs retry NC-MU6DR38Y-DFDCB9 Simulated provider outage
✔ unpaid expiry releases stock once, while a provider outage preserves the reservation (103.529564ms)
✔ approved sellers use their existing login cookie for every seller read endpoint (9702.724262ms)
✔ anonymous, invalid, revoked and expired sessions cannot access seller data (35.254332ms)
✔ customers and pending, rejected or suspended sellers are denied with 403 (131.498294ms)
✔ seller product create/edit requires CSRF and enforces user ownership (50.412619ms)
✔ public seller catalogs resolve products using the owner user ID (16.982772ms)
✔ mixed COD checkout assigns seller profiles and keeps order-item owner IDs (95.708549ms)
✔ seller orders accept their owner updates and reject another seller or missing CSRF (79.882613ms)
✔ seller card checkout still confirms payment through a signed Stripe webhook (48.092186ms)
✔ unavailable or missing seller profiles reject checkout and roll back order and inventory (73.782746ms)
✔ signature CSS and JS are served with correct MIME types and exact content (31.809745ms)
✔ customer pages reference the signature assets and allow their Google Fonts stylesheet (36.477763ms)
✔ serving signature assets does not expose server files or dependency sources (18.11219ms)
ℹ tests 32
ℹ suites 0
ℹ pass 32
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11675.223673
```
