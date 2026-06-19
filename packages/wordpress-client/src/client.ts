import {
  createHmac,
  randomUUID,
} from "node:crypto";
import type {
  MigrationBundle,
  NormalizedContent,
  WordPressConfig,
} from "@np2wp/core";

export interface WordPressImportResult {
  pages: number;
  products: number;
  media: number;
  redirects: number;
  importId: string;
}

export class WordPressClient {
  constructor(private readonly config: WordPressConfig) {}

  private authHeaders(): Record<string, string> {
    if (this.config.username && this.config.applicationPassword) {
      return {
        authorization: `Basic ${Buffer.from(
          `${this.config.username}:${this.config.applicationPassword}`,
        ).toString("base64")}`,
      };
    }
    return {};
  }

  private async request<T>(
    route: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(new URL(route, this.config.baseUrl), {
      ...init,
      headers: {
        accept: "application/json",
        ...this.authHeaders(),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(
        `WordPress request failed ${response.status}: ${(await response.text()).slice(0, 1000)}`,
      );
    }
    return (await response.json()) as T;
  }

  async probe(): Promise<{ name: string; url: string; receiver: boolean }> {
    const index = await this.request<{ name: string; url: string; namespaces?: string[] }>(
      "/wp-json/",
    );
    return {
      name: index.name,
      url: index.url,
      receiver: Boolean(index.namespaces?.includes("np2wp/v1")),
    };
  }

  async importBundle(bundle: MigrationBundle): Promise<WordPressImportResult> {
    if (this.config.receiverToken) {
      return this.importThroughReceiver(bundle);
    }
    return this.importThroughCoreRest(bundle);
  }

  private async importThroughReceiver(
    bundle: MigrationBundle,
  ): Promise<WordPressImportResult> {
    const body = JSON.stringify(bundle);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", this.config.receiverToken!)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    return this.request<WordPressImportResult>("/wp-json/np2wp/v1/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-np2wp-timestamp": timestamp,
        "x-np2wp-signature": signature,
      },
      body,
    });
  }

  private async upsertCoreContent(
    entity: NormalizedContent,
    type: "pages" | "posts",
  ): Promise<number> {
    const existing = await this.request<Array<{ id: number }>>(
      `/wp-json/wp/v2/${type}?slug=${encodeURIComponent(entity.slug)}&context=edit`,
    );
    const payload = {
      title: entity.title,
      slug: entity.slug,
      content: entity.contentHtml,
      excerpt: entity.excerpt,
      status: this.config.publishMode,
      meta: {
        np2wp_source_id: entity.sourceId,
        np2wp_source_url: entity.sourceUrl,
        np2wp_seo_title: entity.seo.title,
        np2wp_seo_description: entity.seo.description,
      },
    };
    const result = await this.request<{ id: number }>(
      existing[0]
        ? `/wp-json/wp/v2/${type}/${existing[0].id}`
        : `/wp-json/wp/v2/${type}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    return result.id;
  }

  private async importThroughCoreRest(
    bundle: MigrationBundle,
  ): Promise<WordPressImportResult> {
    for (const page of bundle.pages) await this.upsertCoreContent(page, "pages");
    for (const product of bundle.products)
      await this.upsertCoreContent(product, "posts");
    return {
      pages: bundle.pages.length,
      products: bundle.products.length,
      media: 0,
      redirects: 0,
      importId: randomUUID(),
    };
  }
}
