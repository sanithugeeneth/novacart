# NovaCart v21.3 — Refund recovery after seller payouts

This release fixes the seller-wide 409 caused by revalidating a previously paid
payout after its order was refunded. Paid payout amounts, dates and transfer
references are preserved. The refundable seller earnings become a separate debit,
which is deducted from later eligible payouts.

## How to use

1. Install this release and run the schema migration before serving requests.
2. Seller center → Your payouts → Refresh refund balance records confirmed refunds
   and shows recovered, reserved and carried-forward balances. Generation also
   reconciles automatically; a separate refresh is optional.
3. Select a period and Generate payout. The result shows earnings after commission,
   refund deduction and net transfer. Choose a new period/range for newly eligible
   orders; repeating the exact same period returns the existing record.
4. Admin → Payouts → Reconcile refunds refreshes the selected payout and displays
   its updated net amount and source-order adjustments. Reconcile both existing
   paid records (to discover recovery) and unpaid records (to apply recovery).
5. Record a payout as paid only for the reviewed net amount and with the reference
   of a completed external transfer. This application does not send seller funds.

If new confirmed refunds appeared after an unpaid payout was generated, recording
its old transfer amount is rejected. Reconcile it first and review the new amount.

## Example

A seller received 90.00 net earnings from an order. That order was then fully
refunded. Their next period earns 36.00 after commission:

- Original paid payout remains 90.00.
- Refund recovery debit: 90.00.
- Next payout: earnings 36.00, deduction 36.00, transfer 0.00; status `settled`.
- Remaining recovery balance: 54.00.
- A later 90.00 payout deducts 54.00 and leaves a 36.00 transfer.

`settled` means the earnings were entirely used as refund offsets. It is a
terminal internal settlement, not a zero-value bank transfer. It cannot be
reopened or marked paid. If an order in that settled payout is later refunded,
its original net earnings also become a new recovery debit.

## Amount rules

- Only verified version-1 payout allocations in `paid` or `settled` records create
  automatic recovery. Pre-v19.4 version-0 history has no reliable allocation map
  and continues to require manual accounting review.
- Successful refund amounts are summed per order; pending, unknown-submission,
  failed, canceled and requires-action refunds do not debit completed payouts.
- The cumulative seller debit in cents is
  `floor(original seller net cents * successful refund cents / original order total cents)`.
  Full refunds recover the entire original net. Debit is capped at that net.
- Original seller net already includes the allocated order discount and excludes
  commission. The denominator includes the customer's shipping/tax. With no
  item-targeted refund data, partial order refunds are shared proportionally
  across seller entitlements and the platform portion. This is an explicit
  order-level policy, not an item-specific return allocation.
- Fractional cents round down per seller from the cumulative refund total.
  This avoids repeated rounding and overcharging sellers; the platform retains
  the fractional-cent difference until subsequent refunds/full refund resolve it.
- A trusted historical `payment_status=refunded` recovers full net even if old
  provider refund rows are unavailable. Missing partial-refund amounts cannot be
  inferred and require review. Recorded successful refund debits are monotonic;
  corrections/write-offs/direct seller repayments are not automated here.
- Different currencies never share offsets. Existing two-decimal currency
  accounting is retained.

## Reservations, failures and holds

An available payout reserves its deductions so overlapping periods, duplicate
requests and other payouts cannot deduct the same amount twice. An ordinary
failed transfer retains those reservations for a retry of the same payout.

If an unpaid payout's own orders become ineligible (refund, pending return,
changed payment or inconsistent allocation), reconciliation places it in failed
review state, releases its reserved refund offsets, and writes a reason. Other
eligible payouts can then recover that debt. That invalid payout's original order
allocations remain held to prevent duplicate payment. It cannot be paid until
its underlying order/accounting issue is resolved; this release does not infer a
new payable amount for an order refunded before its first payout.

With debt but no new eligible orders, generation returns a balance-only response
and creates no empty payout. No negative transfer is generated. If no future
seller earnings arrive, the remaining debt stays visible; no external collection
or bank debit is attempted. Normal invalid-input, authentication and no-eligible-
orders errors still exist; this fix does not suppress legitimate 409 responses.

## Database and transaction changes

- New `seller_payout_refund_adjustments` table: one cumulative recovery record per
  seller/order, linked to the original payout allocation.
- New `seller_payout_refund_offsets` table: source-order deductions reserved or
  settled by a target payout.
- Reuses `seller_payouts.refund_amount` for the refund deduction and adds
  `settled_at`, `reconciliation_note`, and the terminal `settled` status.
- Changes are additive apart from expanding the existing payout status constraint;
  previous paid totals are not backfilled or rewritten. Reconciliation reads
  existing refund history on demand.
- Seller ledger mutex, ordered parent-order row locks, unique allocations, integer
  cent calculations and transaction-local audit writes protect the mutations.
  Audit failure rolls back the debit, offsets and payout together.

## Upgrade

Back up the existing database, stop the old app, replace source/static files and
run `npm run db:migrate` against the existing database with its usual environment.
Then start the new app. Standard `npm run start:prod` and the Docker production
startup already run the migration. Never replace a production database with the
preview database or example data. Keep the existing private configuration and
volume names. Do not run an old app alongside the new payout schema/records.

`START-HERE-v21.3.txt` is the current entry point. Older versioned notes in this ZIP
are historical; their statements about migrations apply only to those releases.
See `DEPLOYMENT-v20.1.md` for the existing deployment setup.

## Verification

- Full local regression suite: 120 passed, 0 failed, 0 skipped.
- 13 new recovery tests cover the original admin-refund failure, partial/full
  recovery, no earnings, zero settlements, later refunds on settlements,
  duplicate/concurrent requests, stale available payouts, failed retries,
  mixed sellers, cumulative cents, authorization, audit rollback, repeatable
  migration, and invalid-payout reservation release.
- Chromium browser checks exercised seller refresh/generate, admin reconciliation
  and sample transfer recording, and 320/390/768/1440px seller layouts.
- Evidence: `validation/npm-test-v21.3.txt`, `preview/payout-recovery/`.
- Tests use PGlite with serialized database transactions and mocked provider
  responses. They do not prove production PostgreSQL lock contention behavior,
  load capacity, live Stripe/banking acceptance or a Docker/live deployment.

Run `npm run payout-refunds:check` or `npm test`. The existing tracking, fulfillment,
MFA, payment-signature, forms, catalog and other regression checks remain included.
