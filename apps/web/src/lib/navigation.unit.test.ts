import { describe, expect, it } from "vitest";

import { safeReturnPath } from "./navigation";

describe("internal return destinations", () => {
  it("preserves the exact internal action and fragment", () => {
    expect(safeReturnPath("/s/cups?follow=1#products", "/")).toBe(
      "/s/cups?follow=1#products",
    );
  });

  it.each([
    "https://outside.example/cart",
    "//outside.example/cart",
    "/\\outside.example/cart",
    "/%2f%2foutside.example",
    "/%255coutside.example",
    "/\n/outside.example",
    "/api/auth/session",
    "/login?returnTo=/login",
  ])("uses a safe fallback for %s", (destination) => {
    expect(safeReturnPath(destination, "/cart")).toBe("/cart");
  });
});
