# NovaCart Business Launch v17.0.2

This release consolidates the application-side business launch improvements into one package.

## Application upgrades
- Dynamic coupon validation from the database; checkout no longer depends on one hard-coded coupon.
- Server-backed wishlist endpoints for logged-in customers.
- Recommendations endpoint based on related category/brand and popularity.
- Broader product search across title, description, category, brand and search keywords.
- Admin seller approval operations.
- Internal seller payout ledger generation and admin status controls.
- Admin product Q&A moderation.
- Marketplace operations area in the admin UI.
- Local Docker PostgreSQL host port defaults to 5433 to reduce collisions with existing PostgreSQL containers.

## Not automatically live from source code
Live Stripe credentials/webhook, SMTP and domain authentication, managed PostgreSQL/PITR, courier API contracts, external seller payout processor, object storage/CDN, real catalogue/inventory, tax/legal policies, monitoring and independent security testing still require the business owner's accounts/configuration and real-world verification.

## Local run
`docker compose up -d db`
`npm run db:migrate`
`npm run db:seed-admin`
`npm start`
