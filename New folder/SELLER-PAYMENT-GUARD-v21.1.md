# Seller payment guard — v21.1

This patch fixes `PATCH /api/seller/orders/:id` accepting fulfillment updates for
unpaid card orders. It is a server-side check, so changing browser controls or
submitting payment fields in a request cannot bypass it.

## Behavior

| Persisted state | Seller processing, packing or shipping |
| --- | --- |
| Stripe unpaid/pending/failed | HTTP 409; no mutation |
| Stripe paid with `paid_at`, open order and reserved inventory | Allowed |
| COD awaiting collection (`payment_status=cod`), open order | Allowed |
| COD confirmed paid with `paid_at`, open order | Allowed |
| Unknown payment method/state or paid with no confirmation time | HTTP 409 |
| Full/partial refund or pending/unknown-outcome refund reservation | HTTP 409 |
| Cancelled, expired, failed, refunded, delivered or released-inventory order | HTTP 409 |
| Closed seller allocation or backwards fulfillment transition | HTTP 409 |
| Another seller's order or nonexistent order | HTTP 404 |
| Missing session / seller permission / CSRF | Existing 401/403 protection |
| Invalid destination status | HTTP 400 |

Paid/COD orders may advance directly to processing, packed or shipped. Repeating
a current status is allowed for tracking corrections while the order remains
eligible. A shipped allocation cannot be moved backwards to packed/processing.
The handler never changes the parent order's payment fields. Successful changes
retain the existing `{ok:true}` response.

## Consistent state and rollback

The handler opens a transaction, locks the parent order first, then locks the
current seller allocation. Stripe confirmation, expiry/cancellation and refund
handlers also lock the parent order. Eligibility is evaluated after acquiring
that lock and remains protected through the seller update and audit insert.

Only the authenticated seller's allocation is updated. The audit record includes
seller, prior/new fulfillment state and the payment state used for authorization.
Database or audit failures roll back the entire update. Rejected requests do not
change seller status, tracking, courier, order data or fulfillment audit records.
No provider calls are needed to update fulfillment: authoritative local payment
state comes from the existing verified payment flow.

## Verification

25 September 2026: **97 passed, 0 failed, 0 skipped** in the full local suite,
including all 10 new fulfillment tests. JavaScript syntax checks also passed.

The regression test first ran against v21.0 and reproduced the defect: an unpaid
request returned 200 instead of 409. Evidence:
`validation/seller-fulfillment-before-v21.1.txt` (intentional failing baseline).

The corrected handler passes 10 targeted integration tests:

1. Unpaid cards reject all three fulfillment stages and forged payment fields.
2. An unpaid signed webhook and a stale seller status do not authorize shipping.
3. Verified payment enables fulfillment and tracking edits without backwards moves.
4. COD remains fulfillable before collection.
5. Closed/released/inconsistent/unknown states fail without any mutation.
6. Pending/unknown refund outcomes block fulfillment until failure is confirmed.
7. Successful partial and full refunds block fulfillment.
8. Authentication, authorization, ownership, CSRF and status validation remain.
9. Mixed-seller orders enforce payment and isolate each seller allocation.
10. Simulated audit-write failure rolls back status and tracking.

Evidence: `validation/seller-fulfillment-v21.1.txt`.
Full regression evidence: `validation/npm-test-v21.1.txt`.

Tests use actual local HTTP routes, the real schema in isolated PGlite and signed
Stripe fixtures. No real payment, email or supplier purchase is made. The local
PGlite harness serializes transactions; it is not a multi-connection production
PostgreSQL load test. No production deployment was performed.

## Upgrade and historical data

There is no new schema migration for this patch. Back up an existing installation,
preserve its private settings/database, deploy this version and restart the app
using `DEPLOYMENT-v20.1.md`. Earlier cumulative migrations still apply if upgrading
from an older release. The read-only SQL file
`validation/audit-legacy-seller-fulfillment.sql` identifies previously advanced
seller rows attached to unconfirmed card payments. Reconcile any such historical
rows against payment and shipping records; this patch deliberately does not invent
payments or silently rewrite previously recorded physical shipments.

This release addresses the unpaid seller fulfillment defect. Seller/customer
tracking synchronization, the full seller management UI, payout reconciliation,
currency labels, SEO presentation and live-provider activation remain separate
items from the preceding audit. Existing Forma screenshots are retained as v21.0
UI evidence, not as newly captured screens for this server patch.
