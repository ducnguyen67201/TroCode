# Knowledge Spaces

Knowledge Spaces are implemented by the Rust API, worker, and Tauri host.

Metadata, memberships, groups, invites, Activities, immutable published
versions, Runs, assignments, Attempts, Work Sessions, evidence, and event
sequences live in PostgreSQL. Source and submission bytes live in a private
S3-compatible bucket. Extracted chunks use PostgreSQL full-text search and are
authorized through the exact published Activity version pinned to an Attempt.

Uploads are explicit file selections. The desktop hashes each selected regular
file, the API issues an exact presigned PUT, and completion performs HEAD
reconciliation before queuing ingestion. The worker checks the downloaded size
and SHA-256 again. Public bucket access and bucket listing are unnecessary.

Starter files are also explicit. The desktop downloads only the published
starter versions, validates relative paths, sizes, and SHA-256 values into a
staging directory, atomically publishes the directory, and registers it as a
new trusted Workspace. It never overwrites an existing workspace or runs
starter code.

Submissions are separate from task completion. The participant previews and
selects files, and the Activity must declare `requiresSubmission`. Task
completion never uploads files implicitly.

## Deployment

Set `TROCODE_KNOWLEDGE_SPACES_ENABLED=true` on the API only after configuring
the private bucket variables listed in `.env.example`. Deploy `tro-worker` as a
separate Railway service with the same database and bucket values. Stop the old
worker before scaling Rust workers, then observe lease age, retries, permanent
failures, S3 errors, and database pool saturation.

Rollback application binaries before changing data. Migrations are forward-only
and compatible with the previous API during the rollback window. If the Rust
worker is unhealthy, stop its replicas before restarting the previous worker so
only one implementation claims leases. See the
[API cutover runbook](runbooks/rust-api-cutover.md).
