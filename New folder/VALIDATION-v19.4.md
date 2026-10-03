# Validation — NovaCart v19.4

The final local run passed all 48 automated tests with zero failures or skipped tests:

- 15 admin MFA and Stripe payment regression tests.
- 12 seller access/checkout and signature asset tests.
- 5 support/seller form submission tests.
- 9 payout eligibility, allocation, retry, date, migration and protection tests.
- 7 catalog API and storefront DOM tests.

Runtime: Node.js v24.19.0. Test database: isolated PGlite PostgreSQL with the actual schema and constraints. Catalog DOM: jsdom 26.1.0 running the shipped storefront script, buttons, input events and fetch requests against the real local HTTP server.

## Payout evidence

Tests verify that unpaid, failed, cancelled, refunded, partially refunded and uncollected COD orders are excluded. Repeated/concurrent HTTP requests return one payout ID; overlapping periods only allocate new orders. A direct duplicate order-allocation insert fails the database primary key. Tests also cover discount cent allocation, pending refunds/returns, changed snapshots, failed-payout retries, terminal paid state, transfer references, administrator-only COD collection, CSRF, date validation and migration with duplicate historical rows.

## Catalog evidence

A fixture catalog contains 105 active products with equal creation timestamps. API pagination returns all 105 once in stable order. The actual Load more handler fetches nine pages and renders all 105. Search finds late-page title, brand and keyword matches. A category absent from the first page appears in the category pills and queries the full catalog. Tests verify server sorting, stale-response rejection, next-page retry and saved cart/wishlist details outside the first page.

## Boundaries

PGlite uses a serialized test connection adapter. Concurrent HTTP requests are covered, but multi-connection production PostgreSQL contention/load was not exercised; production protection also relies on the database locks and uniqueness constraints. jsdom tests functional DOM behavior, not browser layout or paint. No new Chromium rendering check is claimed for this release. Existing design assets remain unchanged.

No hosted deployment, production data, actual cash receipt, bank/seller transfer or live Stripe API was exercised. Payment provider fixtures are used by tests. Historical payout aggregates and post-transfer refunds can require reconciliation as documented in FIXES-v19.4.md. The migration preserves those records rather than inventing allocation history.

Run `npm test` to reproduce all tests, or `npm run payout-catalog:check` for the two new suites.

## Recorded output

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> novacart-production-marketplace@19.4.0 test
> node --test tests/*.test.js

✔ API pagination reaches every active product with stable ordering and rejects bad pages (5166.402299ms)
✔ the actual Load more button fetches beyond 48 and stops only at the end of the catalog (809.244502ms)
✔ search, brand and keyword matches include products outside the initial page (911.587293ms)
✔ category pills and sorting use the full catalog, including a category absent from page one (141.247361ms)
✔ a late old search response cannot replace the newer search or unlock its loading state (65.837196ms)
✔ a failed next-page request keeps products and retries that same page (99.431109ms)
✔ saved cart and wishlist products beyond page one retain their details across searches (349.293773ms)
✔ support form sends JSON and CSRF, saves its message and refreshes the ticket list (5203.2153ms)
✔ support form accepts a real order reference and the ticket stays private to its owner (82.649735ms)
✔ seller application sends all fields as JSON and saves a pending profile once (28.642761ms)
✔ both forms retain entered data and display errors for missing required fields (70.158291ms)
✔ both form submissions still enforce authentication and CSRF (95.278256ms)
✔ payout eligibility excludes unpaid, failed, cancelled, refunded and uncollected COD orders (5443.404322ms)
✔ repeat and concurrent requests return one payout, and overlapping ranges cannot reuse orders (68.864964ms)
✔ discounted mixed orders allocate cents once across sellers and exclude platform shipping/tax (27.489405ms)
✔ a one-cent discount is allocated exactly once across seller balances (25.000179ms)
✔ pending refunds and open returns are withheld, and refunds invalidate an unpaid snapshot (36.064124ms)
✔ failed payouts retain their allocations, can be retried, and paid payouts cannot reopen (76.093685ms)
✔ COD needs an admin collection receipt before inclusion in a payout (45.227769ms)
✔ bad dates, unauthenticated requests and invalid CSRF cannot generate payouts (20.071296ms)
✔ legacy duplicates survive migration but overlapping historical amounts cannot be paid again (66.591331ms)
✔ customer login cannot create an admin session even with a valid admin password (4973.82231ms)
✔ missing and malformed OTPs reject admin login (29.727586ms)
✔ valid password and current OTP create an MFA-verified admin session (19.036775ms)
✔ legacy password-only admin sessions fail closed when MFA is required (5.76646ms)
✔ customers cannot access administrator APIs (20.163702ms)
✔ missing MFA secret rejects admin login instead of bypassing verification (18.553223ms)
✔ valid raw Stripe signature confirms payment and exposes paid status to the customer (37.072547ms)
✔ forged Stripe signature cannot update an order (20.356415ms)
✔ duplicate signed events do not duplicate emails, points or paid history (28.746032ms)
Payment notification failed 90187e60-b2c0-494c-8928-8343645cab1d Payment details do not match the order.
Payment notification failed 0c85b643-0398-4adf-9b41-e563e2016ad4 Payment details do not match the order.
Payment notification failed 3f43f69e-6924-4aa5-adf2-e716ed602d5d Payment details do not match the order.
✔ wrong payment amount, currency or reference cannot mark an order paid (69.415409ms)
✔ coupon checkout total exactly matches the amount verified in the webhook (51.765103ms)
✔ a declined card can be retried successfully without releasing reserved stock (55.231194ms)
✔ an unpaid completion waits for async payment success (42.47417ms)
✔ late notification recovery confirms a provider-paid order before releasing inventory (24.417913ms)
Payment reconciliation needs retry NC-MU6VJS49-8A1793 Simulated provider outage
✔ unpaid expiry releases stock once, while a provider outage preserves the reservation (36.255776ms)
✔ approved sellers use their existing login cookie for every seller read endpoint (5246.738561ms)
✔ anonymous, invalid, revoked and expired sessions cannot access seller data (27.65922ms)
✔ customers and pending, rejected or suspended sellers are denied with 403 (96.545364ms)
✔ seller product create/edit requires CSRF and enforces user ownership (36.49004ms)
✔ public seller catalogs resolve products using the owner user ID (13.555444ms)
✔ mixed COD checkout assigns seller profiles and keeps order-item owner IDs (82.894415ms)
✔ seller orders accept their owner updates and reject another seller or missing CSRF (31.432913ms)
✔ seller card checkout still confirms payment through a signed Stripe webhook (30.255913ms)
✔ unavailable or missing seller profiles reject checkout and roll back order and inventory (42.585735ms)
✔ signature CSS and JS are served with correct MIME types and exact content (10.036699ms)
✔ customer pages reference the signature assets and allow their Google Fonts stylesheet (25.238404ms)
✔ serving signature assets does not expose server files or dependency sources (12.264856ms)
ℹ tests 48
ℹ suites 0
ℹ pass 48
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8189.530826
```
