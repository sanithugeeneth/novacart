# Free assessment deployment

This prepares an **assessment demo**. Deployment and provider acceptance are
still pending. Use a Render **Free** Node service, external **Neon Free**
PostgreSQL, **Brevo Free** HTTPS email and Stripe **test mode**. Stay within
provider limits; this guide does not require buying or upgrading a plan.

## 1. Prepare private accounts

1. Create a Neon Free project/database. In Connect, copy its PostgreSQL
   connection string, including SSL parameters, privately. Keep SSL enabled;
   do not disable certificate verification. A direct connection suits this
   single small server and its migrations. `DB_POOL_MAX=5` limits app connections.
2. Activate Brevo transactional sending and verify your sender address. Create
   an **API key**, not an SMTP password. Set `MAIL_FROM` to that approved sender,
   for example `NovaCart <your-verified-address>`. Render Free blocks outbound
   SMTP ports, so use `MAIL_PROVIDER=brevo`. Sender approval and plan quotas apply.
3. Obtain Stripe sandbox/test credentials. Production startup requires a real
   test API key and the correct endpoint signing secret. Do not use fake keys.
4. Choose a new private admin password with 12+ characters, a letter, number and
   symbol. Do not reuse a password shared in chat. From a private local `.env`
   with your admin email, run `npm run mfa:setup`, enroll the printed key in your
   authenticator and enter the same key as `ADMIN_MFA_SECRET` in Render. Keep
   MFA enabled. [Email OTP](New%20folder/EMAIL-OTP-SETUP.md) is an optional mode.

## 2. Create the Render service

Connect `sanithugeeneth/novacart` using these manual settings:

| Setting | Value |
| --- | --- |
| Branch | `main` |
| Runtime | Node |
| Region | Singapore, if available; keep the database nearby |
| Root directory | `New folder` |
| Build command | `npm ci --omit=dev` |
| Start command | `npm run start:prod` |
| Instance type | **Free — $0/month** |
| Health check | `/api/ready` |
| Automatic deploys | Off during setup |

Alternatively create a Blueprint and explicitly select **`render.free.yaml`**
as its path. The default **`render.yaml` provisions paid web/database plans**.
The free file creates one web service only; configure Neon and Brevo separately.
Check the resource preview: Free web instance, no paid database or disk.

## 3. Enter environment settings

`render.free.yaml` lists all fixed and manual values. For manual setup, copy
those settings into Render's Environment page. `sync: false` means **supply the
value privately**, not a literal value to paste.

| Manual variable(s) | Value |
| --- | --- |
| `DATABASE_URL` | Private Neon connection URL with SSL |
| `PUBLIC_BASE_URL` | Exact assigned `https://…onrender.com` origin, no path |
| `BUSINESS_COUNTRY`, `BUSINESS_ADDRESS` | Accurate project/operator details suitable for public display |
| `SUPPORT_EMAIL`, `PRIVACY_EMAIL`, `SUPPORT_HOURS` | Working contact addresses and hours |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_MFA_SECRET` | Private administrator setup |
| `BREVO_API_KEY`, `MAIL_FROM` | Brevo API key and approved sender |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Test key and this endpoint's signing secret |
| `TAX_RATE`, `STANDARD_SHIPPING_RATE`, `FREE_SHIPPING_THRESHOLD`, `EXPRESS_SHIPPING_RATE` | Explicit assessment pricing rules |
| `RETURNS_DAYS`, `ORDER_RETURN_WINDOW_DAYS` | Values matching your displayed return policy |

The template keeps USD for existing catalog prices. Set `CURRENCY=LKR` only
after reviewing prices and shipping amounts; changing the label does not convert
amounts. For manual setup, generate `METRICS_TOKEN` privately:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The Blueprint generates that token itself. Never commit the output or keys.

If the URL is assigned only after service creation, copy it from the dashboard,
set `PUBLIC_BASE_URL`, complete configuration and redeploy. Startup with missing
settings intentionally fails safely. Do not disable validation to get green status.

In Stripe's **test/sandbox** dashboard create a webhook destination with that
URL plus `/api/stripe/webhook`. Subscribe to the events handled by this app:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
payment_intent.payment_failed
refund.created
refund.updated
refund.failed
charge.refunded
```

Copy **that endpoint's** signing secret into Render. Save settings and deploy
the latest commit. Startup validates configuration, waits for PostgreSQL, runs
migrations and starts the app. Inspect logs privately; don't post connection
URLs or credentials in screenshots or issues.

## 4. Verify and submit

- [ ] HTTPS loads; `/api/ready` succeeds against the deployed database.
- [ ] Admin login requires MFA.
- [ ] Add sample catalog entries with correct prices/stock. Demo seeding is off.
- [ ] Verification and password-reset messages reach your mailbox.
- [ ] Customer login, search, cart and a sample COD order work.
- [ ] Seller shipment updates appear in customer tracking.
- [ ] Stripe test checkout, signed webhook confirmation and test refund work.
- [ ] Record the live URL and dated results in `SUBMISSION.md`, then submit
      through the institution's official form.

Never expose the local preview fixture publicly or accept live charges for this
assessment demo. Passing local tests does not complete the checks above.

## Free-plan constraints

Render Free sleeps after inactivity; the first visit can be slow. Background
email retries and scheduled work pause while it sleeps. Local uploads disappear
on restarts/redeploys: use committed sample assets or durable external image
URLs for the demo, with persistent records in Neon. Continuous background work
and durable runtime files require a different hosting arrangement.

Neon has storage/compute limits and Brevo has sending quotas and account/sender
approval. Monitor usage and review the dashboard's plan terms before creating
resources. Free plans do not guarantee unlimited usage or uninterrupted service.

Official references reviewed 2026-10-04:
[Render Free](https://render.com/docs/free),
[Blueprint settings](https://render.com/docs/blueprint-spec),
[Neon connection guide](https://neon.com/docs/connect/connect-from-any-app),
[Brevo email API](https://developers.brevo.com/reference/send-transac-email).
