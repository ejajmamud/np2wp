import * as cheerio from "cheerio";
import { chromium, type Browser } from "playwright";
import type { SourceConfig } from "@np2wp/core";
import { discoverNewpages } from "./discovery.js";
import type {
  CapturedApiCall,
  NewpagesDiscovery,
  NewpagesExtraction,
  RawPage,
} from "./types.js";

const cmsRoutes = [
  "/dashboard",
  "/profile/homepage",
  "/profile/branches",
  "/profile/business-hour",
  "/profile/contact&social-media",
  "/website/setting",
  "/website/banner",
  "/manage/products",
  "/manage/products/category",
  "/manage/products/tag",
  "/manage/photos",
  "/manage/news",
  "/manage/downloads",
  "/manage/other",
];

async function extractPublicPage(browser: Browser, url: string): Promise<RawPage> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(350);
  const html = await page.content();
  const $ = cheerio.load(html);
  const record: RawPage = {
    url: page.url(),
    status: response?.status() ?? 0,
    title: $("title").text().trim(),
    description: $('meta[name="description"]').attr("content")?.trim() ?? "",
    canonical: $('link[rel="canonical"]').attr("href"),
    html,
    text: $("body").text().replace(/\s+/g, " ").trim(),
    links: $("a[href]")
      .map((_, element) => new URL($(element).attr("href")!, page.url()).href)
      .get(),
    imageUrls: $("img[src]")
      .map((_, element) => new URL($(element).attr("src")!, page.url()).href)
      .get(),
  };
  await context.close();
  return record;
}

async function captureCms(
  browser: Browser,
  source: SourceConfig,
  discovery: NewpagesDiscovery,
): Promise<CapturedApiCall[]> {
  if (!source.cmsLoginUrl || !source.username || !source.password) return [];
  const context = await browser.newContext();
  const page = await context.newPage();
  const calls: CapturedApiCall[] = [];
  const productIds = new Set<string>();
  const collectProductIds = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collectProductIds);
      return;
    }
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    const candidate = item.product_id ?? item.productId;
    if (
      (typeof candidate === "string" || typeof candidate === "number") &&
      /^\d+$/.test(String(candidate))
    ) {
      productIds.add(String(candidate));
    }
    Object.values(item).forEach(collectProductIds);
  };
  page.on("response", async (response) => {
    const request = response.request();
    if (!["xhr", "fetch"].includes(request.resourceType())) return;
    const call: CapturedApiCall = {
      url: response.url(),
      method: request.method(),
      status: response.status(),
      requestBody: request.postData(),
    };
    try {
      call.responseBody = (await response.text()).slice(0, 5_000_000);
      if (/\/product\/list$/.test(call.url)) {
        try {
          collectProductIds(JSON.parse(call.responseBody));
        } catch {
          // Keep the raw response even if this Newpages version is not JSON.
        }
      }
    } catch {
      // Some browser cache responses do not expose a body.
    }
    calls.push(call);
  });

  await page.goto(source.cmsLoginUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.locator("#username, input[name=username]").first().fill(source.username);
  await page.locator("#password, input[name=password]").first().fill(source.password);
  await Promise.all([
    page.waitForURL(/merchant\.newpages\.com\.my/, { timeout: 60_000 }),
    page.locator('button[type="submit"], input[type="submit"], #button').first().click(),
  ]);

  const merchant = new URL(page.url()).origin;
  for (const route of cmsRoutes) {
    await page.goto(new URL(route, merchant).href, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(3_500);
    if (route === "/manage/products") {
      const ids = await page
        .locator('a[href*="/manage/products/edit/"]')
        .evaluateAll((links) =>
          links
            .map((link) =>
              (link.getAttribute("href") ?? "").match(
                /\/manage\/products\/edit\/(\d+)/,
              )?.[1],
            )
            .filter((value): value is string => Boolean(value)),
        );
      ids.forEach((id) => productIds.add(id));
    }
  }
  if (productIds.size) {
      for (const id of productIds) {
        await page.goto(`${merchant}/manage/products/edit/${id}?page=1&cat=0`, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        await page
          .waitForFunction(
            () => !document.body.innerText.includes("Loading Product..."),
            undefined,
            { timeout: 60_000 },
          )
          .catch(() => undefined);
      }
  }
  discovery.cmsCapabilities = [...new Set(calls.map((call) => new URL(call.url).pathname))];
  await context.close();
  return calls;
}

export async function extractNewpages(
  source: SourceConfig,
  providedDiscovery?: NewpagesDiscovery,
): Promise<NewpagesExtraction> {
  const discovery = providedDiscovery ?? (await discoverNewpages(source.publicUrl));
  const browser = await chromium.launch({ headless: true });
  try {
    const pages: RawPage[] = [];
    const warnings: string[] = [];
    const queue = [...discovery.pages];
    const queued = new Set(queue.map((item) => item.url));
    const maxPages = Number(process.env.NP2WP_MAX_PUBLIC_PAGES ?? 500);
    const concurrency = Math.max(
      1,
      Math.min(12, Number(process.env.NP2WP_PUBLIC_CRAWL_CONCURRENCY ?? 4)),
    );
    let cursor = 0;
    while (cursor < queue.length && pages.length < maxPages) {
      const batch = queue.slice(
        cursor,
        Math.min(cursor + concurrency, queue.length, maxPages),
      );
      cursor += batch.length;
      const results = await Promise.all(
        batch.map(async (item) => {
          try {
            return { item, page: await extractPublicPage(browser, item.url) };
          } catch (error) {
            warnings.push(`Could not extract ${item.url}: ${String(error)}`);
            return { item, page: undefined };
          }
        }),
      );
      for (const result of results) {
        const extracted = result.page;
        if (!extracted) continue;
        pages.push(extracted);
        for (const link of extracted.links) {
          const url = new URL(link);
          if (
            url.hostname !== extractionHost(discovery.sourceUrl) ||
            queued.has(url.href) ||
            /\.(?:jpg|jpeg|png|webp|gif|svg|pdf|css|js|woff2?|zip)$/i.test(
              url.pathname,
            )
          ) {
            continue;
          }
          url.hash = "";
          const discovered = {
            url: url.href,
            type: /\/showproducts\/productid\//.test(url.pathname)
              ? ("product" as const)
              : /\/ourproducts\/cid\//.test(url.pathname)
                ? ("category" as const)
                : /\/tag\/tag_id\//.test(url.pathname)
                  ? ("tag" as const)
                  : ("other" as const),
            sourceId:
              url.pathname.match(
                /\/(?:showproducts\/productid|ourproducts\/cid|pages\/pages_id)\/(\d+)/,
              )?.[1],
          };
          queued.add(url.href);
          queue.push(discovered);
          discovery.pages.push(discovered);
        }
      }
    }
    const apiCalls =
      source.mode === "authenticated"
        ? await captureCms(browser, source, discovery)
        : [];
    return {
      discovery,
      pages,
      apiCalls,
      mediaUrls: [...new Set(pages.flatMap((page) => page.imageUrls))],
      warnings,
    };
  } finally {
    await browser.close();
  }
}

function extractionHost(url: string): string {
  return new URL(url).hostname;
}
