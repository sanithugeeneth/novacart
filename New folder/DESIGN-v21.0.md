# Forma design notes

An original NovaCart direction created without a supplied reference screenshot or
URL. The design uses warm white, sage, ink/forest green, and electric lime with
local DM Sans and Instrument Serif fonts. Large editorial headings, generous
spacing, rounded cards, clear controls and a coordinated photo treatment establish
the visual system. No claim of a worldwide design ranking is made.

## Included surfaces

The homepage includes a new split hero, collections, full catalog, deals, brand
story, newsletter and footer. Shared styles cover product details, favourites,
bag, checkout, account, orders, support, seller application/dashboard and legal
pages. Login receives a new campaign panel; admin receives coordinated cards,
controls and chart styling. Existing form and API bindings remain in place.

`forma-ui.css` loads last on every top-level HTML page. It builds on the existing
layout styles. The server explicitly allows this stylesheet and the campaign
image. Product cards and details accurately show “No reviews yet” for empty
review data, and unavailable products retain disabled purchase controls.

Keyboard focus, Escape handling, tab controls and mobile navigation were checked.
The stylesheet respects reduced-motion preferences. Catalog photos and fonts
remain bundled locally. Preview data is illustrative and not a live inventory.

## Original campaign image

- Mode: built-in image generation, new image (no reference image).
- File: `assets/forma-campaign.png`.
- Usage: illustrative homepage/login campaign art, not a catalog product photo.
- Exact prompt:

Use case: product-mockup. Create one original premium ecommerce homepage hero photograph for NovaCart's new contemporary design. Asset only, absolutely no typography, no letters, no brand logos, no watermark, no UI. Square 1:1 composition. A beautiful editorial studio still life of carefully designed everyday objects: large ivory over-ear wireless headphones standing on a low pale warm stone rectangular pedestal at center-left, a sculptural dark forest-green stainless steel reusable water bottle slightly behind on the right, and a very small brushed silver portable speaker lower front-right. A small electric chartreuse fabric ribbon rests across the base, understated. Pale warm ivory seamless background and tabletop, coherent soft directional sunlight from upper left creates long gentle shadows to the right, tactile matte materials with exceptionally realistic fine details, subtle high-end product photography, natural perspective 70mm lens. Artful asymmetrical composition with generous breathing space around the objects, objects entirely contained in the frame, calm but striking designer retail art direction. Limited colors: off-white, dark forest green, pale silver, one lime accent. No people, no floating objects, no extreme reflections. This image will sit in the right half of an ink-black / white / electric-lime website; website headings are rendered separately in HTML. These are unbranded illustrative campaign objects, not claims about any specific item for sale.

## Browser captures

See `preview/forma/` for actual rendered screenshots. The final homepage captures
wait for lazy images to decode so the complete page is represented. The preview
command uses an isolated sample database and never initiates real charges.
