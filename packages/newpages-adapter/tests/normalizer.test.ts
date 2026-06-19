import { describe, expect, it } from "vitest";
import { normalizeNewpages } from "../src/normalizer.js";

describe("Newpages normalizer", () => {
  it("normalizes a captured product response", () => {
    const bundle = normalizeNewpages(
      {
        discovery: {
          sourceUrl: "https://example.com/",
          sourceHost: "example.com",
          sitemapUrls: [],
          pages: [],
          cmsCapabilities: [],
        },
        pages: [],
        mediaUrls: [],
        warnings: [],
        apiCalls: [
          {
            url: "https://server.newpages.com.my/product/get",
            method: "POST",
            status: 200,
            requestBody: "product_id=123",
            responseBody: JSON.stringify({
              data: {
                product: {
                  title: "GX Test Grease",
                  description: "<p>High temperature grease.</p>",
                  product_categories: [{ id: "1", name: "Specialty Grease" }],
                  tags: "industrial grease",
                  pic: "test.jpg",
                },
              },
            }),
          },
        ],
      },
      "https://target.test",
    );
    expect(bundle.products).toHaveLength(1);
    expect(bundle.products[0]?.canonicalUrl).toBe(
      "https://target.test/products/test-grease/",
    );
  });
});
