<?php
/**
 * Plugin Name: NewPages Migrator
 * Description: Secure, idempotent receiver for Newpages to WordPress migrations.
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * Author: NP2WP
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

final class NP2WP_Receiver {
    private const OPTION_TOKEN = 'np2wp_receiver_token';
    private const OPTION_REDIRECTS = 'np2wp_redirects';
    private const META_SOURCE_ID = '_np2wp_source_id';
    private const META_SOURCE_URL = '_np2wp_source_url';
    private const META_SEO_TITLE = '_np2wp_seo_title';
    private const META_SEO_DESCRIPTION = '_np2wp_seo_description';
    private const META_SCHEMA = '_np2wp_schema';
    private const REST_NAMESPACE = 'np2wp/v1';

    public static function init(): void {
        add_action('init', [self::class, 'register_content_types']);
        add_action('rest_api_init', [self::class, 'register_routes']);
        add_action('admin_menu', [self::class, 'admin_menu']);
        add_action('admin_init', [self::class, 'register_settings']);
        add_action('template_redirect', [self::class, 'handle_redirect'], 1);
        add_filter('pre_get_document_title', [self::class, 'document_title'], 30);
        add_action('wp_head', [self::class, 'head_metadata'], 1);
        add_action('wp_head', [self::class, 'head_schema'], 30);
    }

    public static function activate(): void {
        self::register_content_types();
        if (!get_option(self::OPTION_TOKEN)) {
            update_option(self::OPTION_TOKEN, wp_generate_password(48, false, false), false);
        }
        flush_rewrite_rules();
    }

    public static function register_content_types(): void {
        register_post_type('np2wp_product', [
            'labels' => [
                'name' => __('Migrated Products', 'newpages-migrator'),
                'singular_name' => __('Migrated Product', 'newpages-migrator'),
            ],
            'public' => true,
            'show_in_rest' => true,
            'menu_icon' => 'dashicons-products',
            'supports' => ['title', 'editor', 'excerpt', 'thumbnail', 'custom-fields'],
            'rewrite' => ['slug' => 'products', 'with_front' => false],
        ]);
        register_taxonomy('np2wp_product_category', ['np2wp_product'], [
            'labels' => ['name' => __('Product Categories', 'newpages-migrator')],
            'public' => true,
            'show_in_rest' => true,
            'hierarchical' => true,
            'rewrite' => ['slug' => 'product-category', 'with_front' => false],
        ]);
        register_taxonomy('np2wp_product_tag', ['np2wp_product'], [
            'labels' => ['name' => __('Product Tags', 'newpages-migrator')],
            'public' => true,
            'show_in_rest' => true,
            'hierarchical' => false,
            'rewrite' => ['slug' => 'product-tag', 'with_front' => false],
        ]);
        foreach ([
            self::META_SOURCE_ID,
            self::META_SOURCE_URL,
            self::META_SEO_TITLE,
            self::META_SEO_DESCRIPTION,
            self::META_SCHEMA,
        ] as $key) {
            register_post_meta('', $key, [
                'type' => 'string',
                'single' => true,
                'show_in_rest' => true,
                'auth_callback' => static fn() => current_user_can('edit_posts'),
                'sanitize_callback' => 'sanitize_text_field',
            ]);
        }
    }

    public static function register_routes(): void {
        register_rest_route(self::REST_NAMESPACE, '/status', [
            'methods' => 'GET',
            'callback' => static fn() => new WP_REST_Response([
                'ready' => (bool) get_option(self::OPTION_TOKEN),
                'version' => '0.1.0',
                'product_post_type' => 'np2wp_product',
            ]),
            'permission_callback' => '__return_true',
        ]);
        register_rest_route(self::REST_NAMESPACE, '/import', [
            'methods' => 'POST',
            'callback' => [self::class, 'import'],
            'permission_callback' => [self::class, 'verify_signature'],
        ]);
    }

    public static function verify_signature(WP_REST_Request $request): bool|WP_Error {
        $token = (string) get_option(self::OPTION_TOKEN);
        $timestamp = (string) $request->get_header('x-np2wp-timestamp');
        $signature = (string) $request->get_header('x-np2wp-signature');
        if ($token === '' || $timestamp === '' || $signature === '') {
            return new WP_Error('np2wp_missing_signature', 'Missing migration signature.', ['status' => 401]);
        }
        if (!ctype_digit($timestamp) || abs(time() - (int) $timestamp) > 300) {
            return new WP_Error('np2wp_expired_signature', 'Expired migration signature.', ['status' => 401]);
        }
        $expected = hash_hmac('sha256', $timestamp . '.' . $request->get_body(), $token);
        if (!hash_equals($expected, $signature)) {
            return new WP_Error('np2wp_invalid_signature', 'Invalid migration signature.', ['status' => 401]);
        }
        return true;
    }

    public static function import(WP_REST_Request $request): WP_REST_Response|WP_Error {
        $bundle = $request->get_json_params();
        if (!is_array($bundle) || ($bundle['version'] ?? null) !== '1') {
            return new WP_Error('np2wp_invalid_bundle', 'Unsupported migration bundle.', ['status' => 400]);
        }
        $import_id = wp_generate_uuid4();
        $counts = ['pages' => 0, 'products' => 0, 'media' => 0, 'redirects' => 0];
        $media = self::import_media((array) ($bundle['media'] ?? []));
        $counts['media'] = count(array_filter($media));
        $categories = self::import_terms(
            (array) ($bundle['categories'] ?? []),
            'np2wp_product_category'
        );
        $tags = self::import_terms(
            (array) ($bundle['tags'] ?? []),
            'np2wp_product_tag'
        );

        foreach ((array) ($bundle['pages'] ?? []) as $entity) {
            $post_id = self::upsert_content((array) $entity, 'page', $media, [], []);
            if (is_wp_error($post_id)) {
                return $post_id;
            }
            $counts['pages']++;
        }
        foreach ((array) ($bundle['products'] ?? []) as $entity) {
            $post_id = self::upsert_content(
                (array) $entity,
                'np2wp_product',
                $media,
                $categories,
                $tags
            );
            if (is_wp_error($post_id)) {
                return $post_id;
            }
            $counts['products']++;
        }
        $redirects = [];
        foreach ((array) ($bundle['redirects'] ?? []) as $redirect) {
            $source = self::normalize_path((string) ($redirect['sourcePath'] ?? ''));
            $target = esc_url_raw((string) ($redirect['targetUrl'] ?? ''));
            if ($source !== '' && $target !== '') {
                $redirects[$source] = $target;
            }
        }
        update_option(self::OPTION_REDIRECTS, $redirects, false);
        $counts['redirects'] = count($redirects);
        update_option('np2wp_last_import', [
            'id' => $import_id,
            'source_host' => sanitize_text_field((string) ($bundle['sourceHost'] ?? '')),
            'counts' => $counts,
            'imported_at' => current_time('mysql', true),
        ], false);
        flush_rewrite_rules(false);

        return new WP_REST_Response([
            'pages' => $counts['pages'],
            'products' => $counts['products'],
            'media' => $counts['media'],
            'redirects' => $counts['redirects'],
            'importId' => $import_id,
        ], 200);
    }

    private static function upsert_content(
        array $entity,
        string $post_type,
        array $media,
        array $categories,
        array $tags
    ): int|WP_Error {
        $source_id = sanitize_text_field((string) ($entity['sourceId'] ?? ''));
        if ($source_id === '') {
            return new WP_Error('np2wp_missing_source_id', 'Content entity lacks a source ID.', ['status' => 400]);
        }
        $existing = get_posts([
            'post_type' => $post_type,
            'post_status' => 'any',
            'numberposts' => 1,
            'fields' => 'ids',
            'meta_key' => self::META_SOURCE_ID,
            'meta_value' => $source_id,
            'suppress_filters' => true,
        ]);
        $post = [
            'ID' => $existing[0] ?? 0,
            'post_type' => $post_type,
            'post_title' => sanitize_text_field((string) ($entity['title'] ?? 'Untitled')),
            'post_name' => sanitize_title((string) ($entity['slug'] ?? '')),
            'post_content' => wp_kses_post((string) ($entity['contentHtml'] ?? '')),
            'post_excerpt' => sanitize_textarea_field((string) ($entity['excerpt'] ?? '')),
            'post_status' => in_array(($entity['status'] ?? 'draft'), ['draft', 'publish'], true)
                ? $entity['status']
                : 'draft',
        ];
        $post_id = wp_insert_post($post, true);
        if (is_wp_error($post_id)) {
            return $post_id;
        }
        update_post_meta($post_id, self::META_SOURCE_ID, $source_id);
        update_post_meta(
            $post_id,
            self::META_SOURCE_URL,
            esc_url_raw((string) ($entity['sourceUrl'] ?? ''))
        );
        $seo = (array) ($entity['seo'] ?? []);
        update_post_meta($post_id, self::META_SEO_TITLE, sanitize_text_field((string) ($seo['title'] ?? '')));
        update_post_meta(
            $post_id,
            self::META_SEO_DESCRIPTION,
            sanitize_text_field((string) ($seo['description'] ?? ''))
        );
        if (isset($entity['schema']) && is_array($entity['schema'])) {
            update_post_meta($post_id, self::META_SCHEMA, wp_json_encode($entity['schema']));
        }
        self::write_seo_plugin_meta($post_id, $seo);

        $featured_source = sanitize_file_name((string) ($entity['featuredMediaSourceId'] ?? ''));
        if ($featured_source !== '' && isset($media[$featured_source])) {
            set_post_thumbnail($post_id, (int) $media[$featured_source]);
        }
        if ($post_type === 'np2wp_product') {
            self::assign_terms($post_id, (array) ($entity['categories'] ?? []), $categories, 'np2wp_product_category');
            self::assign_terms($post_id, (array) ($entity['tags'] ?? []), $tags, 'np2wp_product_tag');
        }
        return $post_id;
    }

    private static function write_seo_plugin_meta(int $post_id, array $seo): void {
        $title = sanitize_text_field((string) ($seo['title'] ?? ''));
        $description = sanitize_text_field((string) ($seo['description'] ?? ''));
        $keyword = sanitize_text_field((string) ($seo['primaryKeyword'] ?? ''));
        update_post_meta($post_id, '_yoast_wpseo_title', $title);
        update_post_meta($post_id, '_yoast_wpseo_metadesc', $description);
        update_post_meta($post_id, '_yoast_wpseo_focuskw', $keyword);
        update_post_meta($post_id, 'rank_math_title', $title);
        update_post_meta($post_id, 'rank_math_description', $description);
        update_post_meta($post_id, 'rank_math_focus_keyword', $keyword);
        if (($seo['robots'] ?? '') === 'noindex,follow') {
            update_post_meta($post_id, '_yoast_wpseo_meta-robots-noindex', '1');
            update_post_meta($post_id, 'rank_math_robots', ['noindex', 'follow']);
        }
    }

    private static function import_terms(array $terms, string $taxonomy): array {
        $map = [];
        foreach ($terms as $term) {
            $source_id = sanitize_text_field((string) ($term['sourceId'] ?? ''));
            $name = sanitize_text_field((string) ($term['name'] ?? ''));
            if ($source_id === '' || $name === '') {
                continue;
            }
            $existing = term_exists($name, $taxonomy);
            if (!$existing) {
                $existing = wp_insert_term($name, $taxonomy, [
                    'slug' => sanitize_title((string) ($term['slug'] ?? $name)),
                    'description' => sanitize_textarea_field((string) ($term['description'] ?? '')),
                ]);
            }
            if (!is_wp_error($existing)) {
                $map[$name] = (int) (is_array($existing) ? $existing['term_id'] : $existing);
            }
        }
        return $map;
    }

    private static function assign_terms(
        int $post_id,
        array $names,
        array $known,
        string $taxonomy
    ): void {
        $ids = [];
        foreach ($names as $name) {
            $clean = sanitize_text_field((string) $name);
            if (isset($known[$clean])) {
                $ids[] = (int) $known[$clean];
                continue;
            }
            $term = term_exists($clean, $taxonomy);
            if (!$term) {
                $term = wp_insert_term($clean, $taxonomy);
            }
            if (!is_wp_error($term)) {
                $ids[] = (int) (is_array($term) ? $term['term_id'] : $term);
            }
        }
        wp_set_object_terms($post_id, array_values(array_unique($ids)), $taxonomy, false);
    }

    private static function import_media(array $items): array {
        $map = [];
        if (!$items) {
            return $map;
        }
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';
        foreach ($items as $item) {
            $source_id = sanitize_file_name((string) ($item['sourceId'] ?? ''));
            $source_url = esc_url_raw((string) ($item['sourceUrl'] ?? ''));
            if ($source_id === '' || $source_url === '') {
                continue;
            }
            $existing = get_posts([
                'post_type' => 'attachment',
                'post_status' => 'inherit',
                'numberposts' => 1,
                'fields' => 'ids',
                'meta_key' => self::META_SOURCE_ID,
                'meta_value' => $source_id,
            ]);
            if ($existing) {
                $map[$source_id] = (int) $existing[0];
                continue;
            }
            $attachment_id = media_sideload_image(
                $source_url,
                0,
                sanitize_text_field((string) ($item['altText'] ?? '')),
                'id'
            );
            if (!is_wp_error($attachment_id)) {
                update_post_meta($attachment_id, self::META_SOURCE_ID, $source_id);
                update_post_meta(
                    $attachment_id,
                    '_wp_attachment_image_alt',
                    sanitize_text_field((string) ($item['altText'] ?? ''))
                );
                $map[$source_id] = (int) $attachment_id;
            }
        }
        return $map;
    }

    private static function normalize_path(string $path): string {
        $path = wp_parse_url($path, PHP_URL_PATH) ?: '';
        if ($path === '') {
            return '';
        }
        return '/' . ltrim($path, '/');
    }

    public static function handle_redirect(): void {
        if (is_admin() || wp_doing_ajax()) {
            return;
        }
        $path = self::normalize_path((string) ($_SERVER['REQUEST_URI'] ?? '/'));
        $redirects = (array) get_option(self::OPTION_REDIRECTS, []);
        if (isset($redirects[$path])) {
            wp_safe_redirect($redirects[$path], 301, 'NewPages Migrator');
            exit;
        }
    }

    public static function document_title(string $title): string {
        if (defined('WPSEO_VERSION') || defined('RANK_MATH_VERSION') || !is_singular()) {
            return $title;
        }
        $custom = get_post_meta(get_queried_object_id(), self::META_SEO_TITLE, true);
        return $custom ?: $title;
    }

    public static function head_metadata(): void {
        if (defined('WPSEO_VERSION') || defined('RANK_MATH_VERSION') || !is_singular()) {
            return;
        }
        $description = get_post_meta(
            get_queried_object_id(),
            self::META_SEO_DESCRIPTION,
            true
        );
        if ($description) {
            echo '<meta name="description" content="' . esc_attr($description) . '">' . "\n";
        }
        echo '<link rel="canonical" href="' . esc_url(get_permalink()) . '">' . "\n";
    }

    public static function head_schema(): void {
        if (!is_singular()) {
            return;
        }
        $schema = get_post_meta(get_queried_object_id(), self::META_SCHEMA, true);
        if ($schema) {
            echo '<script type="application/ld+json">' .
                wp_json_encode(json_decode($schema, true), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) .
                '</script>' . "\n";
        }
    }

    public static function register_settings(): void {
        register_setting('np2wp_settings', self::OPTION_TOKEN, [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
        ]);
    }

    public static function admin_menu(): void {
        add_management_page(
            __('NewPages Migrator', 'newpages-migrator'),
            __('NewPages Migrator', 'newpages-migrator'),
            'manage_options',
            'np2wp',
            [self::class, 'settings_page']
        );
    }

    public static function settings_page(): void {
        if (!current_user_can('manage_options')) {
            return;
        }
        $last_import = get_option('np2wp_last_import', []);
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('NewPages Migrator', 'newpages-migrator'); ?></h1>
            <p>Connect this site to the NP2WP migration platform. Treat the receiver token like a password.</p>
            <form method="post" action="options.php">
                <?php settings_fields('np2wp_settings'); ?>
                <table class="form-table">
                    <tr>
                        <th scope="row"><label for="np2wp_receiver_token">Receiver token</label></th>
                        <td>
                            <input class="regular-text code" id="np2wp_receiver_token"
                                   name="<?php echo esc_attr(self::OPTION_TOKEN); ?>"
                                   value="<?php echo esc_attr((string) get_option(self::OPTION_TOKEN)); ?>">
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Receiver URL</th>
                        <td><code><?php echo esc_html(rest_url(self::REST_NAMESPACE . '/import')); ?></code></td>
                    </tr>
                </table>
                <?php submit_button(); ?>
            </form>
            <?php if ($last_import) : ?>
                <h2>Last import</h2>
                <pre><?php echo esc_html(wp_json_encode($last_import, JSON_PRETTY_PRINT)); ?></pre>
            <?php endif; ?>
        </div>
        <?php
    }
}

NP2WP_Receiver::init();
register_activation_hook(__FILE__, [NP2WP_Receiver::class, 'activate']);
