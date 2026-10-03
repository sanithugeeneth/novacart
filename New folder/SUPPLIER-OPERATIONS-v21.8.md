# Supplier operations — v21.8

The supplier workspace now reads shipment/payment status, updates customer
tracking, requests Amazon MCF cancellation, and runs optional scheduled tracking
and stock refreshes. Earlier product-page, currency, seller, payment, refund and
tracking fixes remain included. This release also includes admin email OTP.

## Capability boundaries

| Area | Implemented behavior | Remaining provider dependency |
|---|---|---|
| Amazon inventory | Import and refresh exact seller SKU/ASIN inventory | Your own FBA/MCF inventory and API authorization |
| Amazon tracking | Read fulfillment packages and delivery status; display customer-safe tracking | Correct SP-API roles, matching fulfillment records, carrier data |
| Amazon cancellation | Explicit request; durable intent, no duplicate retry, later outcome sync | Provider may reject cancellation after shipment begins |
| Amazon charges | Shown as provider-account billing | Actual charges/payment handled by Amazon; this is not an invoice settlement check |
| AliExpress tracking/payment state | Query each known DS order using signed requests; show pending payment separately | Your DS application's permissions, token, protocol and response compatibility |
| AliExpress payment | Provider account handoff; status can be read later | No automatic debit/card/balance payment implemented |
| AliExpress buyer cancellation | Audited task and manual provider outcome record; sync reports IN_CANCEL when returned | No verified buyer-cancellation API implemented |
| Account check | Product read-only probe, no import/order/payment | Does not certify order creation, payment or cancellation access |
| Scheduled jobs | Tracking every five minutes; stock every six hours, when enabled | App running, schema current, provider credentials/rate limits |

Amazon MCF fulfills the merchant's inventory already in Amazon's network. It does
not buy arbitrary Amazon retail products. We did not substitute Alibaba.com
payment APIs or seller-only cancellation APIs for AliExpress buyer operations.
No real provider account, charge, order, cancellation, SMTP inbox or deployment
was exercised in this environment. The complete supplier business workflow is
not claimed to be fully autonomous or live-verified.

## Setup

Preserve private settings and the database. Back up and stop the app, update all
source/static files, run `npm run db:migrate`, configure providers using the
existing integration guide and restart. New supplier operational columns and an
admin email challenge table are mandatory. Readiness checks include this schema.

Set `SUPPLIER_AUTO_SYNC=true` to enable scheduled reads. The worker runs once a
minute, handles up to five due shipment records and three due product mappings,
and stores per-record due times/leases. A backlog can increase effective delay.
Failed order reads back off up to one hour; failed stock reads retry after fifteen
minutes. Successful stock refresh preserves retail prices and local reservations.
Workers never place supplier orders, pay suppliers or request cancellation by
themselves. Existing order forwarding still requires a paid, reviewed order.

The admin can use **Sync status** without enabling the scheduler. Provider
failures retain existing tracking instead of overwriting it with empty data.
Product-read check requires an exact product ID, SKU and country. A success means
that read operation worked now, not that every provider operation is authorized.

## Cancellation and payment handling

Cancellation is per supplier shipment. The confirmation persists an intent before
calling Amazon; a timeout or crash leaves an unresolved state and never blindly
sends a second request. **Sync status** reads the provider outcome. An accepted
request is not a confirmed cancellation. Shipped/delivered records are blocked
from a new cancellation action; contact the provider about returns/interception.

AliExpress opens a `manual_required` task without claiming an API cancellation.
Complete payment/cancellation in the provider account. An administrator may
record a cancellation check with a minimum 20-character evidence/support
reference; the audit records that this was manual verification. Payment is not
marked successful by an administrator checkbox: known provider states drive the
display. Unknown/unrecognized states stay unknown.

Neither supplier cancellation nor provider payment changes the customer's
payment/refund record or releases local inventory. Handle refunds separately.
In mixed seller/supplier orders, customer tracking groups each supplier's items
without replacing another seller's tracking or exposing supplier purchase costs,
account references, credentials, cancellation evidence or recipient data.
Amazon `Complete` alone is treated as shipped, not delivered. Delivery requires
matching package tracking with `currentStatus=DELIVERED`. Package-detail failures
retain shipment tracking and report a warning. At most twenty Amazon packages
are enriched with carrier delivery state in one poll; larger shipments require
provider-account review. AliExpress reads at most twenty exact external orders
per fulfillment record; unknown placement outcomes still need manual reference
resolution before querying and are never automatically resubmitted.

## Verification

161 automated tests passed, including sixteen new supplier and email OTP tests.
Eight local Chromium 131 browser checks passed: admin ledger, product read probe,
explicit cancellation, tracking sync, desktop/mobile layout, customer shipment
view, email challenge UI and verified session restoration. Evidence is under
`validation/` and `preview/supplier-operations/`.

The tests use PGlite with serialized fixture transactions and captured provider
responses. They do not establish real PostgreSQL multi-host load capacity or live
provider acceptance. Configure an approved account and validate each enabled
operation before relying on it for real orders.

## Primary API references checked during implementation

- Amazon MCF API scope: https://developer-docs.amazon/sp-api/reference/fulfillment-outbound-v2020-07-01
- Amazon cancellation: https://developer-docs.amazon/sp-api/reference/cancelfulfillmentorder
- Amazon package tracking: https://developer-docs.amazon/sp-api/reference/getpackagetrackingdetails
- Amazon published model: https://github.com/amzn/selling-partner-api-models/blob/main/models/fulfillment-outbound-api-model/fulfillmentOutbound_2020-07-01.json
- AliExpress DS order query and logistics fields: https://developer.alibaba.com/docs/api.htm?apiId=60455
- AliExpress mirrored request parameter documentation: https://open.alitrip.com/docs/api.htm?apiId=60455

Provider documentation/permissions can change. Fixed provider hosts and supported
method names are used; there is no arbitrary URL/proxy endpoint and no hidden
scraping or automatic buyer-account login.
