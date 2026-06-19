import type { NormalizedContent, RedirectRecord, SeoRecord } from "./types.js";

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(?:p|li|div|h[1-6])>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateAtWord(value: string, max: number): string {
  if (value.length <= max) return value;
  const candidate = value.slice(0, max - 1);
  const cut = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, cut > max * 0.65 ? cut : max - 1).trim()}…`;
}

export function buildSeoRecord(input: {
  title: string;
  contentHtml: string;
  primaryKeyword: string;
  brand?: string;
  indexable?: boolean;
}): SeoRecord {
  const brand = input.brand ?? "Grease Xpert";
  const plain = textFromHtml(input.contentHtml);
  const title = truncateAtWord(`${input.title} | ${brand}`, 60);
  const description = truncateAtWord(
    plain || `Learn about ${input.title} from ${brand}.`,
    158,
  );
  return {
    primaryKeyword: input.primaryKeyword,
    title,
    description,
    h1: input.title,
    robots: input.indexable === false ? "noindex,follow" : "index,follow",
  };
}

export function buildRedirects(
  sourceUrls: string[],
  entities: NormalizedContent[],
): RedirectRecord[] {
  const entityBySource = new Map(entities.map((entity) => [entity.sourceId, entity]));
  const redirects = new Map<string, RedirectRecord>();
  for (const raw of sourceUrls) {
    const url = new URL(raw);
    const productId = url.pathname.match(/\/showproducts\/productid\/(\d+)/)?.[1];
    const pageId = url.pathname.match(/\/pages\/pages_id\/(\d+)/)?.[1];
    const entity = entityBySource.get(productId ?? pageId ?? "");
    if (!entity) continue;
    if (url.pathname === new URL(entity.canonicalUrl).pathname) continue;
    redirects.set(url.pathname, {
      sourcePath: url.pathname,
      targetUrl: entity.canonicalUrl,
      status: 301,
      reason: "Canonicalize legacy Newpages URL",
    });
  }
  return [...redirects.values()].sort((a, b) =>
    a.sourcePath.localeCompare(b.sourcePath),
  );
}
