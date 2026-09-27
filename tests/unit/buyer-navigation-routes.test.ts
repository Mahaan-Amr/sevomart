import { describe, expect, it } from "vitest";

import {
  activeBuyerDestination,
  showBuyerNavigation,
} from "../../apps/web/src/app/(buyer)/buyer-navigation-routes";

describe("buyer navigation routes", () => {
  it("keeps the five destinations reachable across buyer journeys", () => {
    const cases = [
      ["/", "/"],
      ["/s/aban-poosh/products/product-id", "/"],
      ["/following", "/following"],
      ["/cart", "/cart"],
      ["/checkout/review", "/cart"],
      ["/orders", "/orders"],
      ["/purchases/group-id", "/orders"],
      ["/conversations/thread-id", "/conversations"],
    ] as const;
    for (const [pathname, destination] of cases) {
      expect(showBuyerNavigation(pathname)).toBe(true);
      expect(activeBuyerDestination(pathname)).toBe(destination);
    }
    expect(showBuyerNavigation("/login")).toBe(true);
    expect(showBuyerNavigation("/seller/application")).toBe(true);
  });

  it("leaves seller and platform workspaces to their own navigation", () => {
    expect(showBuyerNavigation("/seller")).toBe(false);
    expect(showBuyerNavigation("/seller/orders")).toBe(false);
    expect(showBuyerNavigation("/platform/seller-applications")).toBe(false);
  });
});
