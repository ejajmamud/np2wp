import {
  buildRedirects,
  buildSeoRecord,
  sha256,
  slugify,
  textFromHtml,
  type MigrationBundle,
  type NormalizedContent,
  type NormalizedTerm,
} from "@np2wp/core";
import type { CapturedApiCall, NewpagesExtraction } from "./types.js";

function parseResponse(call: CapturedApiCall | undefined): unknown {
  if (!call?.responseBody) return undefined;
  try {
    return JSON.parse(call.responseBody);
  } catch {
    return undefined;
  }
}

function dataFor(
  calls: CapturedApiCall[],
  suffix: string,
): Record<string, unknown> | undefined {
  const parsed = parseResponse(calls.findLast((call) => call.url.endsWith(suffix)));
  if (!parsed || typeof parsed !== "object") return undefined;
  return (parsed as { data?: Record<string, unknown> }).data;
}

export function normalizeNewpages(
  extraction: NewpagesExtraction,
  targetBaseUrl: string,
): MigrationBundle {
  const categoriesData = dataFor(
    extraction.apiCalls,
    "/product_category/listAll",
  ) as { product_category?: Array<Record<string, string>> } | undefined;
  const tagsData = dataFor(extraction.apiCalls, "/product_tag/list") as
    | { product_tag?: Array<Record<string, string>> }
    | undefined;
  const categories: NormalizedTerm[] = (
    categoriesData?.product_category ?? []
  ).map((category) => ({
    sourceId: category.key,
    name: category.title,
    slug: slugify(category.title),
  }));
  const tags: NormalizedTerm[] = (tagsData?.product_tag ?? []).map((tag) => ({
    sourceId: tag.tag_id,
    name: tag.tag,
    slug: slugify(tag.tag),
  }));

  const productCalls = extraction.apiCalls.filter((call) =>
    call.url.endsWith("/product/get"),
  );
  const seenProducts = new Set<string>();
  const products: NormalizedContent[] = productCalls.flatMap((call) => {
    const payload = parseResponse(call) as
      | { data?: { product?: Record<string, unknown> } }
      | undefined;
    const product = payload?.data?.product;
    if (!product || typeof product.title !== "string") return [];
    let requestId: string | undefined;
    if (call.requestBody) {
      try {
        const requestJson = JSON.parse(call.requestBody) as Record<string, unknown>;
        requestId = String(requestJson.product_id ?? requestJson.id ?? "") || undefined;
      } catch {
        const request = new URLSearchParams(call.requestBody);
        requestId =
          request.get("product_id") ??
          request.get("id") ??
          call.requestBody.match(/(?:product_id|["']id["'])\D{0,6}(\d+)/)?.[1];
      }
    }
    const sourceId =
      requestId ?? String(product.id ?? sha256(product.title).slice(0, 12));
    if (seenProducts.has(sourceId)) return [];
    seenProducts.add(sourceId);
    const title = product.title;
    const slug = slugify(title.replace(/^GX\s+/i, ""));
    const contentHtml = String(product.description ?? "");
    const canonicalUrl = new URL(`/products/${slug}/`, targetBaseUrl).href;
    const productCategories = Array.isArray(product.product_categories)
      ? product.product_categories
          .map((item) =>
            typeof item === "object" && item && "name" in item
              ? String(item.name)
              : "",
          )
          .filter(Boolean)
      : [];
    return [
      {
        sourceId,
        kind: "product",
        title,
        slug,
        contentHtml,
        excerpt: textFromHtml(contentHtml).slice(0, 320),
        status: "draft",
        sourceUrl: `${extraction.discovery.sourceUrl}showproducts/productid/${sourceId}/`,
        canonicalUrl,
        seo: buildSeoRecord({
          title,
          contentHtml,
          primaryKeyword: `${title} Malaysia`,
        }),
        categories: productCategories,
        tags: String(product.tags ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        featuredMediaSourceId:
          typeof product.pic === "string" ? product.pic : undefined,
      } satisfies NormalizedContent,
    ];
  });

  const pageEntities: NormalizedContent[] = extraction.pages
    .filter((page) => {
      const pathname = new URL(page.url).pathname;
      return (
        pathname === "/" ||
        /\/pages\/pages_id\/|contact|privacy|terms/i.test(pathname)
      );
    })
    .map((page) => {
      const pageUrl = new URL(page.url);
      const source = extraction.discovery.pages.find((item) => {
        const itemUrl = new URL(item.url);
        return itemUrl.pathname === pageUrl.pathname;
      });
      const title = page.title.split("|")[0]?.trim() || "Page";
      const slug = page.url === extraction.discovery.sourceUrl ? "" : slugify(title);
      const canonicalUrl = new URL(slug ? `/${slug}/` : "/", targetBaseUrl).href;
      return {
        sourceId: source?.sourceId ?? sha256(page.url).slice(0, 12),
        kind: "page",
        title,
        slug,
        contentHtml: page.html,
        excerpt: page.description,
        status: "draft",
        sourceUrl: page.url,
        canonicalUrl,
        seo: buildSeoRecord({
          title,
          contentHtml: page.text,
          primaryKeyword: title,
        }),
        categories: [],
        tags: [],
      };
    });

  const allContent = [...pageEntities, ...products];
  return {
    version: "1",
    generatedAt: new Date().toISOString(),
    sourceHost: extraction.discovery.sourceHost,
    pages: pageEntities,
    products,
    categories,
    tags,
    media: extraction.mediaUrls.map((sourceUrl) => {
      const filename = new URL(sourceUrl).pathname.split("/").pop() || sha256(sourceUrl);
      return {
        sourceId: filename,
        sourceUrl,
        filename,
        altText: filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
      };
    }),
    redirects: buildRedirects(
      extraction.pages.map((page) => page.url),
      allContent,
    ),
    settings: {
      homepage: dataFor(extraction.apiCalls, "/company/homepage"),
      branches: dataFor(extraction.apiCalls, "/company/branches"),
      businessHours: dataFor(extraction.apiCalls, "/company/businesshour"),
      socialMedia: dataFor(extraction.apiCalls, "/company/socialmedia"),
      website: dataFor(extraction.apiCalls, "/company/websetting"),
      banners: dataFor(extraction.apiCalls, "/company/banner"),
    },
    manifest: [],
    warnings: extraction.warnings,
  };
}
