# NovaCart backend source guide

[Back to project README](README.md)

The backend runs on Node.js with Express and PostgreSQL. It serves the frontend and JSON API from one origin.

## Source map

| Area | Source |
| --- | --- |
| API/server entry point | [server.js](New%20folder/server.js) |
| Dependencies and commands | [package.json](New%20folder/package.json) |
| Database schema | [schema.sql](New%20folder/schema.sql) |
| Local startup | [launch-dev.js](New%20folder/scripts/launch-dev.js) |
| Production startup | [launch-prod.js](New%20folder/scripts/launch-prod.js) |
| Migrations | [migrate.js](New%20folder/scripts/migrate.js) |
| Readiness/configuration validation | [readiness.js](New%20folder/services/readiness.js) |
| Admin email MFA | [admin-email-otp.js](New%20folder/services/admin-email-otp.js) |
| Seller products | [seller-products.js](New%20folder/services/seller-products.js) |
| Shipment projection | [customer-shipments.js](New%20folder/services/customer-shipments.js) |
| Refunds | [refunds.js](New%20folder/services/refunds.js) |
| Payout accounting | [payouts.js](New%20folder/services/payouts.js), [payout-refunds.js](New%20folder/services/payout-refunds.js) |
| Optional provider integrations | [services](New%20folder/services/) |
| Automated tests | [tests](New%20folder/tests/) |

## API orientation

| Method / path | Purpose |
| --- | --- |
| GET /api/health | Application health |
| GET /api/ready | Database/application readiness |
| GET /api/products | Catalog search and pagination |
| GET /api/products/:id | Product details |
| POST /api/auth/register | Customer registration |
| POST /api/auth/login | Customer authentication |
| GET /api/auth/me | Current authenticated account |
| GET /api/auth/csrf | CSRF token for authenticated requests |
| POST /api/checkout | Checkout and order creation |
| GET /api/orders | Current customer's orders |
| GET /api/orders/:id/shipment | Customer shipment information |
| POST /api/admin/login | Admin authentication and MFA flow |
| GET /api/admin/products | Admin catalog |
| GET /api/seller/orders | Approved seller orders |
| PATCH /api/seller/orders/:id | Seller fulfillment update |

This is a route orientation, not a complete API contract. See route handlers and tests for request schemas, CSRF/session requirements and role checks. Do not call protected routes by bypassing authentication.

## Run, database and tests

Follow the [README PostgreSQL setup](README.md#run-with-postgresql). The frontend and backend run together on the configured port. Local defaults use PostgreSQL on loopback port 55433 and the application on port 3000.

Keep actual environment settings in a private `.env` or hosting secret settings. The committed example is a template, not working production credentials. The admin seed command can reset an existing admin password; do not run it on an existing deployment merely to review the project.

Use the [README verification commands](README.md#verification). Local fixtures simulate external services. Live Stripe, SMTP, OAuth and supplier acceptance have not been certified by these tests.

## Deployment and limitations

The [root deployment template](render.yaml) is configured for this repository's nested source directory. Production startup checks configuration, waits for the database, migrates the schema, then starts the server. Required private settings must be supplied first.

Supplier payments and some cancellation operations remain manual/provider-dependent. Payout workflows track balances and requests; external money transfer is separate. Use sample data and test-mode transactions for assessment.

For the certificate's backend GitHub field, this guide links the actual backend source in the shared repository. See [submission status](SUBMISSION.md) for the live URL and review progress.
