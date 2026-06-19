import { describe, expect, it } from "vitest";
import {
  buildSeoRecord,
  decryptSecret,
  encryptSecret,
  slugify,
} from "../src/index.js";

describe("core", () => {
  it("encrypts credentials with authenticated encryption", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptSecret("secret", key);
    expect(encrypted).not.toContain("secret");
    expect(decryptSecret(encrypted, key)).toBe("secret");
  });

  it("creates stable slugs", () => {
    expect(slugify("GX PTFE Synthetic White Grease")).toBe(
      "gx-ptfe-synthetic-white-grease",
    );
  });

  it("limits SEO metadata", () => {
    const seo = buildSeoRecord({
      title: "GX Lithium White Moly Grease for Robotic Arm Applications",
      contentHtml: `<p>${"Industrial lubrication ".repeat(30)}</p>`,
      primaryKeyword: "robotic arm grease",
    });
    expect(seo.title.length).toBeLessThanOrEqual(60);
    expect(seo.description.length).toBeLessThanOrEqual(158);
  });
});
