import { z } from "zod";
import { createJsonSchemaMap } from "../../json-schema";

import {
  errorEnvelopeV1Contract,
  eventActorV1Contract,
  eventEnvelopeV1Contract,
  productIdContract,
  storeIdContract,
  variantIdContract,
} from "../../platform/v1/index";

export const inventoryIdempotencyKeyContract = z.string().min(1).max(200);
export const inventoryPageLimitContract = z.coerce.number().int().min(1).max(50);
export const inventoryAvailabilityContract = z.enum(["AVAILABLE", "OUT_OF_STOCK"]);
export const inventoryAdjustmentReasonContract = z.enum([
  "INITIAL_STOCK",
  "MANUAL_COUNT",
  "DAMAGED",
  "RETURNED_TO_STOCK",
  "CORRECTION",
]);

// Internal authoritative read; exact counts are never a public product response.
export const inventoryAvailabilityReadV1Contract = z
  .object({
    onHand: z.int().nonnegative(),
    reserved: z.int().nonnegative(),
    available: z.int().nonnegative(),
    revision: z.int().nonnegative(),
  })
  .strict()
  .refine(
    ({ onHand, reserved, available }) => available === onHand - reserved,
    "Available inventory must equal on-hand minus reserved",
  );

export type InventoryAvailabilityReadV1 = z.infer<
  typeof inventoryAvailabilityReadV1Contract
>;

export const sellerInventoryItemContract = inventoryAvailabilityReadV1Contract
  .extend({
    productId: productIdContract,
    variantId: variantIdContract,
    productName: z.string().min(1).max(120),
    availability: inventoryAvailabilityContract,
  })
  .strict();

export const sellerInventoryListContract = z
  .object({
    items: z.array(sellerInventoryItemContract),
    nextCursor: variantIdContract.nullable(),
  })
  .strict();

export const replaceSellerInventoryBatchContract = z
  .object({
    reasonCode: inventoryAdjustmentReasonContract.exclude(["INITIAL_STOCK"]),
    note: z.string().trim().min(1).max(500).optional(),
    rows: z
      .array(
        z
          .object({
            variantId: variantIdContract,
            onHand: z.int().nonnegative(),
            expectedRevision: z.int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .refine(
    ({ rows }) => new Set(rows.map(({ variantId }) => variantId)).size === rows.length,
    { message: "Inventory rows must be unique", path: ["rows"] },
  );

export const sellerInventoryBatchResultContract = z
  .object({
    rows: z.array(
      inventoryAvailabilityReadV1Contract.safeExtend({
        productId: productIdContract,
        variantId: variantIdContract,
        availability: inventoryAvailabilityContract,
      }),
    ),
  })
  .strict();

export const inventoryErrorContract = errorEnvelopeV1Contract.extend({
  code: z.enum([
    "INVENTORY_NOT_FOUND",
    "REVISION_CONFLICT",
    "IDEMPOTENCY_CONFLICT",
    "RESERVED_STOCK_CONFLICT",
    "SELLER_ACCESS_INACTIVE",
    "VALIDATION_ERROR",
    "PRECONDITION_REQUIRED",
  ]),
});

export const variantAvailabilityChangedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("VariantAvailabilityChanged.v1"),
  actor: eventActorV1Contract,
  payload: z
    .object({
      storeId: storeIdContract,
      productId: productIdContract,
      variantId: variantIdContract,
      publicationVersion: z.int().positive(),
      availabilityVersion: z.int().positive(),
      availability: z.enum(["AVAILABLE", "OUT_OF_STOCK"]),
    })
    .strict(),
});

export type VariantAvailabilityChangedV1 = z.infer<
  typeof variantAvailabilityChangedV1Contract
>;

export const inventoryV1Schemas = {
  InventoryIdempotencyKey: inventoryIdempotencyKeyContract,
  InventoryPageLimit: inventoryPageLimitContract,
  InventoryAvailability: inventoryAvailabilityContract,
  InventoryAdjustmentReason: inventoryAdjustmentReasonContract,
  InventoryAvailabilityReadV1: inventoryAvailabilityReadV1Contract,
  SellerInventoryItem: sellerInventoryItemContract,
  SellerInventoryList: sellerInventoryListContract,
  ReplaceSellerInventoryBatch: replaceSellerInventoryBatchContract,
  SellerInventoryBatchResult: sellerInventoryBatchResultContract,
  InventoryError: inventoryErrorContract,
  VariantAvailabilityChangedV1: variantAvailabilityChangedV1Contract,
} as const;

export const inventoryV1Examples = {
  InventoryIdempotencyKey: "inventory-adjust-01",
  InventoryPageLimit: 20,
  InventoryAvailability: "AVAILABLE",
  InventoryAdjustmentReason: "MANUAL_COUNT",
  InventoryAvailabilityReadV1: {
    onHand: 6,
    reserved: 1,
    available: 5,
    revision: 2,
  },
  SellerInventoryItem: {
    productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
    variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
    productName: "پیراهن روزمره",
    onHand: 6,
    reserved: 1,
    available: 5,
    availability: "AVAILABLE",
    revision: 2,
  },
  SellerInventoryList: {
    items: [
      {
        productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
        variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
        productName: "پیراهن روزمره",
        onHand: 6,
        reserved: 1,
        available: 5,
        availability: "AVAILABLE",
        revision: 2,
      },
    ],
    nextCursor: null,
  },
  ReplaceSellerInventoryBatch: {
    reasonCode: "MANUAL_COUNT",
    note: "شمارش پایان روز",
    rows: [
      {
        variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
        onHand: 7,
        expectedRevision: 2,
      },
    ],
  },
  SellerInventoryBatchResult: {
    rows: [
      {
        productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
        variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
        onHand: 7,
        reserved: 1,
        available: 6,
        availability: "AVAILABLE",
        revision: 3,
      },
    ],
  },
  InventoryError: {
    code: "REVISION_CONFLICT",
    message: "اطلاعات موجودی تغییر کرده است.",
    correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
  },
  VariantAvailabilityChangedV1: {
    version: 1,
    eventId: "003c34d6-0388-4758-87e4-96d694f7db64",
    eventType: "VariantAvailabilityChanged.v1",
    aggregateId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
    aggregateVersion: 3,
    occurredAt: "2026-08-29T09:00:00.000Z",
    correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
    actor: { type: "IDENTITY", id: "9370e311-bf7a-4f91-a00b-3b9b5a141f51" },
    payload: {
      storeId: "d0966916-eeb5-48dd-bb4b-f0ce16b8d4ef",
      productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
      variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
      publicationVersion: 1,
      availabilityVersion: 3,
      availability: "AVAILABLE",
    },
  },
} as const;

export function createInventoryV1JsonSchemas() {
  return createJsonSchemaMap(inventoryV1Schemas);
}

export type SellerInventoryList = z.infer<typeof sellerInventoryListContract>;
export type ReplaceSellerInventoryBatch = z.infer<
  typeof replaceSellerInventoryBatchContract
>;
export type SellerInventoryBatchResult = z.infer<
  typeof sellerInventoryBatchResultContract
>;
