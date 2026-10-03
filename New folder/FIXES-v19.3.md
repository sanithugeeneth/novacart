# NovaCart v19.3 — Support and seller application forms

This cumulative release fixes the reported JSON submission failure and keeps every fix from v19.1 and v19.2.

The support form serialized its data with `JSON.stringify`, but its API helper only added `Content-Type: application/json` when the body was not a string. The server therefore did not parse the submitted fields and rejected valid submissions as missing a subject/message. The helper now sets the JSON header whenever a request body is present, matching the seller form's existing v19.2 fix.

Both forms have regression coverage that executes their shipped JavaScript handlers against the actual HTTP server and an isolated PostgreSQL engine. The tests do not add the missing JSON header on the client's behalf.

Verified behavior:

- Support submissions save the subject, priority, initial message and optional order reference, return 201, show success and refresh the ticket list.
- Seller applications save the store name, slug and business/contact fields as a pending profile, return 201 and show success. Approval remains an administrator action.
- Successful submissions reset the form. Validation failures and duplicate applications preserve entered data and display an error.
- Authentication and CSRF remain enforced. Support tickets remain restricted to their owner.

Before this fix, the two new support success tests reproduced the 400 response; the three other form tests passed. After the fix, all five form tests pass. The complete suite passes 32 tests, including all 27 tests from the earlier release.

Run `npm run forms:check` for the new form tests or `npm test` for the full suite. See `VALIDATION-v19.3.md` for browser checks and testing limits.

No new dependencies or database schema changes are required for this update. This is a focused fix for the reported form submission defect; it does not add a support conversation interface or change the seller approval workflow.
