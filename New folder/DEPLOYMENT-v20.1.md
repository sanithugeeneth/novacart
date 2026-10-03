# NovaCart 20.1 — deployment and live acceptance

This release prepares the application for deployment. It has not been deployed to your hosting account. Local regression tests use isolated databases and simulated providers. No real payment, email, OAuth login, image-analysis billing or supplier purchase was performed. Docker is unavailable in the build workspace, so the container files were inspected and parsed, not built or run there.

## What this release adds

- Node 24 production image, lockfile installation, non-root application process and health check.
- Standalone production Compose stack: PostgreSQL, the application and Caddy HTTPS. Only ports 80/443 are published; the database stays on a private network.
- Full server environment forwarding, including Stripe, SMTP, MFA, OAuth, Vision and supplier settings. Production startup validates configuration, waits for PostgreSQL, applies the migration and checks its schema before serving.
- Private configuration generator with unique database/admin/MFA/metrics secrets, restrictive file permissions and no overwriting of existing files.
- Admin **Launch setup** screen and secret-free CLI configuration/connection reports. “Configured” never means “live verified”.
- Durable refund reservations and provider idempotency, lost-response recovery, asynchronous refund updates and safer partial-refund controls.
- SMTP TLS/timeouts and regression coverage for verification, reset, email retries and paid-order confirmation. Production no longer seeds sample products automatically.

## 1. Preserve existing data

If this is an existing installation, keep its database, private environment settings and MFA enrollment. Back up the database before migrating. Do not generate a new database password or replace a populated volume simply to install a new release.

The standalone stack below has a fixed project name, `novacart-production`, so upgrading in another release directory uses the same named volumes. It is a separate stack from the older development Compose configuration: it will NOT automatically import your older database. Restore an existing backup into a new database before accepting orders, or keep using your existing database deployment and run this release against it. Never use `docker compose down -v` on the store: that removes persisted data.

The new migration adds request identity and submission state to `refunds`. Existing refunds, accounts, products, orders and supplier records are retained. The schema is idempotent and the local harness applies it twice.

## 2. New standalone server setup

Use a Linux server with Docker Engine and Docker Compose **2.24 or newer**, a public domain and Node 24 for the configuration script. The server must be able to download its container images and npm dependencies. Node 22+ is supported by the package; the supplied image uses Node 24.

Extract the release, then run the following with your real domain and public business/contact details. These arguments are not secret keys.

```bash
npm ci
npm run setup:production -- --domain shop.your-domain.tld --admin-email owner@your-domain.tld --support-email support@your-domain.tld --country LK --address "Your business address"
```

The script creates `.env.production` with mode 0600. It does not print the generated secrets and refuses to overwrite an existing file. Read it privately on the server to obtain the admin password and `ADMIN_MFA_SECRET`. Add that secret to your authenticator as a time-based account: six digits, 30 seconds. Store your recovery copy privately. This deployment uses one configured admin MFA secret; keep any existing enrollment during upgrades.

In your private server editor, fill in:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
MAIL_FROM
```

Use Stripe test credentials first. Use a sender identity approved by your email service and complete its sender-domain authentication. Preserve literal quotes around environment values containing dollar signs or hash signs. Apple private keys must be one line with literal `\n` for line breaks. Do not paste private keys into chat, screenshots, source control or shared ZIPs.

Set actual shipping rates, return rules, currency and business information before opening. The application uses cent-based amounts; validate your chosen currency and price/tax settings in checkout. Optional Google, Apple, Vision, Amazon and AliExpress features remain disabled until deliberately configured. Their credential names and provider-specific limitations are documented in **INTEGRATIONS-v20.0.md**.

```bash
npm run launch:config
```

This command needs no database or provider connection. It reports missing setting names and local structural errors, without printing their values. Test-mode Stripe is permitted for a secure staging deployment and explicitly labeled as test mode.

## 3. DNS, HTTPS and startup

Point the domain's A record to the server. If you publish an AAAA record, it must also reach this server. Allow incoming TCP 80/443 and optionally UDP 443. Caddy uses the `STORE_DOMAIN` value, obtains and renews the certificate and redirects HTTP to HTTPS. Its certificate data persists in named volumes.

```bash
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml up -d --build
docker compose --env-file .env.production -f compose.production.yml ps
```

The `--quiet` configuration check avoids printing expanded secrets. The PostgreSQL password generated by this script is URL-safe hex, matching the connection URL in Compose. If you supply an existing password with URL-special characters, adapt the connection URL with correct percent encoding rather than inserting it unescaped.

Open `https://YOUR-STORE/api/ready` to check the application/database health, then sign in using the Admin tab and your authenticator. Open **Launch setup** from the dashboard. No demo products are created in production. Add reviewed real products before enabling checkout publicly.

If startup needs attention, inspect the app/proxy logs privately:

```bash
docker compose --env-file .env.production -f compose.production.yml logs --tail 100 app proxy
```

Fix missing settings, reload and repeat the checks. Logs can contain customer/operational data; do not publish them unredacted.

## 4. Read-only provider connection checks

Once the app is running:

```bash
docker compose --env-file .env.production -f compose.production.yml exec -T app npm run launch:connections
```

This reads the current Stripe account and performs SMTP connection/authentication verification. It does not create a payment or send an email. The report can also be requested as JSON using `node scripts/preflight.js --connections --json`. Provider errors are summarized without exposing secret values.

Authentication success does not prove that an email reaches an inbox, a payment webhook arrives, or a supplier accepts the requested SKU. Those checks follow below. Optional-provider readiness remains configuration-only until an actual customer journey is tested.

For hosting outside Compose, set the same environment variables in that host's secret/settings interface, supply its PostgreSQL connection URL, run `npm ci --omit=dev`, then `npm run start:prod`. Configure the host's HTTPS reverse proxy and `TRUST_PROXY` to match the actual trusted proxy chain. Do not use the standalone stack's internal `db` hostname for an externally hosted database.

## 5. Callbacks and provider setup

Replace `https://YOUR-STORE` with the exact `PUBLIC_BASE_URL`, including the same host.

| Service | Callback/endpoint | Setup still required |
|---|---|---|
| Stripe | `https://YOUR-STORE/api/stripe/webhook` | Endpoint signing secret from the same test/live mode as the API key |
| Google | `https://YOUR-STORE/api/oauth/google/callback` | Approved OAuth web client and exact redirect URI |
| Apple | `https://YOUR-STORE/api/oauth/apple/callback` | Services ID, team/key IDs, P-256 private key and approved HTTPS return URL |
| Visual search | Customer image upload in the shop | Enabled Google Cloud Vision service, key, billing/quota and daily limit |
| Amazon | Server-to-server SP-API | Approved access, marketplace, own FBA/MCF inventory and seller SKU |
| AliExpress | Approved IOP or TOP contract | App/token permissions and verification that the implemented API methods match your account |

Register these Stripe events for this release:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
payment_intent.payment_failed
charge.refunded
refund.created
refund.updated
refund.failed
```

Refund updates retrieve current provider state to handle delayed/out-of-order events. Keep failed webhook deliveries visible in the provider dashboard and retry them after resolving connectivity/configuration issues.

## 6. Live acceptance checklist — currently NOT completed

Record each result and the relevant provider/order reference in your private operations notes. Configuration alone does not tick these items.

- [ ] HTTPS domain loads the shop and the admin session/MFA flow works.
- [ ] A database backup restores successfully into a disposable database.
- [ ] Customer registration email arrives; verification succeeds once.
- [ ] Password-reset email arrives; the link works once and old sessions are revoked.
- [ ] Stripe test checkout becomes paid through a valid webhook; replay creates no duplicate order/reward/email.
- [ ] An intentionally failed checkout stays unpaid, and an expired order releases inventory correctly.
- [ ] Partial and remaining refunds reconcile to the correct order/payment state; a retry does not transfer money twice.
- [ ] Order confirmation email reaches the intended inbox.
- [ ] Each enabled Google/Apple flow works on the actual domain, including account linking and cancellation.
- [ ] A real photo produces meaningful catalog matches, with honest no-match/error states and the configured quota.
- [ ] Supplier import verifies SKU, destination, stock and cost; the reviewed paid order has a real accepted supplier reference.
- [ ] Supplier payment and fulfillment/cancellation responsibility are confirmed before making the product available to customers.
- [ ] Switch to approved live Stripe credentials and the live endpoint signing secret; verify an authorized real transaction/refund before opening to customers.

No live purchase or message was sent during preparation of this release. A live payment or supplier purchase involves real money and must use the appropriate approved account and explicit test order.

## Refund recovery

The Admin Refund action records the exact intent before contacting Stripe. A connection failure retains that amount as pending, which prevents refunding the same balance again and withholds the order from new seller payouts. Reopen Refund to retry the recorded request; the same request identity survives page reloads and process restarts.

Requests more than 23 hours old only reconcile against provider refund metadata. They never resend a create request after the provider's idempotency-retention window might expire. If no matching refund can be found, the balance remains reserved for manual reconciliation with Stripe. This release deliberately provides no “assume not refunded” bypass. A provider-confirmed failed/canceled refund releases the reservation; a successful refund updates the order.

A customer refund does not automatically cancel a supplier purchase or shipping request. Verify the supplier outcome first and arrange cancellation separately. Already-disbursed seller money also requires a separate settlement/recovery process; NovaCart does not reverse a bank payout automatically.

## Supplier scope that remains manual

Amazon forwarding uses your own MCF inventory, not arbitrary Amazon retail dropshipping. AliExpress acceptance requires your approved API contract to support the implemented calls; this was not verified against a live approved account. AliExpress order creation does not fund the supplier purchase. Automatic supplier payment, cancellation and tracking import remain outside this implementation. The existing admin shipment-event/tracking tools support manual updates. Do not advertise these as fully automated until the approved provider contract and live results have been verified and the remaining provider-specific operations have been implemented.

## Backups and upgrades

Back up before an upgrade and keep a private copy outside the application server. For a running standalone stack, the following creates a plain SQL backup with restrictive permissions:

```bash
umask 077
mkdir -p backups
docker compose --env-file .env.production -f compose.production.yml exec -T db pg_dump -U novacart -d novacart --no-owner --no-acl > backups/novacart-before-upgrade.sql
npm run backup:verify -- backups/novacart-before-upgrade.sql
```

`backup:verify` only checks that a dump looks plausible. It is not a restore test. Restore into a separate disposable database using PostgreSQL tooling and verify users/orders/product counts before relying on the backup. Do not test a restore against your live database. The live restore check was not possible in this workspace.

Preserve `.env.production` and volumes on upgrade, inspect this release's migration, rebuild/restart and repeat the readiness and customer checks. The migration changes are additive, but retain a backup and the previous release before upgrading.

## Primary references

- [Docker Compose environment files](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Stripe event types](https://docs.stripe.com/api/events/types)
- [Nodemailer SMTP transport](https://nodemailer.com/smtp)
