# Customer shipment tracking — v21.2

## Fixed behavior

Seller status/tracking previously stayed in `seller_orders`; the customer endpoint
read only parent-order tracking, and the customer page displayed only shipment
events. The customer view now reads the seller allocations directly, including
already-existing tracking. No duplicate tracking storage or backfill is needed.

- Seller **Recent orders** includes status, courier and tracking fields with a
  Save shipment action. Server-side payment, ownership and CSRF checks remain.
- Customer **Orders → Tracking** displays each seller/store shipment, its items,
  status, courier, tracking number and last update time.
- **Refresh tracking** reads current data. There is no background push service or
  external courier polling; these are updates supplied by the seller/store.
- Account order history shows current fulfillment and links to the selected
  order's tracking panel.
- Multiple sellers keep independent tracking numbers. Partial dispatch displays
  **Partially shipped**, and full dispatch requires all included shipments.
- Mixed seller/store orders keep platform tracking separate. Existing admin
  shipment events remain under Order updates. Missing tracking is stated plainly.
- Seller-provided strings are escaped and displayed as text; they are not turned
  into arbitrary executable HTML or external tracking links.

## API and data model

`GET /api/orders` adds `fulfillmentStatus`, `canCancel` and `shipments` to each
customer-owned order. `GET /api/orders/:id/shipment` adds the same fields alongside
its existing `order` and `events`. Shipment entries expose only customer-relevant
fields and item summaries; seller commission, internal owner IDs and business
contact records are not included. Both responses use private/no-store caching.
The service batches allocation/item reads for the order list.

The administrative parent `order.status` and payment fields remain separate from
per-seller fulfillment. The customer pages explicitly render `fulfillmentStatus`.
Cancellation/refund/delivery terminal states take precedence in the summary;
recorded shipment details remain visible. No seller can overwrite another seller's
tracking or set the entire order's payment status.

Seller PATCH requests preserve tracking/courier when those fields are omitted.
Explicit corrections appear on the next customer read and are included in the
transactional audit record. A rejected or rolled-back request creates no visible
tracking change. The v21.1 unpaid/refund/closed-order checks remain active.

Because a parent COD order may still be `placed` while a seller has dispatched its
part, customer cancellation now checks seller allocations while holding the
parent order lock. Packed/shipped/delivered allocations prevent cancellation and
accidental inventory restoration. Rejected cancellation paths roll back before
releasing the database connection.

## Verification — 26 September 2026

- Full local regression suite: **107 passed, 0 failed, 0 skipped**.
  Evidence: `validation/npm-test-v21.2.txt`.
- Targeted tracking + payment-guard suite: **20 passed** (10 new tracking tests).
  Evidence: `validation/customer-tracking-v21.2.txt`.
- Real Chromium browser checks: **7 flows passed**, covering seller desktop/mobile
  form submission, independent multi-seller details, customer refresh/corrections,
  escaped seller input, recoverable read errors, keyboard disclosure behavior,
  account deep links and responsive views at 320/390/768/1440 pixels.
  Evidence: `preview/tracking/browser-report.json` and its three screenshots.
- Existing support/seller application form tests also pass after retaining the
  seller script's initialization order. JavaScript syntax checks passed.

Validation uses actual local HTTP routes, the real schema in isolated PGlite and
provider fixtures. No live courier, payment, email or production deployment is
claimed. Earlier Forma and payment-guard reports are retained as historical
version-specific evidence.

## Installation

No new database migration is introduced relative to v21.1. Preserve existing
private configuration/data and deploy the complete code/static asset update,
including `orders.js` and `services/customer-shipments.js`, then restart the app.
For upgrades from older versions, follow the cumulative migration guidance in
`DEPLOYMENT-v20.1.md`. Use `npm run preview:ui` for temporary local sample data.

This release does not implement automatic courier scans, supplier tracking import,
or the remaining product-management/payout-reconciliation work from the audit.
