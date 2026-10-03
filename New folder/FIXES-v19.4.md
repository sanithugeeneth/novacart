# NovaCart v19.4 — Seller payouts and complete catalog browsing

This release builds on v19.3. Earlier MFA, Stripe confirmation, seller access/checkout, signature design and form fixes are retained.

## Payout calculation

Only orders with a confirmed `paid` payment status and a payment timestamp can enter a new payout. Unpaid, failed, cancelled, refunded, partially refunded and uncollected COD orders are excluded. Pending refunds and open returns are withheld for reconciliation. Seller earnings exclude shipping and tax. Order discounts are allocated once across sellers/platform merchandise in integer cents; the stored seller commission proportion is then applied.

Each payout has permanent order allocations in `seller_payout_items`. A database primary key prevents allocating one seller/order pair twice, even across overlapping date ranges. A unique index prevents multiple new payout records for the same seller and period. Requests for an existing period return its existing payout ID and status. Mutations use a transaction and lock the seller row before reading allocations. These choices follow PostgreSQL's [row-locking rules](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS) and [constraint semantics](https://www.postgresql.org/docs/17/ddl-constraints.html).

Payouts are snapshots, not a continuously changing period balance. An order that becomes paid after a snapshot can be included in a later or broader period; previously allocated orders are skipped. Failed payouts retain their allocations: retry the same record instead of generating another payment for the same orders.

Before an administrator records a payout as paid, the server checks its order payment/refund/return states and all stored amounts again. A paid payout cannot be reopened or failed. The admin payout control requests the reference of the completed transfer. This remains an internal ledger; no bank or seller transfer is sent by the application.

For COD, a delivered order is not assumed to be paid. The admin Orders screen now offers **Record COD collection** for delivered, uncollected COD orders. Enter the receipt reference only after collection; that records payment and makes the order eligible. The action requires an authenticated administrator and CSRF validation.

### Existing records and later refunds

The migration does not delete or rewrite old payout amounts. Older rows have `ledger_version=0`, because their order allocations cannot be reconstructed reliably from the previous aggregates. New generation is blocked for periods overlapping an unresolved old payout. An incorrect old unpaid record can be marked failed after review, then replaced by a verified calculation. Previously paid records remain paid and must be reconciled against actual transfers; they cannot be silently reset. Old unverified rows are excluded from the available-payout summary.

A refund or return that changes a recorded paid payout blocks further generation for that seller until reconciliation. This release does not infer which seller should absorb an ambiguous partial refund, automatically recover transferred funds, or invent historical allocations. Keep an accounting review for those cases.

## Catalog pagination and search

- The storefront requests pages of 12 from the server. Load more requests the next page until the API total is reached; the old 48-product download ceiling is gone.
- Search, categories and sorting run against all active products. The new categories endpoint returns categories from the entire active catalog.
- Every sort includes a product-ID tie breaker so equal-ranked products have a deterministic page order.
- Changing the search/filter/sort resets pagination. Requests are cancelled/versioned so a slower old response cannot replace a newer search.
- Loading and retry states prevent duplicate next-page requests and keep already loaded products after a temporary error.
- Saved cart and wishlist products load their own details, even when absent from the initial page. Changing a search does not erase their prices or titles.

## Verification

Run `npm test` for the complete regression suite, or `npm run payout-catalog:check` for this release's focused tests. The catalog tests execute the actual storefront script and DOM event handlers against the HTTP server and a 105-product database, including items beyond the old limit, stale responses, retry and saved carts.

See `VALIDATION-v19.4.md` for the recorded results and testing boundaries. Database migration is required before starting this version; follow `START-HERE-v19.4.txt`.
