import * as cheerio from "cheerio";
import { chromium, type Browser, type Page } from "playwright";
import type { DiscoveredPage, NewpagesDiscovery } from "./types.js";

const sitemapCandidates = [
  "/sitemap.xml",
  "/general/sitemap.xml",
  "/category/sitemap.xml",
  "/tag/sitemap.xml",
  "/products/sitemap.xml",
  "/producttdo/sitemap.xml",
];

function classify(url: string): DiscoveredPage {
  const parsed = new URL(url);
  const product = parsed.pathname.match(/\/showproducts\/productid\/(\d+)/);
  const category = parsed.pathname.match(/\/ourproducts\/cid\/(\d+)/);
  const tag = parsed.pathname.match(/\/tag\/tag_id\/([^/]+)/);
  const page = parsed.pathname.match(/\/pages\/pages_id\/(\d+)/);
  if (product) return { url, type: "product", sourceId: product[1] };
  if (category) return { url, type: "category", sourceId: category[1] };
  if (tag) return { url, type: "tag", sourceId: tag[1] };
  if (page || parsed.pathname === "/" || /contact|privacy|terms/.test(parsed.pathname)) {
    return { url, type: "page", sourceId: page?.[1] };
  }
  return { url, type: "other" };
}

async function fetchText(url: string): Promise<{ ok: boolean; text: string }> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "NP2WP-Migrator/0.1" },
    signal: AbortSignal.timeout(20_000),
  });
  return { ok: response.ok, text: response.ok ? await response.text() : "" };
}

export async function discoverNewpages(publicUrl: string): Promise<NewpagesDiscovery> {
  const base = new URL(publicUrl);
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  const sitemapUrls: string[] = [];
  const found = new Map<string, DiscoveredPage>();
  let browser: Browser | undefined;
  let page: Page | undefined;
  const getText = async (url: string): Promise<{ ok: boolean; text: string }> => {
    const direct = await fetchText(url);
    if (/<(?:urlset|sitemapindex)\b/i.test(direct.text)) return direct;
    browser ??= await chromium.launch({ headless: true });
    page ??= await browser.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(3_000);
    const body = await page.locator("body").innerText();
    const startCandidates = [body.indexOf("<sitemapindex"), body.indexOf("<urlset")]
      .filter((index) => index >= 0);
    const start = startCandidates.length ? Math.min(...startCandidates) : -1;
    return {
      ok: Boolean(response?.ok()) && start >= 0,
      text: start >= 0 ? body.slice(start) : body,
    };
  };

  try {
    for (const candidate of sitemapCandidates) {
      const url = new URL(candidate, base).href;
      try {
        const result = await getText(url);
        if (!result.ok || !/<(?:urlset|sitemapindex)/i.test(result.text)) continue;
        sitemapUrls.push(url);
        const $ = cheerio.load(result.text, { xmlMode: true });
        for (const element of $("loc").toArray()) {
          const loc = $(element).text().trim();
          if (!loc) continue;
          if (/sitemap\.xml/i.test(loc)) {
            try {
              const child = await getText(loc);
              const child$ = cheerio.load(child.text, { xmlMode: true });
              for (const childElement of child$("loc").toArray()) {
                const childUrl = child$(childElement).text().trim();
                if (childUrl && !/sitemap\.xml/i.test(childUrl)) {
                  found.set(childUrl, classify(childUrl));
                }
              }
            } catch {
              // The parent sitemap is still useful even if one child fails.
            }
          } else {
            found.set(loc, classify(loc));
          }
        }
      } catch {
        // Sites often omit some sitemap variants.
      }
    }
  } finally {
    await browser?.close();
  }
  found.set(base.href, classify(base.href));
  return {
    sourceUrl: base.href,
    sourceHost: base.hostname,
    sitemapUrls,
    pages: [...found.values()],
    cmsCapabilities: [],
  };
}
