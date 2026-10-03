# NovaCart Atelier · 20.0

A complete interface refresh built on the delivered v19.4 codebase.

## Visual direction

Warm paper, charcoal, restrained terracotta accents, DM Sans and Instrument Serif.
The storefront uses an editorial hero, photographic collections, quiet category
navigation and larger product imagery. Old stacked motion/ultra themes are no
longer loaded. The store, product pages, authentication, customer area, seller
center, support forms, information pages and admin workspace share the same palette.

## Shopping experience

- Local hero/category photos and fonts, with a bundled missing-image placeholder.
- Responsive catalogue cards, list/grid controls, real result counts, loading and
  empty states, and server pagination/search beyond the first 48 products.
- Real product links for keyboard navigation; accessible icon names and visible focus.
- Shopping bag, favourites and checkout with focus trapping, Escape dismissal,
  focus return and background scroll locking. Motion respects reduced-motion settings.
- Coupon, delivery, address and payment bindings retained. Shipping labels use store
  configuration. Existing Stripe verification, MFA and payout logic remain in place.
- Product gallery shows real image counts, disables unused arrows, exposes product
  tabs to keyboards, and disables purchase buttons on sold-out selections.
- Fixed fabricated sale countdown, fake site-wide shopper statistics, implied sale
  prices without compare-at values and placeholder social links by removing them.

## Accounts and operations

- Labelled application/support forms with inline success/error feedback.
- Consistent account, order, seller, support and information-page layouts.
- Approved sellers see their dashboard; an existing application shows its status.
  The seller balance card uses the eligible payout balance, not uncollected order value.
- Admin resumes only a session accepted by the protected admin endpoint, preserving
  server MFA enforcement. Its catalogue uses the admin product API, including archives.
- Repaired the admin chart container lookup and the media buttons that previously
  opened editors automatically while rows were being rendered.
- Admin modal/drawer focus handling and mobile navigation improved.

## Files

`styles.css` owns the shared foundation and shopping flows. `signature-ui.css` owns
product and secondary page layouts. `auth.css` and `admin-ultra.css` own their
specialized surfaces. `signature-ui.js` supplies small accessibility interactions.
`assets/` contains bundled interface photos, fonts, licenses and the image fallback.
Only explicitly allowed static files are served; source, environment files and
node_modules are not made public.

`npm run preview:ui` opens a local sample store backed by a temporary in-memory
PostgreSQL-compatible database. It imports the local test fixture; its credentials
and sample data are not created by the normal application start command.

## Limits

This is a code and design release, not a production deployment. Screenshots use
labelled sample products and local test accounts. Live provider credentials, real
catalogue content and business policies still belong to the store owner. Existing
operator documentation from previous releases is retained for configuration history.
