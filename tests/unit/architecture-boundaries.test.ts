import { describe, expect, it } from "vitest";

import {
  findBoundaryViolations,
  findCanonicalModuleEntrypointViolations,
  findContractOwnershipViolations,
  findMigrationOwnershipViolations,
  findModuleSchemaOwnershipViolations,
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

  it("rejects application code importing an adapter directly", () => {
    expect(
      findBoundaryViolations([
        {
          path: "apps/api/src/modules/identity-access/application/request-otp.ts",
          source: 'import { DevOtpProvider } from "../testing/dev-otp-provider";',
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        rule: "module-core-does-not-import-adapter",
      }),
    ]);
  });

  it("keeps composition on module-owned public entrypoints", () => {
    expect(
      findBoundaryViolations([
        {
          path: "apps/api/src/app.module.ts",
          source:
            'import { PostgresStoreRepository } from "./modules/store/infrastructure/postgres-store.repository";',
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        rule: "composition-uses-public-module-entrypoint",
      }),
    ]);
  });

  it("allows composition to import a module composition entrypoint", () => {
    expect(
      findBoundaryViolations([
        {
          path: "apps/api/src/app.module.ts",
          source:
            'import { PostgresStoreRepository } from "./modules/store/composition";',
        },
      ]),
    ).toEqual([]);
  });

  it("rejects a worker importing another worker module's implementation", () => {
    expect(
      findBoundaryViolations([
        {
          path: "apps/worker/src/modules/discovery/project-product.ts",
          source: 'import { loadProduct } from "../product/repository";',
        },
      ]),
    ).toEqual([expect.objectContaining({ rule: "module-public-contract-only" })]);
  });

  it("allows a worker to import another worker module entrypoint", () => {
    expect(
      findBoundaryViolations([
        {
          path: "apps/worker/src/modules/discovery/project-product.ts",
          source: 'import { productEvents } from "../product/index";',
        },
      ]),
    ).toEqual([]);
  });

  it("keeps worker composition on module-owned entrypoints", () => {
    expect(
      findBoundaryViolations([
        {
          path: "apps/worker/src/main.ts",
          source: 'import { ProductProjector } from "./modules/product/projector";',
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        rule: "composition-uses-public-module-entrypoint",
      }),
    ]);
  });

  it("does not treat a bare workspace import as a relative worker module", () => {
    expect(
      findBoundaryViolations([
        {
          path: "apps/worker/src/modules/public.ts",
          source: 'import type { RuntimeEnvironment } from "@sevo/config";',
        },
      ]),
    ).toEqual([]);
  });
});

describe("canonical module entrypoint checker", () => {
  it("reports each missing API, contract, schema, OpenAPI, and worker slot", () => {
    expect(
      findCanonicalModuleEntrypointViolations(
        new Set(["product"]),
        new Set(["apps/api/src/modules/product/public.ts"]),
      ),
    ).toEqual([
      {
        path: "apps/api/src/modules/product/composition.ts",
        rule: "canonical-module-entrypoint",
      },
      {
        path: "apps/api/src/openapi/modules/product.ts",
        rule: "canonical-module-entrypoint",
      },
      {
        path: "apps/worker/src/modules/product/index.ts",
        rule: "canonical-module-entrypoint",
      },
      {
        path: "packages/contracts/src/product/v1/index.ts",
        rule: "canonical-module-entrypoint",
      },
      {
        path: "packages/database/prisma/schema/product.prisma",
        rule: "canonical-module-entrypoint",
      },
    ]);
  });
});

describe("contract ownership checker", () => {
  it("rejects a contract assigned to an unknown module", () => {
    expect(
      findContractOwnershipViolations(
        { "@sevo/contracts/store/v1": "unknown" },
        new Set(["store"]),
      ),
    ).toEqual([
      expect.objectContaining({
        rule: "registered-contract-owner-module",
      }),
    ]);
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

  it("rejects a table declared in another module's schema file", () => {
    expect(
      findModuleSchemaOwnershipViolations(
        [
          {
            path: "packages/database/prisma/schema/inventory.prisma",
            source: 'model Order {\n id String @id\n @@map("orders")\n}',
          },
        ],
        { orders: "orders" },
      ),
    ).toEqual([
      expect.objectContaining({
        path: "packages/database/prisma/schema/inventory.prisma",
        rule: "module-schema-owns-table",
      }),
    ]);
  });

  it("rejects a navigable relation across module schemas", () => {
    expect(
      findModuleSchemaOwnershipViolations(
        [
          {
            path: "packages/database/prisma/schema/orders.prisma",
            source:
              'model Order {\n id String @id\n inventory Inventory @relation(fields: [inventoryId], references: [id])\n inventoryId String\n @@map("orders")\n}',
          },
          {
            path: "packages/database/prisma/schema/inventory.prisma",
            source: 'model Inventory {\n id String @id\n @@map("inventories")\n}',
          },
        ],
        { orders: "orders", inventories: "inventory" },
      ),
    ).toEqual([
      expect.objectContaining({
        path: "packages/database/prisma/schema/orders.prisma",
        rule: "cross-module-prisma-relation",
      }),
    ]);
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
