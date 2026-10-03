# NovaCart 20.0 validation

The combined release preserves the v19.1–v19.4 fixes, replaces the presentation layers with Atelier, and adds optional provider integrations. Validation was performed locally on 19 September 2026. This is not a production acceptance certificate.

## Automated results

`npm test`: **71 passed, 0 failed, 0 skipped**. The captured output is `validation/npm-test.txt`.

| Coverage | Tests | Result |
|---|---:|---|
| Existing security, Stripe payment, seller, forms, payout and catalogue regressions | 48 | Pass |
| Admin session restoration, charts and editor behavior | 2 | Pass |
| Google/Apple OAuth, tokens, state, linking and admin restrictions | 6 | Pass |
| Image-byte validation, real recognition request contract, catalogue matching and request limits | 4 | Pass |
| Supplier import/sync, checkout restrictions, forwarding, idempotency and reconciliation | 11 | Pass |

The OAuth suite was run again after extending its Apple case to cover both provider RSA and P-256 signature verification: **6 passed** (`validation/oauth-test.txt`).

The database harness applies the actual PostgreSQL schema twice in isolated PGlite instances to exercise idempotent migration. HTTP requests use the real Express application. Provider calls use fixtures; OAuth JWTs are cryptographically signed and verified, and payment fixtures use Stripe webhook signatures. No live provider keys, customer accounts or production database are involved.

## Browser results

Chromium exercised the server-rendered HTML/CSS and browser JavaScript against a local HTTP application:

- Catalogue pagination and search beyond the first 48 products; grid/list and category changes.
- Product variants, quantity, tabs, bag and saved favorites; dialog focus trap, Escape and focus return.
- Customer login, mobile checkout, support ticket and seller application submission.
- Admin session restoration, charts, the full catalogue, and explicit product/media editor opening.
- Configured Google button → browser-bound OAuth callback → connected customer account, using a provider fixture.
- Photo selection and consent → image analysis request → recognized-object product results.
- Supplier preview/import/sync → paid-order preview → one confirmed fulfillment request and ledger update, using provider fixtures.

The checked public layouts at 320/390/768/1440 px and supplier layouts at 320/390/1440 px had no document-level horizontal overflow. Wide admin tables intentionally scroll within their own containers. Recorded browser runs had no JavaScript page errors. The initial page-family run found no missing static assets; the later integration run refreshed the admin screenshots after chart/editor fixes.

Evidence is in `preview/visual-report.json`, `preview/interaction-report.json`, `preview/integrations-browser-report.json`, and the included screenshots. Preview products, provider responses and people/account details are test data. Screenshots demonstrate the layout; they do not demonstrate provider approval or real sales.

## Still required for live use

- Install the database migration and configure production hosting/database/security settings.
- Register and configure Google/Apple applications and verify their real callback flows.
- Activate/configure Cloud Vision and verify a real image-analysis request.
- Authorize the Amazon seller/MCF application and verify inventory, destination and fulfillment access.
- Verify the exact AliExpress method/protocol entitlement against your approved app. Accessible schema documentation is legacy; the current account-specific API contract and live order flow were not verified. Supplier order creation does not pay the supplier.

See `INTEGRATIONS-v20.0.md` for supported behavior, configuration, operating limits, recovery from uncertain outcomes and provider documentation. Live sign-in, provider billing, supplier payment/shipping, provider cancellation and shipment synchronization were not completed or claimed by these local tests.
