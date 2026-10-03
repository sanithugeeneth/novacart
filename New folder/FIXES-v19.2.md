# NovaCart v19.2 — Seller access and signature design

This release builds on v19.1 and addresses the two requested seller/design defects. The earlier admin MFA and Stripe payment fixes are retained.

## Seller access and ownership

- Seller middleware now loads and verifies the existing login cookie before checking the seller's current approval status. Approved sellers can access overview, products, orders and payouts. Missing/expired/revoked sessions receive 401; customers and unapproved sellers receive 403.
- Product create/edit uses the logged-in owner's user ID. Order access and updates use that owner's seller profile ID. Requests cannot select another seller's identity.
- Checkout resolves the product owner's user ID to the correct seller profile ID before inserting seller orders. This fixes the foreign-key failure for both COD and card checkout, including mixed carts and variants.
- Public seller catalogs query products by the owner's user ID.
- Missing, pending or suspended seller profiles reject checkout, and the transaction rolls back the order and stock reservation.
- The seller application form sends JSON with the correct Content-Type and uses a slug validation pattern compatible with current browsers. Customer email text rendered in seller order cards is escaped.

The existing schema intentionally uses two identifiers:

| Column | References |
| --- | --- |
| products.seller_id | users.id |
| order_items.seller_id | users.id |
| sellers.user_id | users.id |
| seller_orders.seller_id | sellers.id |
| seller_payouts.seller_id | sellers.id |

No seller ID rewrite or destructive database migration is needed. Keep existing records and run the normal schema migration when updating, especially if upgrading from v19.0.

## Signature design

- `signature-ui.css` and `signature-ui.js` are included in the server's static-file allowlist and return 200 with the correct content types.
- The Content Security Policy permits the Google Fonts stylesheet already referenced by the storefront.
- The mobile search field stays within the header layout. Primary button labels remain readable against the signature layer's dark background.
- The server continues to deny requests for application source, database schema, environment files and dependency files.

## Verification

Run `npm test` for all 27 regression tests, or `npm run seller-design:check` for the 12 new tests. The new tests reproduced the failures before the fix: 10 failed and 2 passed. After the fix, all 12 pass, along with the 15 existing security/payment tests.

Tests use the actual Express application and an isolated PGlite PostgreSQL engine with real schema constraints. Seller fixtures deliberately use different user and profile UUIDs. Stripe session creation is a local provider fixture; webhook verification uses Stripe's real signature verification implementation.

Coverage includes login cookies, approval changes, expired/revoked sessions, CSRF, seller isolation, product creation/editing, order updates, public catalogs, mixed seller/platform/variant checkout, signed payment confirmation, transaction rollback, asset contents/MIME types and protected-file access.

See `VALIDATION-v19.2.md` for browser checks and the recorded test results. Live hosting, an existing production database, real merchant event delivery and external font/image services were not exercised. Follow `START-HERE-v19.2.txt` to update your installation.

This update covers reported issues 1–4 cumulatively. Other previously reported marketplace features and defects are outside this release's verification scope.
