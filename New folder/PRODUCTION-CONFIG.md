# NovaCart V13 production configuration

This release closes the application-side hardening gaps identified during review. A real launch still requires merchant-owned external accounts and values.

## Required production secrets/config
- `DATABASE_URL`: managed PostgreSQL connection string.
- `PUBLIC_BASE_URL`: canonical HTTPS domain.
- `BUSINESS_NAME`, `BUSINESS_COUNTRY`, `BUSINESS_ADDRESS`.
- `SUPPORT_EMAIL`, `PRIVACY_EMAIL`, `SUPPORT_HOURS`.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
- `ADMIN_MFA_REQUIRED=true` and a valid `ADMIN_MFA_SECRET`.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` for card payments.
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` for transactional email.
- `TAX_RATES_JSON`, `SHIPPING_ZONES_JSON`, and published business policies.

## Deployment order
1. Provision managed PostgreSQL and a private backup policy.
2. Set production environment variables in the host secret manager.
3. Run `npm run db:migrate`.
4. Run `npm run db:seed-admin` once.
5. Run `npm run preflight` / `npm run launch:check`.
6. Configure the Stripe webhook at `/api/stripe/webhook`.
7. Verify SMTP and email delivery.
8. Attach the domain and verify HTTPS.
9. Run `npm run smoke` and `npm run load:test`.
10. Execute a real low-value end-to-end payment/refund test before opening the store.

## Payment testing
Use Stripe's test mode first. Test: success, failed payment, expired checkout, duplicate webhook delivery, partial refund, full refund, and retry/reconciliation.

## Data protection
Never commit `.env`, production secrets, payment secrets, or database dumps to source control.
