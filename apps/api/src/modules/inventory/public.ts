import type {
  IdentityId,
  ProductId,
  StoreId,
  VariantId,
} from "@sevo/contracts/platform/v1";
import type { InventoryAvailabilityReadV1 } from "@sevo/contracts/inventory/v1";

declare const inventoryTransactionContext: unique symbol;

export type InventoryTransactionContext = Readonly<{
  [inventoryTransactionContext]: never;
}>;

export type InventorySnapshot = Readonly<InventoryAvailabilityReadV1>;

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
      publication?: Readonly<{ productId: ProductId; publicationVersion: number }>;
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
  reserveForOrder(
    transaction: InventoryTransactionContext,
    command: Readonly<{
      reservationId: string;
      orderId: string;
      storeId: StoreId;
      expiresAt: Date;
      items: ReadonlyArray<{ variantId: VariantId; quantity: number }>;
    }>,
  ): Promise<void>;
  releaseExpiredReservation(
    transaction: InventoryTransactionContext,
    command: Readonly<{ reservationId: string; expiredAt: Date }>,
  ): Promise<boolean>;
  holdReservationForPayment(
    transaction: InventoryTransactionContext,
    command: Readonly<{
      reservationId: string;
      attemptId: string;
      leaseUntil: Date;
      now: Date;
    }>,
  ): Promise<void>;
  consumeReservation(
    transaction: InventoryTransactionContext,
    command: Readonly<{
      reservationId: string;
      attemptId: string;
    }>,
  ): Promise<boolean>;
  holdReservationForReview(
    transaction: InventoryTransactionContext,
    command: Readonly<{ reservationId: string; attemptId: string }>,
  ): Promise<void>;
  holdReservationForProviderConflict(
    transaction: InventoryTransactionContext,
    command: Readonly<{ reservationId: string; attemptId: string }>,
  ): Promise<boolean>;
  resolveFailedPayment(
    transaction: InventoryTransactionContext,
    command: Readonly<{
      reservationId: string;
      attemptId: string;
      now: Date;
    }>,
  ): Promise<"ACTIVE" | "RELEASED">;
}

export class InventoryReservationUnavailableError extends Error {
  readonly code = "OUT_OF_STOCK" as const;
  constructor(readonly variantId: VariantId) {
    super("Inventory is not available for reservation");
  }
}

export class InventoryReservationNotConsumableError extends Error {
  readonly code = "RESERVATION_NOT_CONSUMABLE" as const;
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
