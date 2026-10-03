# NovaCart V13 go-live checklist

## Application
- [x] Customer authentication and secure sessions
- [x] Password reset and email verification
- [x] Address validation
- [x] Wishlist and reviews
- [x] Cart and checkout idempotency
- [x] Inventory reservation/release
- [x] Coupon reservation/release
- [x] Stripe webhook idempotency
- [x] Partial and full refund support
- [x] Return/cancellation workflow
- [x] Shipment events
- [x] Product variants and catalog cost data
- [x] Dynamic product SEO route and sitemap
- [x] Admin analytics and audit logs
- [x] Prometheus-style metrics endpoint
- [x] Backup verification helper
- [x] Load-test helper

## External launch requirements
- [ ] Managed PostgreSQL provisioned
- [ ] Automated off-site backups + restore test
- [ ] Stripe live account + webhook endpoint + signing secret
- [ ] SMTP provider + domain authentication (SPF/DKIM/DMARC)
- [ ] Production domain/DNS + HTTPS
- [ ] Business/legal details reviewed by the merchant and counsel as appropriate
- [ ] Real product catalog, images, SKUs, prices and inventory loaded
- [ ] Real shipping zones/rates/ETAs and tax rules configured
- [ ] Monitoring/alerting platform connected
- [ ] Final live checkout/refund/cancellation/return tests passed

Application code cannot create or verify merchant-owned external accounts. Keep those credentials in the hosting provider's secret manager.
