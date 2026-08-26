import { describe, expect, it } from "vitest";

import {
  findBoundaryViolations,
  findCanonicalModuleEntrypointViolations,
  findContractOwnershipViolations,
  findCrossModuleMigrationForeignKeyViolations,
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

  it("rejects direct access to platform-owned outbox tables from a domain module", () => {
    expect(
      findBoundaryViolations([
        {
          path: "apps/worker/src/modules/discovery/project-product.ts",
          source: "select * from platform_outbox_events",
        },
      ]),
    ).toEqual([
      expect.objectContaining({ rule: "module-does-not-access-platform-outbox-data" }),
    ]);
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
  const modules = new Set(["orders", "inventory", "product"]);

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

  it("keeps the published product truncate-guard migration identity compatible", () => {
    expect(
      findMigrationOwnershipViolations(
        [
          "packages/database/prisma/migrations/20260824174500__product__state_transition_truncate_guard/migration.sql",
        ],
        modules,
      ),
    ).toEqual([]);
  });
});

describe("migration foreign-key boundary checker", () => {
  const tableOwners = { payment_attempts: "payments", order_orders: "orders" };

  it("rejects a foreign key between tables owned by different producers", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260825090200__payments__direct-payment-success/migration.sql",
            source: `
              create table payment_attempts (
                id uuid primary key,
                order_id uuid not null references order_orders(id) on delete restrict
              );
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([
      expect.objectContaining({
        sourceTable: "payment_attempts",
        targetTable: "order_orders",
        sourceOwner: "payments",
        targetOwner: "orders",
        rule: "cross-module-migration-foreign-key",
      }),
    ]);
  });

  it("rejects a cross-producer foreign key added to an existing quoted table", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260826090000__payments__restore-order-fk/migration.sql",
            source: `
              ALTER TABLE "payment_attempts"
                ADD CONSTRAINT "payment_attempts_order_id_fkey"
                FOREIGN KEY ("order_id") REFERENCES "order_orders"("id");
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([
      expect.objectContaining({
        sourceTable: "payment_attempts",
        targetTable: "order_orders",
        rule: "cross-module-migration-foreign-key",
      }),
    ]);
  });

  it("accepts a published cross-producer foreign key after a later forward fix", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260825090200__payments__direct-payment-success/migration.sql",
            source: `
              create table payment_attempts (
                id uuid primary key,
                order_id uuid not null references order_orders(id) on delete restrict
              );
            `,
          },
          {
            path: "packages/database/prisma/migrations/20260826090000__payments__remove-order-fk/migration.sql",
            source: `
              alter table payment_attempts
                drop constraint if exists payment_attempts_order_id_fkey;
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([]);
  });

  it("rejects restoring a cross-producer foreign key after its forward fix", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260825090200__payments__direct-payment-success/migration.sql",
            source:
              "create table payment_attempts (order_id uuid references order_orders(id));",
          },
          {
            path: "packages/database/prisma/migrations/20260826090000__payments__remove-order-fk/migration.sql",
            source:
              "alter table payment_attempts drop constraint payment_attempts_order_id_fkey;",
          },
          {
            path: "packages/database/prisma/migrations/20260826091000__payments__restore-order-fk/migration.sql",
            source: `
              alter table payment_attempts
                add constraint payment_attempts_order_id_fkey
                foreign key (order_id) references order_orders(id);
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([
      expect.objectContaining({
        path: expect.stringContaining("restore-order-fk"),
        rule: "cross-module-migration-foreign-key",
      }),
    ]);
  });

  it("does not let a semicolon in a SQL comment hide a foreign key", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260826092000__payments__commented-order-fk/migration.sql",
            source: `
              alter table payment_attempts -- the published constraint was removed;
                add constraint payment_attempts_order_id_fkey
                foreign key (order_id) references order_orders(id);
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([
      expect.objectContaining({ rule: "cross-module-migration-foreign-key" }),
    ]);
  });

  it("reports an unnamed table-level foreign key instead of throwing", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260826093000__payments__unnamed-order-fk/migration.sql",
            source: `
              alter table payment_attempts
                add foreign key (order_id) references order_orders(id);
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([
      expect.objectContaining({
        constraintName: "payment_attempts_order_id_fkey",
        rule: "cross-module-migration-foreign-key",
      }),
    ]);
  });

  it("uses standard PostgreSQL backslash semantics when splitting strings", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260826094000__payments__string-before-order-fk/migration.sql",
            source: `
              select '\\';
              alter table payment_attempts
                add foreign key (order_id) references order_orders(id);
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([
      expect.objectContaining({ rule: "cross-module-migration-foreign-key" }),
    ]);
  });

  it("ignores reference-like text inside a SQL string literal", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260826095000__payments__add-note/migration.sql",
            source: `
              alter table payment_attempts
                add column note text default 'references order_orders';
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([]);
  });

  it("keeps a named inline foreign key active when a different name is dropped", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260826100000__payments__named-inline-order-fk/migration.sql",
            source: `
              create table payment_attempts (
                order_id uuid constraint custom_order_fk references order_orders(id)
              );
            `,
          },
          {
            path: "packages/database/prisma/migrations/20260826101000__payments__drop-default-order-fk/migration.sql",
            source: `
              alter table payment_attempts
                drop constraint if exists payment_attempts_order_id_fkey;
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([
      expect.objectContaining({
        constraintName: "custom_order_fk",
        rule: "cross-module-migration-foreign-key",
      }),
    ]);
  });

  it("clears a named inline foreign key when its real name is dropped", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260826100000__payments__named-inline-order-fk/migration.sql",
            source: `
              create table payment_attempts (
                order_id uuid constraint custom_order_fk references order_orders(id)
              );
            `,
          },
          {
            path: "packages/database/prisma/migrations/20260826101000__payments__drop-custom-order-fk/migration.sql",
            source: `
              alter table payment_attempts
                drop constraint if exists custom_order_fk;
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([]);
  });

  it("keeps an added-column foreign key active when a different name is dropped", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260826102000__payments__add-order-column/migration.sql",
            source: `
              alter table payment_attempts
                add column order_id uuid references order_orders(id);
            `,
          },
          {
            path: "packages/database/prisma/migrations/20260826103000__payments__drop-wrong-order-fk/migration.sql",
            source: `
              alter table payment_attempts
                drop constraint if exists payment_attempts_add_fkey;
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([
      expect.objectContaining({
        constraintName: "payment_attempts_order_id_fkey",
        rule: "cross-module-migration-foreign-key",
      }),
    ]);
  });

  it("clears an added-column foreign key when its generated name is dropped", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260826102000__payments__add-order-column/migration.sql",
            source: `
              alter table payment_attempts
                add column order_id uuid references order_orders(id);
            `,
          },
          {
            path: "packages/database/prisma/migrations/20260826103000__payments__drop-generated-order-fk/migration.sql",
            source: `
              alter table payment_attempts
                drop constraint if exists payment_attempts_order_id_fkey;
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([]);
  });

  it("clears an inline foreign key when its source column is dropped", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260826102000__payments__add-order-column/migration.sql",
            source: `
              alter table payment_attempts
                add column order_id uuid references order_orders(id);
            `,
          },
          {
            path: "packages/database/prisma/migrations/20260826103000__payments__drop-order-column/migration.sql",
            source: `
              alter table payment_attempts
                drop column if exists order_id;
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([]);
  });

  it("clears foreign keys when their source table is dropped", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260826102000__payments__add-order-table/migration.sql",
            source: `
              create table payment_attempts (
                order_id uuid references order_orders(id)
              );
            `,
          },
          {
            path: "packages/database/prisma/migrations/20260826103000__payments__drop-order-table/migration.sql",
            source: "drop table if exists payment_attempts;",
          },
        ],
        tableOwners,
      ),
    ).toEqual([]);
  });

  it("applies foreign-key additions and removals in SQL action order", () => {
    expect(
      findCrossModuleMigrationForeignKeyViolations(
        [
          {
            path: "packages/database/prisma/migrations/20260826102000__payments__temporary-order-fk/migration.sql",
            source: `
              alter table payment_attempts
                add constraint temporary_order_fkey
                  foreign key (order_id) references order_orders(id),
                drop constraint temporary_order_fkey;
            `,
          },
        ],
        tableOwners,
      ),
    ).toEqual([]);
  });
});
