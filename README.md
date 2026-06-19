# NewPages → WordPress

A multi-tenant migration platform that inventories Newpages sites, captures CMS data and media, normalizes content, generates SEO migration assets, and imports safely into WordPress.

## Why this product shape

The scalable product is a hosted SaaS with background workers and a WordPress receiver plugin. Browser automation runs in isolated worker containers, migrations are resumable, every artifact is checksummed, and imports are idempotent. A browser extension is an optional future login/session bridge—not the core product.

## Monorepo

- `apps/api`: REST API and lightweight operations dashboard.
- `apps/worker`: BullMQ worker for long-running migration jobs.
- `packages/core`: migration domain, pipeline, SEO and security primitives.
- `packages/newpages-adapter`: public-site and authenticated CMS extraction.
- `packages/wordpress-client`: WordPress REST/receiver client.
- `wordpress-plugin/newpages-migrator`: secure WordPress receiver and migration UI.
- `infra`: local/production-oriented Postgres, Redis and object-storage stack.

## Quick start

1. Copy `.env.example` to `.env`.
2. Run `npm install`.
3. Run `npm test`.
4. Run `npm run dev`.
5. Open `http://localhost:4300`.

Development defaults to inline jobs and a file-backed repository. Set `RUN_JOBS_INLINE=false` and start the worker for queued operation.

## Product tiers

- Audit: crawl, inventory, SEO/redirect report.
- Migration: complete archive plus WordPress import.
- Agency: multiple workspaces, white-label reports and reusable templates.
- Enterprise: private workers, custom retention and migration SLAs.

See `docs/architecture.md`, `docs/security.md`, and `docs/roadmap.md`.

The installable receiver plugin is generated at
`artifacts/newpages-migrator.zip`.
