# NovaCart frontend source guide

[Back to project README](README.md)

The frontend is HTML, CSS and browser JavaScript served by the same Express application as the API. There is no separate React/Vite build or second frontend server.

## Source map

| Area | Source |
| --- | --- |
| Storefront HTML | [index.html](New%20folder/index.html) |
| Storefront behavior, catalog and cart | [app.js](New%20folder/app.js) |
| Product page | [product.html](New%20folder/product.html), [product.js](New%20folder/product.js) |
| Main design | [styles.css](New%20folder/styles.css), [forma-ui.css](New%20folder/forma-ui.css) |
| Motion | [motion.css](New%20folder/motion.css), [motion.js](New%20folder/motion.js) |
| Sign-in and authentication UI | [login.html](New%20folder/login.html), [auth.js](New%20folder/auth.js) |
| Customer orders | [orders.html](New%20folder/orders.html), [orders.js](New%20folder/orders.js) |
| Seller workspace | [seller.html](New%20folder/seller.html), [seller.js](New%20folder/seller.js), [seller-catalog.js](New%20folder/seller-catalog.js) |
| Admin workspace | [admin.html](New%20folder/admin.html), [admin.js](New%20folder/admin.js) |
| Currency formatting | [workspace-money.js](New%20folder/workspace-money.js) |
| Support | [support.html](New%20folder/support.html), [support.js](New%20folder/support.js) |
| Images/fonts | [assets](New%20folder/assets/) |

## Run and review

Use the [README local instructions](README.md#quick-local-demonstration). Open pages through the running application, not by double-clicking HTML files. Catalog, authentication and orders need the API.

Suggested review: browse the catalog, search, open a product, change cart quantities, complete a sample COD order, view customer orders, and inspect seller/admin screens using the appropriate local preview accounts.

Review mobile and desktop layouts and the page-animation preference. Screenshot evidence under [preview](New%20folder/preview/) comes from earlier local checks; it is not proof of a live deployment.

The canonical `/p/...` product pages also use [backend-rendered product content](New%20folder/services/product-pages.js). Frontend and backend are intentionally connected.

For the certificate's frontend GitHub field, this guide identifies and links the frontend source in the shared repository. Separate-repository acceptance must be confirmed with the reviewing team.
