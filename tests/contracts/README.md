# Cross-runtime contract fixtures

These fixtures freeze the public HTTP and renderer boundary during the Rust
migration. Files contain synthetic identifiers and sanitized payloads only.

- `http/` contains request and response envelopes, expected status, selected
  headers, and ordered stream chunks.
- `desktop/` contains command payloads, results, and ordered event payloads.
- `domain/` contains canonical lifecycle, approval, policy, and budget cases.

Rust tests and retained TypeScript tests must parse the same file. JSON object
keys are canonicalized before comparison; stream chunks preserve byte order.
