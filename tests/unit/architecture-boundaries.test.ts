import { describe, expect, it } from "vitest";

import { findBoundaryViolations } from "../../scripts/check-boundaries.mjs";

describe("module boundary checker", () => {
  it("allows another module's public contract", () => {
    expect(
      findBoundaryViolations([
        {
          path: "apps/api/src/modules/orders/application/checkout.ts",
          source: 'import { reserve } from "../../inventory/public";',
        },
      ]),
    ).toEqual([]);
  });

  it("rejects importing another module's implementation", () => {
    expect(
      findBoundaryViolations([
        {
          path: "apps/api/src/modules/orders/application/checkout.ts",
          source:
            'import { InventoryStore } from "../../inventory/infrastructure/store";',
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        rule: "module-public-contract-only",
      }),
    ]);
  });

  it("keeps buyer and seller web areas independent", () => {
    expect(
      findBoundaryViolations([
        {
          path: "apps/web/src/app/(buyer)/store/page.tsx",
          source: 'import SellerHome from "../../(seller)/home/page";',
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        rule: "web-area-independence",
      }),
    ]);
  });
});
