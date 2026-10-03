# NovaCart V13 — Bug-fix report

This release addresses the previously identified application defects and hardening gaps that were fixable without merchant-owned external accounts.

## Fixed
- Payment failure recovery now maps PaymentIntent failures through Stripe PaymentIntent metadata and only mutates pending-payment orders.
- Stripe completion webhook verifies payment mode, paid status, currency, and exact order amount before marking an order paid.
- Duplicate Stripe webhook delivery is handled with conflict-safe event insertion/idempotency.
- Full and partial refunds are protected by an advisory order lock and reconciled from Stripe refund state.
- Admin cannot mark orders refunded by changing status directly; refunds must flow through the refund operation.
- Paid orders cannot be cancelled through the generic admin status endpoint.
- COD cancellation updates payment state and releases coupon usage correctly.
- Coupon redemption reservation/release is transactional for abandoned/failed payments.
- Email outbox uses short DB claim transactions with lock tokens and stale-lock recovery instead of holding a DB lock during SMTP delivery.
- Registration handles duplicate-email races cleanly.
- Customer profile/address updates validate phone/postal data consistently.
- Return-window checks use the delivered status timestamp when available.
- Admin product creation is transactional with initial product-image creation.
- Product image updates keep the primary gallery image synchronized.
- Product and variant update validation rejects invalid numbers, URLs, JSON, booleans and negative inventory fields.
- Admin sessions do not use long-lived remember-me sessions.
- Admin password is not overwritten on every restart unless `SYNC_ADMIN_FROM_ENV=true` is explicitly enabled.
- Metrics endpoint requires a bearer token.
- Shipment events validate status and order existence.
- Customer-facing greeting/address/order rendering was hardened against HTML injection.
- Product SEO landing pages expose real SKU/stock availability and correct Product JSON-LD availability.
- Production preflight versioning and environment checks were aligned to V13.

## Verification performed
- Server JavaScript syntax check: PASS.
- All project JavaScript files syntax check: PASS.
- Inline JavaScript syntax checks in HTML pages: PASS.
- V13 static hardening checks: PASS.
- ZIP/package integrity: PASS.

## Important boundary
No automated test can truthfully mark merchant-owned Stripe live credentials, SMTP credentials, production database, domain ownership, DNS, TLS, legal settings, or a real production payment as completed without those external services being connected. Those are intentionally left as secure environment/deployment configuration rather than fabricated secrets.
