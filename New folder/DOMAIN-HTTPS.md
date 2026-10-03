# Domain + HTTPS

1. Deploy the Node app to a host that supports Node 20+ and persistent environment variables.
2. Add the custom domain in the host dashboard.
3. Create the DNS record(s) shown by the provider.
4. Wait for DNS propagation and verify HTTPS.
5. Set `PUBLIC_BASE_URL` to the exact HTTPS URL customers use.
6. Configure the Stripe webhook endpoint as `${PUBLIC_BASE_URL}/api/stripe/webhook`.
7. Run `npm run launch:check` and `npm run smoke`.

Do not mix `http://localhost`, `127.0.0.1`, and your production domain in production configuration.
