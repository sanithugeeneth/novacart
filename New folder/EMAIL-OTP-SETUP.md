# Admin email OTP setup

Admin email/password -> Send email code -> six-digit mailbox code -> workspace.
Your existing TOTP mode remains until you explicitly enable email mode.

Keep your existing `.env` admin and database settings. For Gmail, edit the SMTP
entries (replace all placeholders privately):

```env
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

Stop NovaCart, then run from the project folder:

```powershell
npm.cmd run db:migrate
npm.cmd run mfa:email
npm.cmd start
```

`mfa:email` checks SMTP connection/authentication without sending an email. It
sets `ADMIN_MFA_REQUIRED=true` and `ADMIN_MFA_METHOD=email` only after a successful
check. It preserves the authenticator key. Open `/admin.html` and hard refresh.
Codes go to the authenticated admin account's stored email, not a separate
supplied destination. Check inbox/spam and use the code in the same browser.

Existing account password changes in `.env` require `npm.cmd run db:seed-admin`.
On a hosted server, configure SMTP and both ADMIN_MFA fields in its environment
settings, migrate and restart; the local helper does not configure the host.

Codes expire after 10 minutes, are single-use and allow five failed attempts.
Resend cooldown is 60 seconds. Existing IP authentication limits also apply.
SMTP failure cannot grant access. Codes are not saved in plaintext or echoed by
the API. A cookie binds each challenge to the requesting browser. Persistent
challenge rows and transactions prevent concurrent reuse. `mfa:setup` explicitly
switches back to authenticator mode. Do not disable verification to fix delivery.
Real inbox delivery requires your SMTP account and is not verified by fixtures.
