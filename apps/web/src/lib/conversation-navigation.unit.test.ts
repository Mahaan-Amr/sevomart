import { describe, expect, it } from "vitest";

import {
  conversationContextDescription,
  conversationContextTitle,
  newConversationHref,
  newProductConversationHref,
} from "./conversation-navigation";

describe("conversation navigation", () => {
  it.each([
    [
      "STORE",
      {
        kind: "STORE" as const,
        storeId: "15f16eaf-1e01-4e40-b0e6-b8ce19268893",
      },
      "storeId=15f16eaf-1e01-4e40-b0e6-b8ce19268893",
    ],
    [
      "PRODUCT",
      {
        kind: "PRODUCT" as const,
        storeId: "15f16eaf-1e01-4e40-b0e6-b8ce19268893",
        productId: "0d113616-5ad8-45d2-a126-b5b3412b3dd7",
      },
      "productId=0d113616-5ad8-45d2-a126-b5b3412b3dd7",
    ],
    [
      "ORDER",
      {
        kind: "ORDER" as const,
        storeId: "15f16eaf-1e01-4e40-b0e6-b8ce19268893",
        orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
      },
      "orderId=47a3f408-858c-45d7-a0bd-ab84a28718ef",
    ],
  ])("builds a resumable %s conversation URL", (kind, context, identifier) => {
    const href = newConversationHref(context, "/source?cursor=kept");

    expect(href).toContain(`kind=${kind}`);
    expect(href).toContain(identifier);
    expect(new URL(href, "https://sevo.local").searchParams.get("returnTo")).toBe(
      "/source?cursor=kept",
    );
  });

  it("keeps a product source usable before its public store is resolved", () => {
    const href = newProductConversationHref(
      "khane-sofal",
      "0d113616-5ad8-45d2-a126-b5b3412b3dd7",
      "/s/khane-sofal/products/0d113616-5ad8-45d2-a126-b5b3412b3dd7",
    );

    expect(href).toContain("kind=PRODUCT");
    expect(href).toContain("storeSlug=khane-sofal");
  });

  it("describes an order without exposing its internal UUID", () => {
    const context = {
      kind: "ORDER" as const,
      storeId: "15f16eaf-1e01-4e40-b0e6-b8ce19268893",
      orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    };

    expect(conversationContextTitle(context)).toBe("گفت‌وگو درباره سفارش");
    expect(conversationContextDescription(context)).not.toContain("47a3f408");
  });
});
