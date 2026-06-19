import { describe, expect, it } from "vitest";
import { WordPressClient } from "../src/client.js";

describe("WordPressClient", () => {
  it("constructs with receiver credentials", () => {
    const client = new WordPressClient({
      baseUrl: "https://example.test",
      receiverToken: "a".repeat(32),
      publishMode: "draft",
    });
    expect(client).toBeInstanceOf(WordPressClient);
  });
});
