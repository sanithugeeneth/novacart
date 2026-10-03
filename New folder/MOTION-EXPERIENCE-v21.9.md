# Forma Motion Experience — v21.9

The previous motion files were not connected to the current Forma UI. This release
replaces them with a shared native-browser motion system loaded after Forma styles
and page scripts on all 16 HTML templates, including canonical /p/ product pages.
No new dependency is required.

## Interactions

- Masked, staggered hero typography; campaign image entrance and a finite light
  sweep; brand symbol entrance and a restrained mouse-driven campaign image.
- One-time viewport reveals for collections, sections, products, related items,
  stories, newsletter and workspace panels. Dynamic catalog cards are discovered.
  Previously revealed product IDs do not replay on wishlist or load-more updates.
- Bounded desktop card depth, image zoom, collection lift, brand/CTA arrow rotation,
  tactile button presses and finite ripple feedback.
- Successful cart state updates trigger count/button feedback and a product-image
  flight when the source and bag are visible. At most three thumbnails exist.
  No flight is emitted for a quantity-cap/no-change update. Animation completion,
  cancellation and hidden tabs remove temporary visuals.
- Wishlist state feedback, product image cross-fades after loading, tab transitions,
  bag/checkout/mobile menu entrances and matching toast timing.
- Scroll-position line and a scroll-driven decorative story symbol.

## Accessibility and performance

Content is visible by default. No loading curtain, custom cursor or scroll
hijacking is used. Missing JavaScript does not hide hero or server-rendered product
content. Existing keyboard controls, focus trap and Escape dismissal remain.

The footer Page animations toggle persists locally. OS reduced motion has priority
and is observed at runtime. Switching off cancels in-flight native animations,
removes transient elements, stops CSS transitions and makes application-triggered
smooth scrolling immediate. Focusing an entering region finishes its reveal.

Scroll and pointer work is scheduled once per animation frame, without a perpetual
JavaScript animation loop. IntersectionObserver tracks relevant inserted subtrees.
Decorative entrance effects are finite. Pointer depth and thumbnail flight require
a desktop viewport and fine-pointer/mouse capability; coarse touch stays excluded.
A real mouse event also supports remote desktop browsers reporting no primary
pointer. Background tabs cancel temporary motion.

## Upgrade and validation

No new schema changes relative to v21.8. Deploy all application/static files,
restart, and refresh cached pages. Older versions still need the v21.8 cumulative
migration. Run `npm.cmd run preview:ui` for isolated sample data without Docker.

Current results are in `validation/motion-regressions-v21.9.txt` and
`preview/motion/browser-report.json`. Screenshots and Motion-Preview.mp4 show the
actual local preview UI. Older reports are retained as historical evidence.

Supplier payment/account compatibility, SMTP and live deployment requirements
remain as documented in v21.8. No real payment, email or provider transaction and
no production deployment were performed for this animation update.

Validation for this release: **27 focused regression tests and 17 local Chromium browser checks passed.** No live deployment.
