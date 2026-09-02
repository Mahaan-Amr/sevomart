import type {
  IdentityId,
  ProductId,
  StoreId,
  VariantId,
} from "@sevo/contracts/platform/v1";
import type { InventoryAvailabilityReadV1 } from "@sevo/contracts/inventory/v1";
import type {
  ReplaceSellerInventoryBatch,
  SellerInventoryBatchResult,
} from "@sevo/contracts/inventory/v1";

declare const inventoryTransactionContext: unique symbol;

export type InventoryTransactionContext = Readonly<{
  [inventoryTransactionContext]: never;
}>;

export function createInventoryTransactionContext(
  transaction: unknown,
): InventoryTransactionContext {
  return transaction as InventoryTransactionContext;
}

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
      publications?: ReadonlyMap<
        VariantId,
        Readonly<{ productId: ProductId; publicationVersion: number }>
      >;
      aggregateBatchConflicts?: boolean;
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
      causationId?: string;
      note?: string;
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
  countExpiredPaymentHolds(now: Date): Promise<number>;
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
  restoreConsumedReservationForCancellation(
    transaction: InventoryTransactionContext,
    command: Readonly<{
      reservationId: string;
      orderId: string;
      actorId: IdentityId;
      correlationId: string;
      occurredAt: Date;
    }>,
  ): Promise<boolean>;
}

export type SellerInventoryRow = InventorySnapshot & Readonly<{ variantId: VariantId }>;

export interface SellerInventoryRepository {
  listForStore(
    command: Readonly<{
      storeId: StoreId;
      cursor?: VariantId;
      limit: number;
      availability?: "AVAILABLE" | "OUT_OF_STOCK";
    }>,
  ): Promise<ReadonlyArray<SellerInventoryRow>>;
  replaceSellerBatch(
    command: Readonly<{
      storeId: StoreId;
      actorId: IdentityId;
      correlationId: string;
      causationId: string;
      idempotencyKey: string;
      requestHash: string;
      input: ReplaceSellerInventoryBatch;
      readPublication: (
        transaction: InventoryTransactionContext,
        variantId: VariantId,
      ) => Promise<
        | Readonly<{
            storeId: StoreId;
            productId: ProductId;
            publicationVersion: number;
            sellable: boolean;
          }>
        | undefined
      >;
    }>,
  ): Promise<SellerInventoryBatchResult>;
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

export class InventoryReservedStockConflictError extends Error {
  readonly code = "RESERVED_STOCK_CONFLICT" as const;
  constructor(
    readonly requestedOnHand: number,
    readonly reserved: number,
  ) {
    super("Inventory cannot be reduced below active reserved stock");
  }
}

export type InventoryBatchConflictIssue = Readonly<
  | {
      code: "REVISION_CONFLICT";
      rowIndex: number;
      variantId: VariantId;
      expectedRevision: number;
      currentRevision: number;
    }
  | {
      code: "RESERVED_STOCK_CONFLICT";
      rowIndex: number;
      variantId: VariantId;
      requestedOnHand: number;
      reserved: number;
    }
>;

export class InventoryBatchConflictError extends Error {
  constructor(readonly issues: readonly InventoryBatchConflictIssue[]) {
    super("Inventory batch contains conflicting rows");
  }
}

export type InventoryBatchNotFoundIssue = Readonly<{
  code: "INVENTORY_NOT_FOUND";
  rowIndex: number;
  variantId: VariantId;
}>;

export class InventoryBatchNotFoundError extends Error {
  constructor(readonly issues: readonly InventoryBatchNotFoundIssue[]) {
    super("Inventory batch contains variants outside the seller store");
  }
}

export class InventoryNotFoundError extends Error {}
export class InventoryIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;
}
export class InventorySellerAccessInactiveError extends Error {}
