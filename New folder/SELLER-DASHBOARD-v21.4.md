# Seller dashboard — v21.4

Approved sellers can manage their catalogue, available inventory, fulfilment and
payout requests from `/seller.html`. This release builds on v21.3 and retains the
payment guard, customer shipment tracking and post-payout refund recovery.

## Controls

| Area | Available controls |
| --- | --- |
| Products | Add/edit title, category, SKU, price, compare-at price, image URL, description, brand, keywords, badge, cost price and shop visibility |
| Inventory | Quick base stock editor; add/edit variant title, SKU, price, image URL, stock and visibility |
| Catalogue | Server search by title/SKU/category, visibility filter and pagination |
| Orders | Server search and shipment-status filter, pagination, seller-owned item quantities/prices and delivery address/contact |
| Shipping | Processing, packed or shipped status; courier and tracking number; customer tracking updates |
| Payouts | Date-range request, payout history, refund deductions, reserved/recovered/carried balances and refund refresh |

The editor accepts a direct image URL; it does not upload local image files or
provide a full gallery manager. Updating the main image also updates the first
customer gallery image without removing other gallery entries. Hide products or
variants to stop new sales; historical order snapshots remain intact.

Base inventory and variant inventory are separate available-to-sell quantities.
Set the **remaining available stock**, not stock already reserved by orders.
Supplier-linked stock and variants remain controlled by supplier synchronization.

## Correctness and access

- Approved seller session, CSRF and ownership checks guard every mutation.
  Product ownership uses the seller's user ID; order allocations use its seller
  profile ID. Order item details are filtered to the current seller.
- Create operations generate IDs, slugs and default SKUs on the server. Sellers
  cannot forge another owner, currency, reviews or ratings.
- Money, stock, visibility and URLs are validated. Invalid or duplicate SKU
  writes fail visibly; entered form values remain available to correct.
- UI writes carry the loaded revision and previous stock. Stale revisions return
  409 with an explicit reload action. PATCH requests containing stock require
  `expectedStock`; integrations should also send `expectedRevision` returned by
  the seller read API. Price-only legacy patches remain supported.
- Product/variant changes, inventory movement and audit records commit together.
  Row locks serialize catalogue stock writes against checkout. Tests verify stale
  reads and transaction rollback; real PostgreSQL load/lock contention was not
  tested in this environment.
- Unpaid card orders and refund-held/closed orders have no editable shipping form,
  and the server enforces the same restrictions. COD remains the explicit allowed
  prepayment fulfilment method. Status cannot move backwards.
- Payout requests use the existing idempotent payout ledger and refund recovery.
  An admin reviews and records an external transfer. The UI itself does not send
  a bank transfer or connect a seller bank account.

## API changes

- GET `/api/seller/products`: `q`, `visibility`, `page`, `limit`; includes
  `pagination`, variants, supplier management flag and revision tokens.
- GET `/api/seller/products/:id`: latest owned product and variants.
- POST `/api/seller/products`; PATCH `/api/seller/products/:id`: validated editor
  fields and stock snapshots.
- POST `/api/seller/products/:id/variants`; PATCH
  `/api/seller/products/:id/variants/:variantId`: owned option management.
- GET `/api/seller/orders`: `q`, `status`, `page`, `limit`; includes pagination,
  owned order items, address/contact and refund-hold information.

Seller product/order list responses are now paginated. Clients must follow
`pagination.pages` instead of assuming a response contains the complete list.
No new database schema is introduced after v21.3.

## Upgrade and validation

Back up the existing database, stop the old application, update source and static
files together, retain private configuration and run `npm run db:migrate` before
restarting. Older deployments need the cumulative v21.3 schema. The production
startup scripts also run the migration. Hard refresh the seller page after upgrade.

- `npm test`: **131 passed, 0 failed, 0 skipped**.
- `tests/seller-dashboard.test.js`: 11 new regression tests covering editor
  persistence, owner/CSRF/approval checks, validation, checkout stock conflicts,
  variants, audit rollback, full catalogue pagination, order privacy, asset
  serving, supplier controls and main-image/gallery consistency.
- The existing forms test DOM adapter now models a disabled submit button.
- Chromium 131: 10 local browser checks cover product/variant creation and edits,
  visibility, quick stock, conflict reload, catalogue/order filters, shipment
  updates, unpaid-card restrictions, payout request deduplication, network retry
  and hidden controls for unapproved/anonymous sessions.
- Layout checks at 320, 390, 768 and 1440px; no horizontal overflow. Product dialogs
  scroll vertically on compact screens. Screenshots and browser report are in
  `preview/seller-dashboard/`; full test log is `validation/tests-v21.4.txt`.

Tests use isolated PGlite databases and mocked payment-provider responses. No
real charge, refund or transfer was made. This release has not been deployed to
a live server; live hosting/provider acceptance and Docker runtime verification
remain separate work.
