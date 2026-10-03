# NovaCart v19.1 — Admin MFA and payment confirmation fix

This is a focused update to the uploaded v19 project. It addresses the two requested defects; it is not a certification that every feature in the earlier marketplace is production-ready.

## Admin MFA

- Customer sign-in cannot create an administrator session.
- Admin sign-in checks the password and the six-digit authenticator code when MFA is enabled.
- Only the server can mark a session as MFA-verified.
- Every protected admin API checks the verified session flag when MFA is required.
- Old password-only sessions remain unverified after migration and must sign in again.
- Missing MFA configuration fails closed.
- The session activity timestamp now updates the correct session ID.

## Payment confirmation

- Stripe receives the original request bytes for signature verification. The global JSON parser no longer consumes webhook bodies.
- Invalid signatures return HTTP 400 without changing an order.
- Verified payments must match the order amount, currency, Checkout session and checkout reference.
- A valid event updates the order and payment status to paid, records its history, applies the reserved coupon and queues the confirmation email in one transaction.
- Repeated events do not duplicate payment history, confirmation emails or loyalty points.
- A card decline remains retryable within its Checkout session.
- Asynchronous success is handled; an unpaid completion does not falsely mark an order paid.
- Expired reservations are checked with Stripe before inventory is released. A provider outage keeps the reservation for a later retry.
- Checkout uses Stripe's expires_at parameter. Discounts are allocated in cents so the Checkout amount and stored order total match.

## Verified locally

`npm run security-payment:check`: 15 tests passed, 0 failed.

Tests use the actual Express routes, real Stripe SDK signature verification, and an embedded PostgreSQL engine (PGlite). External Stripe API operations use deterministic local test doubles. The application schema is applied twice to check repeatable migration. PGlite omits the optional pgcrypto extension declaration; this release does not use extension functions in the tested flows.

Covered: customer/admin separation; missing/invalid/valid OTP; legacy sessions; customer authorization; missing MFA configuration; correct and forged webhook signatures; duplicate delivery; incorrect amount/currency/reference; discounted checkout; card retry; asynchronous success; delayed webhook recovery; expiry and provider outage.

A real Stripe charge, external webhook delivery, hosted PostgreSQL, SMTP delivery and deployment were not tested in this workspace. Existing paid-but-unconfirmed orders are not changed automatically by this migration. Review and reconcile those against provider records before fulfilment.

## Provider references

- https://docs.stripe.com/webhooks/signature
- https://docs.stripe.com/api/checkout/sessions/create
