# NovaCart 20.1 validation

Validated locally on 20 September 2026. This is a code and fixture validation report, not a live deployment certificate.

## Automated checks

Full `npm test`: **87 passed, 0 failed, 0 skipped**. Output: `validation/npm-test-v20.1.txt`.

| Coverage | Tests | Result |
|---|---:|---|
| Prior UI, security, payments, sellers, forms, payouts, catalog and provider integration regressions | 71 | Pass |
| Refund reservations, replay, concurrent clicks, response loss, reconciliation, async success/failure and authorization | 7 | Pass |
| Email verification/reset, retry/concurrent workers and paid-order confirmation | 3 | Pass |
| Configuration generation/redaction, readiness permissions, production startup and SMTP policy | 6 | Pass |

After the full run, the refund suite was repeated with the final input-type validation and additional malformed-amount cases: **7 passed**, recorded in `validation/refunds-final-v20.1.txt`. Readiness details are also recorded in `validation/readiness-v20.1.txt`.

The tests use the actual Express application, signed Stripe webhook fixtures and the real schema applied twice to isolated PGlite databases. Provider requests and email delivery are simulated. Tests do not send external email, create real charges or buy supplier products.

The configuration generator was tested for unique random secrets, 0600 permissions, dollar/hash literal preservation, apostrophes in ordinary addresses, and refusal to overwrite existing credentials. The CLI was exercised as a subprocess. Production application startup was run with an injected database/configuration and mock mailer, confirming that no demo products are seeded. This does not validate a real SMTP connection or container startup.

## Browser checks

Chromium 131, local HTTP and isolated sample data:

- Unauthorized access shows an admin sign-in instruction.
- Authenticated launch page shows all eight configuration groups and migration state.
- Refresh updates the report; 390px layout has no horizontal overflow.
- Desktop/mobile screenshots were inspected: `preview/NovaCart-Launch-Setup.png` and `preview/NovaCart-Launch-Setup-Mobile.png`.
- Invalid refund input sends no provider request.
- Partial refunds leave a remaining-refund action available.
- A lost provider response is retried using the persisted request after a page reload; no second transfer is created.
- No uncaught browser exceptions in those flows.

The browser report is `preview/launch-browser-report.json`. Older preview screenshots/reports in the archive are historical v20.0 evidence.

## Deployment checks and limits

Both Compose YAML files parsed successfully. Production services are `db`, `app`, `proxy`; the database/app have no published host ports, while Caddy exposes HTTP/HTTPS. The development stack binds its ports to localhost. Docker is not installed in the workspace: no image build, container startup, certificate issuance or real PostgreSQL-server restore was performed. Those checks remain on the target host.

Private configuration, deployment files and service source paths were confirmed inaccessible through HTTP. Admin readiness requires the existing admin/MFA checks and uses `Cache-Control: no-store`; the report does not return secret values.

Outstanding external acceptance: hosting and HTTPS, actual PostgreSQL deployment/backup restoration, live Stripe and email flows, real Google/Apple callbacks, billed Vision recognition, approved Amazon/AliExpress operations and the AliExpress API contract for the user's account. Supplier funding, cancellation and tracking synchronization are still manual/not implemented as automatic provider operations. No completion percentage is inferred from the test count.
