import { describe, expect, it } from "vitest";

import {
  findBoundaryViolations,
  findMigrationOwnershipViolations,
  findTableOwnershipViolations,
} from "../../scripts/check-boundaries.mjs";

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

  it("rejects dynamic imports of another module's implementation", () => {
    expect(
      findBoundaryViolations([
        {
          path: "apps/api/src/modules/orders/application/checkout.ts",
          source: 'const store = await import("../../inventory/infrastructure/store");',
        },
      ]),
    ).toEqual([expect.objectContaining({ rule: "module-public-contract-only" })]);
  });
});

describe("table ownership checker", () => {
  const modules = new Set(["orders", "inventory"]);

  it("accepts a Prisma table owned by a registered module", () => {
    expect(
      findTableOwnershipViolations(
        'model Order {\n id String @id\n @@map("orders")\n}',
        { orders: "orders" },
        modules,
      ),
    ).toEqual([]);
  });

  it("rejects an unowned Prisma table", () => {
    expect(
      findTableOwnershipViolations(
        'model Order {\n id String @id\n @@map("orders")\n}',
        {},
        modules,
      ),
    ).toEqual([expect.objectContaining({ rule: "registered-table-owner" })]);
  });
});

describe("migration ownership checker", () => {
  const modules = new Set(["orders", "inventory"]);

  it("accepts a timestamped migration owned by a registered module", () => {
    expect(
      findMigrationOwnershipViolations(
        [
          "packages/database/prisma/migrations/20260815120000__orders__create-orders/migration.sql",
        ],
        modules,
      ),
    ).toEqual([]);
  });

  it("rejects migrations without a registered owner", () => {
    expect(
      findMigrationOwnershipViolations(
        [
          "packages/database/prisma/migrations/20260815120000__unknown__create-table/migration.sql",
        ],
        modules,
      ),
    ).toEqual([expect.objectContaining({ rule: "registered-migration-owner" })]);
  });

  it("rejects migration directories that omit the ownership convention", () => {
    expect(
      findMigrationOwnershipViolations(
        [
          "packages/database/prisma/migrations/20260815120000_create_orders/migration.sql",
        ],
        modules,
      ),
    ).toEqual([expect.objectContaining({ rule: "migration-directory-convention" })]);
  });
});
