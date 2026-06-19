# Security

- Never log source or WordPress passwords.
- Encrypt credentials using AES-256-GCM and a managed KMS-backed key in production.
- Delete source credentials and browser state after extraction unless the customer explicitly enables retention.
- Use short-lived, tenant-scoped import tokens.
- The WordPress receiver validates HMAC signatures, timestamps, permissions and payload limits.
- Apply SSRF controls: only connect to validated customer-owned HTTP(S) hosts.
- Run browsers without host filesystem access in disposable containers.
- Keep a complete audit log of reads, exports and WordPress writes.
- Redact enquiry PII in previews and apply configurable retention.
- Rate-limit tenant, source-domain and destination-domain traffic.
