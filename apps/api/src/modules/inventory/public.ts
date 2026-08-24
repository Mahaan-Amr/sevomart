import type { Sql } from "postgres";

export type InventorySnapshot = Readonly<{
  onHand: number;
  revision: number;
}>;

export interface InventoryAuthoring {
  replaceForProduct(
    transaction: Sql,
    command: Readonly<{
      storeId: string;
      variantId: string;
      onHand: number;
      expectedRevision: number;
    }>,
  ): Promise<InventorySnapshot>;
  readInTransaction(
    transaction: Sql,
    variantId: string,
  ): Promise<InventorySnapshot | undefined>;
  read(variantId: string): Promise<InventorySnapshot | undefined>;
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
