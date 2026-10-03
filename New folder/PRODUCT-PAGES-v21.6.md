# Complete product pages at sitemap URLs — v21.6

`/p/:slug` now serves the same Forma product layout and purchase experience as the
customer product screen. The previous minimal HTML page and its “View full
product” detour have been removed. Existing `/product.html?id=...` links receive
an automatic 301 redirect to the canonical product URL.

The initial HTML includes the product title, category, description, main image,
price, default active variant, stock, specifications, approved reviews and related
products. Styles, fonts, scripts and icons resolve correctly from nested `/p/`
URLs. The client enhances that page with gallery navigation, variant selection,
quantity, wishlist, Add to cart, tabs and the existing Buy now checkout flow.
Related products link directly to canonical `/p/` pages.

Without JavaScript, visitors still see styled product content and all information
panels. Purchase controls remain disabled with an explicit JavaScript notice.
A review request failure leaves the product page and purchase controls available.
The server loads public product fields only; customer/session/private seller data
is not embedded in the page.

## Search and sharing metadata

- Product-specific title and description honor the existing SEO overrides.
- Canonical and Open Graph URLs identify the `/p/` page without tracking queries.
- Open Graph images use absolute URLs; a large-image Twitter card is included.
- Product JSON-LD uses the same configured currency, default selection price and
  availability as the visible page. Variant changes update the offer while keeping
  its canonical URL. Products without reviews omit aggregate-rating markup.
- Missing/inactive products return styled HTTP 404 responses with `noindex`.
  Inactive products remain excluded from the sitemap.
- Long/unicode slugs and legacy empty slugs resolve consistently with the sitemap.
- User-controlled text is HTML-escaped; embedded JSON escapes script delimiters.

The API and server-rendered page share a public-product loader. The HTML renderer
uses `product.html` as its layout source, so the crawler and interactive page do
not maintain separate visual designs. No new runtime dependency is needed.

## Upgrade

Update source and static files together, preserve the existing database/private
configuration, verify the real `PUBLIC_BASE_URL`, restart and hard refresh. No
schema change is introduced after v21.3. Older upgrades still require the existing
cumulative migration. See DEPLOYMENT-v20.1.md for deployment instructions.

Use `npm run preview:ui` and open `/p/preview-001` at the printed local address.
The Windows command is `npm.cmd run preview:ui`. This uses temporary sample data.

## Verification

**145 regression tests passed, 0 failed, 0 skipped. Ten local browser checks passed.**

Eight new HTTP/DOM regressions cover complete initial HTML, metadata/offer
consistency, nested assets, redirects, inactive/missing products, variant stock,
escaping and long/unicode/empty slugs. `npm run product-pages:check` runs them.

Chromium 131 checks cover the full styled URL, loaded images, gallery, variants,
stock-based button availability, cart quantities, wishlist, tabs, Buy now,
legacy redirects, no-JavaScript content, review-network failure and 404 handling.
Layout widths: 320, 390, 768 and 1440px, with no horizontal overflow, JavaScript
errors or failed CSS/JS/image/font requests. Screenshots and report are under
`preview/product-pages/`; test logs are under `validation/`.

This is local verification with sample data. Live hosting, search-engine crawling,
indexing, rich-result eligibility and ranking have not been tested or guaranteed.
The earlier seller dashboard, currency, tracking/payment guards and refund payout
fixes remain included.
