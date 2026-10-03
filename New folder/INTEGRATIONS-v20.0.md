# NovaCart 20.0: provider setup and operating guide

This release contains executable OAuth, image recognition, product synchronization and supplier order adapters, their customer/admin interfaces, and isolated regression tests. It does **not** contain your provider credentials or an approved provider account. No live provider login, image billing, supplier purchase, shipment or production deployment was performed during this update. Configuration and a successful local fixture test are not evidence of live provider approval.

## Upgrade first

Keep your existing database and environment settings. Back up the database, install the new application in its own folder, and run:

```bash
npm ci
npm run db:migrate
npm test
npm start
```

The migration adds `oauth_states`, `integration_usage`, `supplier_products`, `supplier_orders`, and `order_items.supplier_snapshot`. Existing products and orders are retained. Old orders without a supplier snapshot are not automatically sent to an external supplier.

For the visual design only, `npm run preview:ui` starts isolated sample data without Docker. Its provider integrations are disabled. The screenshots and browser reports also include a separate fixture run with simulated provider responses; that test setup is not production configuration.

## Google sign-in

Create an OAuth web application for your store and register the exact callback:

```text
https://YOUR-STORE/api/oauth/google/callback
```

Set these server environment values and restart:

```dotenv
ENABLE_OAUTH_GOOGLE=true
OAUTH_GOOGLE_CLIENT_ID=your-web-client-id
OAUTH_GOOGLE_CLIENT_SECRET=your-client-secret
PUBLIC_BASE_URL=https://YOUR-STORE
```

Complete the provider's consent screen/test-user configuration or production verification as appropriate. The login page shows the Google button only when the feature is enabled and both credentials are present.

The flow uses the authorization code exchange, PKCE S256, a signed ID token, provider JWKS, issuer/audience/expiry checks, nonce verification, a ten-minute browser-bound state, and one-time state consumption. The stable provider subject identifies the account. See the [Google OpenID Connect reference](https://developers.google.com/identity/openid-connect/reference).

An email collision never silently links an account. Sign in with the existing NovaCart password, open **Account → Connected accounts**, and connect Google there. Provider accounts already linked to an administrator cannot create a customer session; administrators still use the Admin tab and its MFA rules.

## Apple sign-in

Configure Sign in with Apple for a web Services ID, an associated app, your domain, and this return URL:

```text
https://YOUR-STORE/api/oauth/apple/callback
```

Use the Services ID as the client ID. Configure:

```dotenv
ENABLE_OAUTH_APPLE=true
OAUTH_APPLE_CLIENT_ID=your-services-id
OAUTH_APPLE_TEAM_ID=your-team-id
OAUTH_APPLE_KEY_ID=your-sign-in-key-id
OAUTH_APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR-PRIVATE-KEY-CONTENT\n-----END PRIVATE KEY-----"
PUBLIC_BASE_URL=https://YOUR-STORE
```

Keep the `.p8` content on the server, never in frontend JavaScript. The app signs a short-lived ES256 client secret and exchanges the authorization code with Apple. Apple's callback is `form_post`; its dedicated browser-binding cookie is `Secure`, `HttpOnly`, and `SameSite=None`. The callback alone is exempted from the store origin check and still requires its one-use bound state and verified token. Use a real HTTPS domain; Apple web return URLs do not use localhost. See [Apple token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens) and [identity verification](https://developer.apple.com/documentation/signinwithapple/verifying-a-user).

Apple may provide email/profile information only on first authorization. Existing linked accounts are resolved by the provider subject. New accounts require a verified email, including a private relay address when supplied. Configure Apple relay email delivery separately if your store sends mail to relay addresses. The application does not retain OAuth access or refresh tokens. NovaCart sessions remain governed by the store's expiry/revocation settings.

## Real image search

Enable Cloud Vision in your Google Cloud project and configure an API key restricted to the Vision API and your server deployment. Set billing/quota controls in the provider account as appropriate:

```dotenv
ENABLE_VISUAL_SEARCH=true
GOOGLE_VISION_API_KEY=your-server-api-key
VISUAL_SEARCH_DAILY_LIMIT=200
```

The search bar camera button appears when configured. It accepts a JPEG, PNG or WebP upload under 3 MB and asks permission to send the image to Google. The server validates the file signature, calls label/object recognition, then ranks matching active products across the entire catalogue. This is **recognized-object catalogue search**, not exact image similarity, face identification or a guarantee that an identical item exists. No recognized object or no catalogue match produces an honest empty result.

The image itself is not persisted by NovaCart. Search history contains recognized terms and result product IDs. The app does not fetch customer-supplied remote image URLs. Authenticated requests require CSRF, each IP has an hourly cap, and a shared database counter enforces the daily request limit even across app instances. Provider outages do not return arbitrary popular products. Recognition request format: [Cloud Vision label detection](https://docs.cloud.google.com/vision/docs/labels).

## Supplier workspace

Sign in as an administrator, then open **Admin → Suppliers** (`/integrations.html`). All supplier API operations require the existing server-side admin/MFA checks; changes also require CSRF. Credentials never appear in API responses.

1. Enter the provider product ID, **exact SKU**, two-letter destination country, and, for AliExpress, a confirmed logistics service.
2. Preview the supplier product. Set your retail price and category. Import as a draft, or explicitly publish after review. One supplier SKU becomes one NovaCart product; import other SKUs separately.
3. Use **Sync** to refresh title, description, photos, supplier cost where available, and stock. Your NovaCart retail price is preserved. Review cost, shipping and margin independently.
4. Refresh stock at least daily. Stale supplier stock blocks checkout after 24 hours. Supplier items require card payment and the same destination country used for import. Local outstanding reservations are conservatively subtracted from supplier stock, which can temporarily understate availability after the provider has also reserved a shipment.
5. After the Stripe webhook confirms payment, enter the NovaCart order ID and preview the shipment. Check the exact items, address and provider costs. **Confirm & send to supplier** performs the external operation.

No supplier order is automatically placed merely because a customer checks out or a product is imported. The workspace deliberately separates the paid store order from the paid/accepted/shipped states of the supplier order.

### Amazon: seller inventory and MCF

```dotenv
ENABLE_AMAZON_SYNC=true
ENABLE_AMAZON_FORWARDING=false
AMAZON_SP_API_REGION=na
AMAZON_MARKETPLACE_ID=your-marketplace-id
AMAZON_LWA_CLIENT_ID=your-app-client-id
AMAZON_LWA_CLIENT_SECRET=your-app-client-secret
AMAZON_REFRESH_TOKEN=your-seller-authorized-refresh-token
```

Use `na`, `eu` or `fe` for the matching SP-API region. Your authorized seller application must have access to the catalog, FBA inventory and fulfillment operations. Start with forwarding disabled while checking product mappings; enable `ENABLE_AMAZON_FORWARDING=true` when your account and fulfillment setup are ready.

The adapter refreshes its LWA token, reads Catalog Items 2022-04-01, checks the exact ASIN/seller-SKU inventory through FBA Inventory v1, and creates an MCF fulfillment order through Fulfillment Outbound 2020-07-01. It uses a stable `sellerFulfillmentOrderId` and `FillOrKill`. The stock query uses fulfillable quantity, not total/inbound stock. Amazon catalog data does not establish your acquisition cost, so NovaCart does not invent one. See [SP-API authorization](https://developer-docs.amazon/sp-api/docs/connecting-to-the-selling-partner-api), [inventory summaries](https://developer-docs.amazon/sp-api/reference/getinventorysummaries), and [MCF order creation](https://developer-docs.amazon/sp-api/reference/createfulfillmentorder).

**Scope:** this ships your own Amazon fulfillment inventory. It is not an API for buying arbitrary consumer Amazon retail products. Region, marketplace, destination and your MCF eligibility must match. India MCF needs additional payment information and is explicitly blocked in this generic adapter; use Seller Central for that workflow. Shipping/tax estimates in NovaCart are store settings, not live Amazon fee quotes.

### AliExpress: approved dropshipping API access

```dotenv
ENABLE_ALIEXPRESS_SYNC=true
ENABLE_ALIEXPRESS_FORWARDING=false
ALIEXPRESS_PROTOCOL=iop
ALIEXPRESS_APP_KEY=your-approved-app-key
ALIEXPRESS_APP_SECRET=your-app-secret
ALIEXPRESS_ACCESS_TOKEN=your-authorized-buyer-token
```

The adapter implements `aliexpress.ds.product.get` and `aliexpress.trade.buy.placeorder`, exact SKU attributes, a confirmed logistics service, and signed form requests. IOP uses the Singapore `/sync` endpoint and HMAC-SHA256. `ALIEXPRESS_PROTOCOL=top` selects the legacy TOP endpoint and its HMAC-MD5 protocol for accounts entitled to those APIs. Unsupported currencies, absent exact stock and missing SKU information fail instead of importing guessed data. Credentials/tokens are supplied and renewed through your authorized provider account; this release does not automate AliExpress account authorization or token renewal.

**Verify your approved app's current API contract before enabling forwarding.** The accessible official [product schema](https://open.alitrip.com/docs/doc.htm?articleId=60452&docType=2&treeId=762) and [order schema](https://open.alitrip.com/docs/doc.htm?articleId=35446&docType=2&treeId=762) are in a legacy documentation section. Current developer-console access was not available for this work. We have not verified that a newly registered app receives these method permissions, nor that IOP/legacy entitlements are interchangeable. If your app exposes a different order method, its approved schema needs to be supplied and matched before activation; this ZIP does not claim a verified `aliexpress.ds.order.create` contract.

Enable `ENABLE_ALIEXPRESS_FORWARDING=true` only after that account-specific verification. Order creation records the returned provider order IDs. It **does not pay the AliExpress purchase**. Confirm and fund the supplier purchase in the approved account. Customer payment to NovaCart and supplier payment are separate. Country-specific tax identifiers/customs requirements may also require handling in the provider account. The generic adapter does not fabricate them or automatically select a shipping service.

## Unknown outcomes, reconciliation and refunds

There is one durable submission record per store order/provider. Preview approval expires in ten minutes; changed order details invalidate it. Payment/refund/return status is checked again immediately before submission. The submission intent is committed before the provider request. Concurrent/repeated clicks cannot issue another request for a submitted or uncertain order.

If the connection fails after sending, the result becomes **unknown**. A crashed process may leave **submitting**; both states remain locked. A paid store order is not labelled fulfilled merely because the API was called. Open the provider account and use the stable reference to investigate. Amazon **Verify status** looks up that exact MCF reference and checks its item IDs, SKUs and quantities without creating another order.

For a final outcome verified in the provider account or by provider support, **Record verified outcome** becomes the recovery path after at least two minutes. Record concrete evidence and references. Mark **accepted** to save the actual provider IDs, or **not created** only when the provider confirmed that no order exists. The latter requires a new preview before retry. Manual verification is recorded as an administrator decision, not as an automatic provider check. An incorrect manual “not created” decision can still cause a duplicate AliExpress purchase; never use it to guess through a timeout. The audit entry retains the previous request hash and evidence.

Automated retries are never performed for uncertain supplier outcomes. Admin refunds are blocked while a supplier request is submitting/unknown; resolve its outcome first. For accepted fulfillment, coordinate any supplier cancellation/refund separately before finalizing store-side resolution. This package does not implement supplier cancellation, AliExpress payment, or automatic provider shipment/tracking synchronization. Existing NovaCart shipment-management tools remain available.

## Local verification and live acceptance

```bash
npm run integrations:check
npm test
```

Tests use real local HTTP routes and the PostgreSQL schema in isolated PGlite databases, with signed JWT/provider response fixtures. They cover successful and rejected Google/Apple callbacks, invalid tokens/state/replays, admin restrictions, real image-byte request construction, catalogue matching, supplier stock reservations, paid-order checks, duplicate submissions, uncertain outcomes and resolution audits. They do not contact paid APIs.

After setting real credentials, validate one provider at a time in its supported test environment or a deliberately approved small live transaction. Check the provider console against the NovaCart account/order reference. Keep forwarding disabled until you have verified the account's method permissions, destination support, supplier charges and exact response contract. No production acceptance result is bundled or implied by the fixture tests.
