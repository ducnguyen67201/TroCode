# Rust API and worker cutover

## Preconditions

- `npm run check` passes from a clean checkout.
- API and worker release images build from the committed `Cargo.lock`.
- Railway has a current database snapshot and the previous API/worker deployment
  IDs are recorded.
- API variables contain PostgreSQL, Google, OpenAI, session-HMAC, and optional
  ElevenLabs settings. Knowledge variables are complete before the flag is
  enabled.
- The bucket is private and the service account is restricted to exact-object
  PUT, GET, and HEAD.

## Deploy

1. Deploy the API image with zero public traffic. Its pre-deploy command runs
   `tro-migrate up` under the migration advisory lock.
2. Check `/healthz`, `/readyz`, sanitized startup logs, schema status, and pool
   usage.
3. Run `tro-admin contract compare` and `tro-admin load api --profile safe-ci`.
4. Verify auth exchange/refresh/revoke, access status, budget, and a non-paid
   error path. Never mirror a paid or mutating request to two implementations.
5. Stop the previous Knowledge worker. Start one Rust worker, verify lease claim
   and one disposable ingestion, then scale gradually.
6. Route a small API cohort, compare status/error/latency and usage reservation
   state, then promote only while error and uncertainty rates remain normal.

## Rollback

1. Stop Rust worker replicas before starting the prior worker implementation.
2. Route API traffic back to the recorded previous deployment.
3. Do not run destructive down migrations. The SQL baseline is forward-only;
   use a reviewed forward repair if data correction is required.
4. Reconcile reservations left in `reserved` or `uncertain` state before any
   manual retry. Never replay provider requests whose admission is unknown.
5. Preserve Rust logs and deployment IDs without exporting secrets or content.

Promotion to a broad cohort requires an observation window appropriate to the
release risk; a successful deploy alone is not proof of production parity.
