# NovaCart V13 security notes

- Passwords are bcrypt-hashed server-side.
- Sessions use HttpOnly/SameSite cookies; production requires HTTPS.
- CSRF tokens protect authenticated state-changing requests.
- Authentication, checkout, and API endpoints are rate limited.
- Stripe webhooks are signature-verified and idempotent.
- Admin MFA fails closed when required; production refuses to start if its secret is missing.
- Content Security Policy is enabled; inline scripts remain allowed for the current static-page architecture and can be tightened further after externalizing remaining inline scripts.
- Security-sensitive pages are marked `noindex`.
- Session expiry and idle revocation are enforced.
- Password reset and email verification tokens are hashed and expire.
- Admin actions are audited.
- Refunds reconcile against the Stripe refund list and support partial refunds.
- Inventory reservations and coupon reservations are transactional and recover on payment failure/expiry.

Before launch, perform a third-party penetration test, dependency audit, backup restore drill, and production incident-response exercise.
