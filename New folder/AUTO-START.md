# NovaCart One-Click Start

On Windows, double-click `START-NOVACART.bat`. It will:

1. check Node/npm/Docker
2. create `.env` from `.env.example` if needed
3. install dependencies if `node_modules` is missing
4. start the PostgreSQL container
5. run the NovaCart server
6. automatically open the storefront in the default browser when the server is ready

To disable automatic browser opening, set `AUTO_OPEN_BROWSER=false` in `.env`.
