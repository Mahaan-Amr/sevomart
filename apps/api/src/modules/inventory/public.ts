import type { IdentityId, StoreId, VariantId } from "@sevo/contracts/platform/v1";

declare const inventoryTransactionContext: unique symbol;

export type InventoryTransactionContext = Readonly<{
  [inventoryTransactionContext]: never;
}>;

export type InventorySnapshot = Readonly<{
  onHand: number;
  revision: number;
}>;

export interface InventoryAuthoring {
  replaceForProduct(
    transaction: InventoryTransactionContext,
    command: Readonly<{
      storeId: StoreId;
      variantId: VariantId;
      onHand: number;
      expectedRevision: number;
      reasonCode: "INITIAL_STOCK";
      actorId: IdentityId;
      correlationId: string;
    }>,
  ): Promise<InventorySnapshot>;
  readInTransaction(
    transaction: InventoryTransactionContext,
    variantId: VariantId,
  ): Promise<InventorySnapshot | undefined>;
  read(variantId: VariantId): Promise<InventorySnapshot | undefined>;
  replaceBatchForProduct(
    transaction: InventoryTransactionContext,
    command: Readonly<{
      storeId: StoreId;
      rows: ReadonlyArray<{
        variantId: VariantId;
        onHand: number;
        expectedRevision: number;
      }>;
      reasonCode:
        | "INITIAL_STOCK"
        | "MANUAL_COUNT"
        | "DAMAGED"
        | "RETURNED_TO_STOCK"
        | "CORRECTION";
      actorId: IdentityId;
      correlationId: string;
    }>,
  ): Promise<ReadonlyArray<InventorySnapshot & { variantId: VariantId }>>;
  readMany(
    variantIds: readonly VariantId[],
  ): Promise<ReadonlyArray<InventorySnapshot & { variantId: VariantId }>>;
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
