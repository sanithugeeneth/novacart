# Admin and seller currency display — v21.5

Operational screens now format amounts using the configured store currency or
an individual transaction's original currency. A shared `workspace-money.js`
formatter displays explicit codes such as **LKR 1,250.00**, **USD 1,250.00** and
**EUR 1,250.00**. It never guesses USD when configuration is missing.

| Surface | Currency source |
| --- | --- |
| Admin revenue, charts, analytics, customer lifetime value | Configured store currency; foreign-currency records excluded from these monetary totals |
| Admin/seller product prices, variants and price editors | Configured store currency, matching the existing single-currency checkout contract |
| Coupons and minimum subtotal | Configured store currency |
| Orders, line items and returns | Original order currency |
| Refund details | Refund currency, falling back to the associated order currency |
| Individual payout records | Original payout currency |
| Seller recorded-payout summary and refund balance | Current store currency only |

Record counts in overview/customer lists still include all currencies. Analytics
counts are for the current currency and selected date window. Historical foreign
orders and payouts remain visible with their original codes. No amounts, historic
transactions or stored product prices are converted or rewritten. Changing a
store's currency is not a foreign-exchange conversion or automatic repricing.
Catalogue currency metadata returned to these screens now agrees with checkout,
including old products that still have the schema's default USD metadata.

The admin loads store configuration before rendering monetary values. Initial
placeholders use an em dash. A failed configuration request shows an error with
refresh guidance; the seller workspace remains hidden until currency is known.
Product/variant editors, coupon inputs and refund prompts identify the currency.

## Upgrade

Back up the database, stop the old app, replace source and static files together
(including `workspace-money.js`), preserve private configuration, and restart.
Use `CURRENCY=LKR` for a rupee store and hard refresh the admin/seller pages.
No schema change is introduced after v21.3; older installations still require the
cumulative `npm run db:migrate`. Deployment guidance: DEPLOYMENT-v20.1.md.

The isolated `npm run preview:ui` command now reads the CURRENCY environment
variable. Its sample prices are illustrative numbers, not exchange-rate-adjusted
retail prices. Real provider keys and live data are not used by this preview.

## Validation

**Full regression: 137 passed, 0 failed, 0 skipped.**

Six new regression tests cover the shared formatter, old catalogue metadata,
mixed-currency revenue/customer analytics, historical orders, payout summary
separation and static assets. The admin UI test harness loads the same shared
formatter as the shipped page.

Chromium checks use both LKR and USD stores, including USD/EUR historical records.
They verify admin overview, order drawer, products/editor/variants, customer value,
payouts, coupons and analytics; seller catalogue/editor/variants, orders and payout
balances/history; configuration failure; and 320/390/768/1440px layouts. Evidence:
`preview/currency/browser-report.json`, its screenshots, and
`validation/currency-browser-v21.5.txt`. Tests use sample PGlite data with a
simulated paid order. No real charges or transfers were made; live deployment,
provider acceptance and real PostgreSQL contention testing are not claimed.

The v21.4 seller dashboard, tracking/payment guards and v21.3 refund recovery are
retained. This fix targets the admin/seller operational screens; it does not claim
that every unrelated business feature is complete.
