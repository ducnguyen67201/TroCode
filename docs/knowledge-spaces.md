# Knowledge Spaces

Knowledge Spaces are TroCode's database-backed container for reusable context and guided work. The vocabulary is intentionally general: a Space can be a class, onboarding program, workshop, research project, field procedure, or team playbook. Activities can be assignments, labs, drills, cases, or work orders.

## Canonical model

PostgreSQL owns Space membership, groups, immutable Activity versions, Runs, assignment snapshots, Attempts, Work Sessions, submissions, and evidence. A private S3-compatible bucket owns uploaded bytes. There is no required `trocode.space.yaml` and no folder-as-database behavior. A folder upload is a reviewed point-in-time snapshot.

```text
Space
├── Library (versioned Sources)
├── People and Groups
└── Activities
    └── immutable Activity Version
        └── Run (live, async, or hybrid)
            └── private Attempt
                ├── bounded Work Sessions
                ├── explicit submissions
                └── provenance-labeled evidence
```

## Launch context and performance

An Activity launch combines a compact immutable definition with fresh work context. Workspace Activities use one explicitly trusted local folder. Current-screen Activities force one fresh CUA observation; the semantic route is preferred when available and the existing screenshot route remains the fallback. Uploaded books and course material are not inserted wholesale. The task gets a title/role catalog and an Attempt-scoped `search_activity_knowledge` tool capped at six results and 12,000 characters.

Starter materialization is explicit. Electron main downloads exact pinned starter versions using short-lived GET tickets, validates path, size, and SHA-256, writes into a new staging directory, atomically renames it, and registers that directory as a trusted Workspace. It never overwrites or runs starter code.

## Privacy and insights

Participants see the Run's insight policy before starting. The default policy reports explicit help requests and operational state. Optional agent candidates are bounded to allowlisted criteria/tags, capped per Work Session, and labeled as hypotheses. They cannot grade, diagnose, or change Attempt state. Facilitators receive no live screen, ordinary task conversation, unsaved editor state, or unrelated local files.

Submission is a separate participant action. The renderer previews relative paths; Electron main hashes and uploads only those selected files. Task completion never triggers upload.

## Deployment and rollback

Set `TROCODE_KNOWLEDGE_SPACES_ENABLED=true` only on the hosted API after configuring private bucket credentials. Run `npm --prefix services/api run start:worker` as a separate Railway worker process. The bucket role should permit only exact-object `PutObject`, `GetObject`, and `HeadObject`; public access and bucket listing should be denied.

Back up PostgreSQL metadata and object storage together. Retention deletion must remove metadata and objects through an audited job; never infer object keys in desktop code. To roll back, disable the feature flag first, stop the worker after its current lease, and retain both stores. Disabling the flag hides desktop navigation and rejects feature routes without deleting data.

The operational load script covers 200/500-row dashboard projection. Real assignment/start/search latency gates run only with `TEST_DATABASE_URL` and a disposable S3-compatible test service.
