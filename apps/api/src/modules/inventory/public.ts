import type { Sql } from "postgres";
import type { StoreId, VariantId } from "@sevo/contracts/platform/v1";

export type InventorySnapshot = Readonly<{
  onHand: number;
  revision: number;
}>;

export interface InventoryAuthoring {
  replaceForProduct(
    transaction: Sql,
    command: Readonly<{
      storeId: StoreId;
      variantId: VariantId;
      onHand: number;
      expectedRevision: number;
    }>,
  ): Promise<InventorySnapshot>;
  readInTransaction(
    transaction: Sql,
    variantId: VariantId,
  ): Promise<InventorySnapshot | undefined>;
  read(variantId: VariantId): Promise<InventorySnapshot | undefined>;
}

export class InventoryRevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT" as const;
  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super("Inventory revision does not match the expected revision");
  }
}
