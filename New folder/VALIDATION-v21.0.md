# v21.0 local validation

Final browser review and packaging: 25 September 2026.

- Full local regression run: **87 passed, 0 failed, 0 skipped**.
  Evidence: `validation/npm-test-v21.0.txt`.
- Chromium 131 visual review: **14 views**, no recorded page errors, missing local
  assets or horizontal overflow. Evidence: `preview/forma/visual-report.json`.
- **10 interaction checks passed**, covering all 60 sample products/load more,
  search beyond the first 48, favourites keyboard behavior, bag quantity/pricing,
  mobile checkout and local COD order creation, customer sign-in/mobile menu,
  product variants/tabs/cart, support submission, seller application, admin
  session/editor/reload, and public layouts at 320/390/768/1440 pixels.
  Evidence: `preview/forma/interaction-report.json`.
- Final desktop/mobile homepage captures confirmed all four deal images loaded,
  with zero horizontal overflow. Evidence: `preview/forma/final-checks.json`.
- UI corrections following review include mobile deal-card layout, product action
  placement, login input rounding, admin chart scaling and honest empty-review
  labels. Final browser checks include these corrections.

The 87-test run preceded the last presentation-only CSS/review-label refinements;
the final browser checks followed them. JavaScript syntax was checked. Testing
used local HTTP, an isolated PGlite schema and provider fixtures, with no real
payments or external email. This is not a live-provider acceptance report.

Production hosting, domain/HTTPS, real provider credentials and account-specific
integration acceptance remain subject to `DEPLOYMENT-v20.1.md` and
`INTEGRATIONS-v20.0.md`. Supplier payment/cancellation/tracking automation is not
included. Historical validation documents remain with their original versions.
