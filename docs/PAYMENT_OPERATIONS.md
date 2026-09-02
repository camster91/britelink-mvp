# Payment event operations

The database now provides a privacy-minimal, idempotent payment-state boundary. It does **not** verify payment-provider signatures or create checkout sessions.

## Required production flow

1. A server-side webhook endpoint receives the provider request and verifies its signature against a secret held outside the browser and repository.
2. The endpoint maps only the verified event key, checkout ID, package, status, currency, amount, case, and provider occurrence time into `admin_ingest_payment_event`.
3. The RPC validates household/case/package/order consistency, rejects future or stale events, permits only valid state progressions, binds paid orders to cases, and makes refund or chargeback terminal.
4. The endpoint acknowledges an exact replay as already processed. A reused event key with altered content is rejected and must alert an operator.

Never store the raw webhook payload, card details, billing address, signature, or provider secret in `payment_events` or application logs. Browser and direct table writes are denied; staff views are read-only.

## Operator checks

- Compare each incident against the immutable `payment_events` row and its `payment.status_ingested` audit event.
- Investigate replay mismatch, stale-event, amount, currency, package, or case-binding failures before retrying.
- Do not manually change `orders.payment_status` or a case terminal state.
- Test paid, exact replay, altered replay, refund, stale event, and chargeback paths in staging before enabling checkout.

## Remaining release evidence

- Select a provider and implement its official signature-verification library at the webhook edge.
- Configure secrets and rotation, webhook rate limiting, alerting, and dead-letter/retry handling.
- Run staging events from the provider and reconcile them against the provider dashboard.
