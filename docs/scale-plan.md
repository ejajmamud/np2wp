# NP2WP scale plan

NP2WP should grow as a migration operations platform, not as a single-purpose
scraper. The durable product is the control plane, adapter ecosystem, migration
evidence, and safe cutover workflow.

## Phase 1: reliable operations

- Version every queue run so retries cannot collide with retained BullMQ jobs.
- Persist lifecycle events, progress, errors, priorities, and operator actions.
- Support create, edit, delete, run, retry, pause, resume, and cancel.
- Expose queue health and active/waiting/failed workload counts.
- Keep every pipeline stage idempotent and resumable from object-storage
  checkpoints.

## Phase 2: commercial control plane

- Replace shared API tokens with organizations, users, sessions, RBAC, and
  scoped service accounts.
- Separate projects, source connections, destinations, migrations, runs,
  entities, events, artifacts, and audit records into normalized tables.
- Add WebSocket or server-sent event delivery backed by Redis Streams.
- Add per-tenant quotas, source-domain concurrency limits, usage metering,
  billing, retention policies, and white-label reporting.
- Add a human-in-the-loop browser session for CAPTCHA, MFA, and credential
  refresh without exposing long-lived secrets to operators.

## Phase 3: migration cloud

- Run workers in isolated, autoscaled pools selected by adapter and workload.
- Use an outbox pattern for transactional job publication and event delivery.
- Partition high-volume event and entity tables; move raw payloads and media to
  immutable object storage.
- Add adapter versioning, replayable runs, dead-letter queues, automatic
  remediation, and canary workers.
- Add OpenTelemetry traces, queue-lag SLOs, worker heartbeats, structured audit
  logs, backup verification, incident automation, and regional disaster
  recovery.

## Product model

- Begin with assisted migrations and agency workspaces.
- Keep the WordPress receiver free; charge for extraction, validation,
  collaboration, storage, reporting, and managed cutover.
- Expand through versioned source adapters rather than cloning the product for
  each CMS.

## Engineering rules

1. A database state change and queue publication must never silently disagree.
2. Every external write must be idempotent.
3. Every operator action must be authorized and auditable.
4. Every long-running operation must expose progress and support safe
   cancellation.
5. Secrets are encrypted, scoped, rotated, redacted, and never returned by APIs.
6. A completed migration includes machine-verifiable coverage evidence.
