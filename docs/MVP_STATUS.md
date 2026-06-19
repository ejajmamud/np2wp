# MVP status

## Working now

- Multi-tenant migration records with encrypted credentials.
- File or PostgreSQL control-plane repository.
- Inline development execution or Redis/BullMQ workers.
- File or S3-compatible checkpoint storage.
- Newpages sitemap discovery with browser-challenge fallback.
- Concurrent public-site crawling and authenticated merchant-panel capture.
- Product/category/tag/page normalization.
- SEO metadata and legacy redirect generation.
- Resumable, idempotent pipeline checkpoints.
- WordPress REST client.
- HMAC-authenticated WordPress receiver plugin.
- Idempotent WordPress page, product, taxonomy and media imports.
- Lightweight operations dashboard.
- Docker, Kubernetes/HPA and CI scaffolding.

## Before charging self-service customers

- Replace the development bearer token with real user authentication and RBAC.
- Add Stripe billing, quotas and usage metering.
- Add CAPTCHA/2FA interactive handoff.
- Add full object/media binary streaming to object storage.
- Add per-tenant encryption keys through a cloud KMS.
- Add observability, queue administration, alerting and backups.
- Add staging screenshot comparison and full destination verification.
- Exercise the receiver against clean WordPress and WooCommerce installations.
- Add legal authorization, privacy retention and deletion workflows.

The current build is an agency/internal alpha: useful for real supervised migrations,
but intentionally not represented as an unattended public SaaS.
