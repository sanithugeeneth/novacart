# Admin email OTP setup

Admin email/password -> Send email code -> six-digit mailbox code -> workspace.
Your existing TOTP mode remains until you explicitly enable email mode.

Keep your existing `.env` admin and database settings. Choose one mail provider.

## Brevo HTTPS (for Render Free)

Render Free blocks outbound SMTP ports. Use the HTTPS transport instead:

```env
MAIL_PROVIDER=brevo
BREVO_API_KEY="YOUR-BREVO-API-KEY"
MAIL_FROM="NovaCart <your-verified-sender-address>"
```

Create a Brevo account, complete its transactional-email activation and verify
the sender in Brevo before using that address. Add a private **API key**, not an
SMTP password. SMTP variables are unnecessary in this mode. Sender/domain
approval and the plan's sending limits still apply. Authentication alone does
not prove inbox delivery. Test a code to your own admin mailbox after setup.

The adapter uses `GET /v3/account` for authentication and `POST /v3/smtp/email`
for delivery. Requests have a 20-second timeout, reject redirects and hide
provider response details in errors. A successful response must include a
message ID. Queued messages retry failed sends; a network timeout after provider
acceptance can still cause duplicate delivery. There is no exactly-once promise.

References: [Brevo API](https://developers.brevo.com/reference/send-transac-email),
[account authentication](https://developers.brevo.com/reference/get-account),
[Render Free limits](https://render.com/docs/free).

## SMTP (hosts allowing outbound SMTP)

For Gmail, edit the SMTP
entries (replace all placeholders privately):

```env
MAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-account@gmail.com
SMTP_PASS="YOUR-GOOGLE-APP-PASSWORD"
MAIL_FROM="NovaCart <your-account@gmail.com>"
SMTP_REQUIRE_TLS=true
```

Gmail App Passwords require Google Account 2-Step Verification. Create one at
https://myaccount.google.com/apppasswords if available for your account. Use that
App Password for SMTP_PASS. Organization policy/Advanced Protection may restrict
availability; use another supported SMTP service if necessary.
Official setup references:
https://support.google.com/mail/answer/185833?hl=en
https://support.google.com/mail/answer/7104828?hl=en

## Enable admin email OTP

Stop NovaCart, then run from the project folder:

```powershell
npm.cmd run db:migrate
npm.cmd run mfa:email
npm.cmd start
```

`mfa:email` checks the selected provider's authentication without sending an email. It
sets `ADMIN_MFA_REQUIRED=true` and `ADMIN_MFA_METHOD=email` only after a successful
check. It preserves the authenticator key. Open `/admin.html` and hard refresh.
Codes go to the authenticated admin account's stored email, not a separate
supplied destination. Check inbox/spam and use the code in the same browser.

Existing account password changes in `.env` require `npm.cmd run db:seed-admin`.
On a hosted server, configure the mail provider and both ADMIN_MFA fields in its environment
settings, migrate and restart; the local helper does not configure the host.

Codes expire after 10 minutes, are single-use and allow five failed attempts.
Resend cooldown is 60 seconds. Existing IP authentication limits also apply.
Mail delivery failure cannot grant access. Codes are not saved in plaintext or echoed by
the API. A cookie binds each challenge to the requesting browser. Persistent
challenge rows and transactions prevent concurrent reuse. `mfa:setup` explicitly
switches back to authenticator mode. Do not disable verification to fix delivery.
Real inbox delivery requires your provider account and is not verified by fixtures.
