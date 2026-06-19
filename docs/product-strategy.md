# Product strategy

## Recommendation

Sell this first as a productized service powered by your SaaS, then gradually expose self-service. Migrations are high-trust, irregular and full of edge cases; pure self-service too early creates expensive support and refund risk.

The WordPress plugin should remain free because it lowers installation friction. Revenue belongs in the hosted control plane: extraction, storage, validation, collaboration, reports and managed cutover.

## Suggested offers

- SEO Audit — USD 49–149 per site.
- Assisted Migration — USD 399–1,500 depending on content volume.
- Agency — USD 199–499/month including migration credits and white-label reports.
- Enterprise — annual contract for private workers, retention controls and SLAs.

Charge for successful migration capacity, not browser runtime. Include a clearly defined entity allowance and overage for media or large historical datasets.

## Defensibility

- Newpages-specific extraction knowledge and version adapters.
- Coverage scoring based on public site, CMS modules and imported WordPress records.
- Idempotent import and rollback discipline.
- SEO redirect intelligence from legacy URL families.
- Growing library of migration edge cases and normalization rules.

## Go-to-market

1. Use the tool internally for 10–20 paid migrations.
2. Turn recurring exceptions into automated rules.
3. Add an agency portal and white-label audit report.
4. Offer self-service audit before self-service migration.
5. Expand the source-adapter interface to adjacent legacy CMS platforms.

## Non-negotiables before public launch

- Terms confirming customer authorization to access and migrate the source.
- Data-processing agreement and documented PII retention.
- Tenant authentication, RBAC and billing.
- CAPTCHA/2FA human handoff without storing long-lived browser sessions.
- Support policy and a migration rollback procedure.
- Monitoring, backups, queue dashboards and incident response.
