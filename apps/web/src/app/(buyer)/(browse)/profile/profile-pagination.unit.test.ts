import { describe, expect, it } from "vitest";
import { nextProfilePage, productPageQuery } from "./profile-pagination";

describe("seller profile product pages", () => {
  it("passes the returned cursor safely to the next API page", () => {
    const cursor = "next+/= page";
    const href = nextProfilePage(cursor)!;
    const selected = new URL(href, "https://example.test").searchParams.get("cursor");
    const query = new URLSearchParams(productPageQuery(selected!));
    expect(query.get("cursor")).toBe(cursor);
    expect(query.get("limit")).toBe("30");
    expect(nextProfilePage(null)).toBeUndefined();
    expect(new URLSearchParams(productPageQuery()).has("cursor")).toBe(false);
  });
});
