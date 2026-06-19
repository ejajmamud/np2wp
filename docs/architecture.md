# Architecture

```text
Customer / Agency
       |
       v
 API + Dashboard ---- Postgres (tenants, jobs, mappings, audit)
       |
       +---- Redis/BullMQ ---- isolated Playwright workers
       |                            |
       |                            +---- Newpages public site + merchant CMS
       |                            +---- object storage (raw/normalized/media)
       |
       +---- WordPress client ---- receiver plugin / WP REST API
```

## Pipeline

1. `discover`: sitemap, navigation, CMS modules and capabilities.
2. `extract`: pages, products, categories, tags, media, settings and records.
3. `normalize`: stable IDs, canonical entities, HTML sanitation and deduplication.
4. `optimize`: metadata, redirects, image SEO and structured data.
5. `validate`: coverage, checksums, broken assets and migration blockers.
6. `import`: media first, then taxonomies, content, menus and redirects.
7. `verify`: compare source/target counts, URLs, metadata and screenshots.

Every step is idempotent and writes a checkpoint. A retry continues from the last successful checkpoint.

## Scaling model

- API instances remain stateless.
- Worker concurrency is controlled per tenant and per source domain.
- Browser contexts are isolated per migration; no shared cookies.
- Large artifacts go to object storage, not the relational database.
- Queue jobs use deterministic IDs to prevent duplicate execution.
- WordPress writes use a source entity key, making re-imports updates rather than duplicates.
