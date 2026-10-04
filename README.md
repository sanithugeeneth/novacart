# NovaCart — Full-stack E-commerce Assessment Project

NovaCart is a full-stack shopping and seller-management project. The checked-in application version is **21.9.0**.

## Assessment links

| Requirement | GitHub entry point |
| --- | --- |
| Frontend code and explanation | [Frontend source guide](FRONTEND.md) |
| Backend code and explanation | [Backend source guide](BACKEND.md) |
| Complete application source | [New folder](New%20folder/) |
| Submission progress and live acceptance | [Submission checklist](SUBMISSION.md) |

**Frontend and backend share this repository.** The browser pages, API server, database schema and tests are delivered together. These guides identify the actual source files; they are not separate deployed applications. If the assessment requires two separate repositories, confirm that requirement with the reviewing team.

**Live website: not deployed or verified yet.** A deployment configuration is not a live website link.

## Project overview

- Customer storefront, product search/pagination, product details, cart and checkout.
- Customer accounts and order tracking.
- Seller product/stock management, orders, shipment updates and payout requests.
- Admin catalog, inventory, order, seller and support management.
- Responsive HTML/CSS/JavaScript interface with motion preferences.
- Express API, PostgreSQL storage, session authentication and admin MFA.

External payment, email, OAuth and supplier features need their own provider configuration and verification. Seller payout records do not send bank transfers.

## Technology

| Layer | Implementation |
| --- | --- |
| Frontend | HTML, CSS and browser JavaScript |
| Backend | Node.js 22+ (24 recommended), Express 5 |
| Database | PostgreSQL 17 in the supplied Docker configuration |
| Tests / local preview | Node test runner, PGlite and jsdom |
| Optional integrations | Stripe, SMTP/Brevo email, Google/Apple OAuth and supplier adapters |

## Quick local demonstration

Install Node.js 22+ and Git, then run:

```bash
git clone https://github.com/sanithugeeneth/novacart.git
cd "novacart/New folder"
npm ci
npm run preview:ui
```

This repository is public; no invitation is needed to view or clone it. Open the exact local URL printed in the terminal. The preview prints temporary customer, seller and admin account details.

This preview uses an isolated temporary database and sample products. It simulates provider behavior; it does not send real payments or emails. Use cash on delivery for a sample checkout. Data resets when the process restarts. Stop it with Ctrl+C. **Do not expose this test-fixture server to the internet.**

On Windows PowerShell, use `npm.cmd` in place of `npm` if script execution policy prevents npm from running.

## Run with PostgreSQL

Use a new local database for assessment. Install Docker with Compose and start Docker before running these commands.

1. Enter `New folder` and install dependencies with `npm ci`.
2. Copy `.env.example` to `.env`: use `Copy-Item .env.example .env` in PowerShell, or `cp .env.example .env` in a POSIX shell. Do not overwrite an existing private configuration.
3. Edit `.env` locally. Keep `NODE_ENV=development` and `PUBLIC_BASE_URL=http://localhost:3000`. Set your own admin email and a unique password with at least 12 characters, a letter, number and symbol. Keep the database URL consistent with the database credentials.
4. Run:

```bash
docker compose up -d db
npm run db:wait
npm run db:migrate
npm run mfa:setup
npm start
```

The MFA setup command prints a private authenticator enrollment key on first setup. Enroll it in your authenticator and keep it out of screenshots and submissions. Startup creates the configured admin if it does not already exist. Existing accounts are preserved by default.

Open `http://localhost:3000`; use the Admin tab on the login page for admin authentication. For provider-backed admin email OTP, follow [Email OTP setup](New%20folder/EMAIL-OTP-SETUP.md).

## Verification

From `New folder`:

```bash
npm run test:ci
```

The [NovaCart tests workflow](https://github.com/sanithugeeneth/novacart/actions/workflows/test.yml) runs this command on pushes and pull requests to `main`, using Node.js 24 and isolated fixture databases. It needs no production secrets or live provider accounts. Open a workflow run to inspect the actual result; adding the workflow alone does not mean it passed.

For a running PostgreSQL-backed server, in a second terminal:

```bash
npm run smoke
```

Automated test success does not prove live email delivery, live payment processing or hosting availability. Historical results and screenshots are in [validation](New%20folder/validation/) and [preview](New%20folder/preview/). They are not a new deployment acceptance result.

## Deployment

For the assessment, follow [free deployment setup](FREE-DEPLOYMENT.md): Render Free + external Neon Free + Brevo HTTPS email. The opt-in [render.free.yaml](render.free.yaml) creates no paid database. Provider credentials and live acceptance remain pending.

The [root render.yaml](render.yaml) points Render to `New folder`, uses `npm ci --omit=dev`, starts `npm run start:prod`, and checks `/api/ready`.

The template provisions **paid** web/database resources if applied. Review the provider's current total before creating resources. Automatic deployment is off. There is no approved hosting purchase or completed deployment recorded here.

Production startup requires HTTPS, database access, business/contact settings, a strong private admin password, admin MFA, a configured email provider and Stripe configuration. Stripe test keys can support an assessment deployment, but no real customer charges should be accepted for the demo. Never use fake credentials to make readiness checks appear complete.

See [deployment instructions](New%20folder/DEPLOYMENT-v20.1.md). Keep passwords, database URLs and provider keys in private hosting settings, not in this repository.

## Review access and submission

This repository is public. Reviewers can view the source without an invitation. The [commit history](https://github.com/sanithugeeneth/novacart/commits/main/) preserves the original commits and records subsequent changes.

Follow [SUBMISSION.md](SUBMISSION.md) to record the live URL and acceptance results when they exist. Approval and certificate issuance are controlled by the reviewing organization.
