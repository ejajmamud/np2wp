=== NewPages Migrator ===
Contributors: np2wp
Tags: migration, newpages, importer, seo, redirects
Requires at least: 6.5
Tested up to: 6.8
Requires PHP: 8.1
Stable tag: 0.1.0
License: GPLv2 or later

Secure and idempotent receiver for the NP2WP migration platform.

== Description ==

The plugin registers a migrated-product content type, imports pages/products/media,
stores SEO metadata, and preserves legacy URLs with 301 redirects. Imports are
authenticated with timestamped HMAC signatures and update existing records using
stable Newpages source IDs.

== Installation ==

1. Upload and activate the plugin.
2. Open Tools > NewPages Migrator.
3. Copy the receiver URL and token into the NP2WP dashboard.
4. Run the migration in draft mode and review before publishing.
