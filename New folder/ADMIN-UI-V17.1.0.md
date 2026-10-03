# NovaCart Admin Command Center v17.1.0

This release upgrades the existing admin surface into a marketplace-style command center while keeping the existing backend APIs and security flow intact.

## Included

- KPI command-center dashboard with revenue window selector
- Operational attention queue for low stock, reviews, sellers, returns and Q&A
- Order workspace with payment/status filters
- Order detail drawer with items, status history and refunds
- Shipment-event entry from order details
- Product studio with richer editor, SEO fields, variants and media management
- Customer intelligence search and customer profile/order modal
- Inventory filters and auditable stock adjustments
- Review moderation queue
- Returns and refunds workspace
- Seller approvals and product counts
- Seller payout ledger
- Promotion/coupon center
- Product Q&A queue
- Support ticket workspace
- Risk/fraud event monitor backed by stored fraud_events
- Analytics workspace with daily revenue chart and category economics
- Audit log search
- Store control center / launch-readiness notes
- Responsive mobile navigation and drawer/modal interactions
- Duplicate coupon click handler from the previous admin JavaScript removed
- Admin UI copy and version updated to 17.1.0

## Notes

The UI does not add fake marketplace functionality. Actions are wired to the NovaCart endpoints present in this project. Features that require live external services (for example Stripe payouts or production email delivery) remain dependent on those services being configured.

The distributable archive intentionally excludes `.env` and `node_modules`. Copy the `.env` from your working NovaCart installation into the new project folder before starting it.
