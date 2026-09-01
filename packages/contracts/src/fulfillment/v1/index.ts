import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import {
  errorEnvelopeV1Contract,
  eventActorV1Contract,
  eventEnvelopeV1Contract,
  identityIdContract,
  orderIdContract,
  storeIdContract,
} from "../../platform/v1/index";

export const fulfillmentStatusContract = z.enum([
  "ACTION_REQUIRED",
  "PREPARING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLATION_PENDING_REFUND",
  "CANCELLED",
]);

export const fulfillmentIdempotencyKeyContract = z.string().trim().min(8).max(128);

export const fulfillmentShippingContract = z
  .object({
    method: z.string().trim().min(2).max(80),
    trackingCode: z.string().trim().min(2).max(100).optional(),
  })
  .strict();

export const advanceFulfillmentInputContract = z.discriminatedUnion("targetStatus", [
  z.object({ targetStatus: z.literal("PREPARING") }).strict(),
  z
    .object({
      targetStatus: z.literal("SHIPPED"),
      shipping: fulfillmentShippingContract,
    })
    .strict(),
  z.object({ targetStatus: z.literal("DELIVERED") }).strict(),
]);

export const fulfillmentTimelineEntryContract = z
  .object({
    status: fulfillmentStatusContract,
    actor: eventActorV1Contract,
    occurredAt: z.iso.datetime({ offset: true }),
    correlationId: z.uuid(),
    shipping: fulfillmentShippingContract.optional(),
  })
  .strict();

export const fulfillmentTimelineContract = z
  .object({
    orderId: orderIdContract,
    status: fulfillmentStatusContract,
    nextStatus: fulfillmentStatusContract.optional(),
    timeline: z.array(fulfillmentTimelineEntryContract).min(1),
  })
  .strict();

export const fulfillmentOrderSnapshotInputContract = z
  .object({
    orderId: orderIdContract,
    buyerId: identityIdContract,
  })
  .strict();

export const fulfillmentOrderSnapshotContract = z.discriminatedUnion("status", [
  z
    .object({
      version: z.literal(1),
      orderId: orderIdContract,
      buyerId: identityIdContract,
      storeId: storeIdContract,
      status: z.literal("SHIPPED"),
      shippedAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      orderId: orderIdContract,
      buyerId: identityIdContract,
      storeId: storeIdContract,
      status: z.literal("DELIVERED"),
      shippedAt: z.iso.datetime({ offset: true }),
      deliveredAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
]);

export const fulfillmentErrorContract = errorEnvelopeV1Contract.extend({
  code: z.enum([
    "FULFILLMENT_NOT_FOUND",
    "FORBIDDEN",
    "INVALID_TRANSITION",
    "IDEMPOTENCY_CONFLICT",
    "IDEMPOTENCY_IN_PROGRESS",
    "PRECONDITION_REQUIRED",
    "VALIDATION_ERROR",
  ]),
});

export const fulfillmentAdvancedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("FulfillmentAdvanced.v1"),
  causationId: z.uuid(),
  actor: eventActorV1Contract,
  payload: z
    .object({
      fromStatus: fulfillmentStatusContract,
      toStatus: fulfillmentStatusContract,
    })
    .strict(),
});

export const fulfillmentV1Operations = {
  advanceFulfillment: {
    operationId: "advanceFulfillment",
    method: "post",
    path: "/v1/seller/orders/{orderId}/fulfillment/advance",
  },
  readSellerFulfillment: {
    operationId: "readSellerFulfillment",
    method: "get",
    path: "/v1/seller/orders/{orderId}/fulfillment",
  },
  readBuyerFulfillment: {
    operationId: "readBuyerFulfillment",
    method: "get",
    path: "/v1/orders/{orderId}/fulfillment",
  },
} as const;

export const fulfillmentV1Schemas = {
  FulfillmentIdempotencyKey: fulfillmentIdempotencyKeyContract,
  AdvanceFulfillmentInput: advanceFulfillmentInputContract,
  FulfillmentShipping: fulfillmentShippingContract,
  FulfillmentTimelineEntry: fulfillmentTimelineEntryContract,
  FulfillmentTimeline: fulfillmentTimelineContract,
  FulfillmentOrderSnapshotInput: fulfillmentOrderSnapshotInputContract,
  FulfillmentOrderSnapshot: fulfillmentOrderSnapshotContract,
  FulfillmentError: fulfillmentErrorContract,
  FulfillmentAdvancedV1: fulfillmentAdvancedV1Contract,
} as const;

export function createFulfillmentV1JsonSchemas() {
  return createJsonSchemaMap(fulfillmentV1Schemas);
}

export const fulfillmentV1Examples = {
  FulfillmentIdempotencyKey: "fulfillment-advance-01",
  AdvanceFulfillmentInput: {
    targetStatus: "SHIPPED",
    shipping: { method: "پست پیشتاز", trackingCode: "1234567890" },
  },
  FulfillmentTimeline: {
    orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    status: "SHIPPED",
    nextStatus: "DELIVERED",
    timeline: [
      {
        status: "ACTION_REQUIRED",
        actor: { type: "SYSTEM" },
        occurredAt: "2026-08-30T09:00:00.000Z",
        correlationId: "67a3f408-858c-45d7-a0bd-ab84a28718ef",
      },
      {
        status: "SHIPPED",
        actor: {
          type: "IDENTITY",
          id: "57a3f408-858c-45d7-a0bd-ab84a28718ef",
        },
        occurredAt: "2026-08-30T10:00:00.000Z",
        correlationId: "77a3f408-858c-45d7-a0bd-ab84a28718ef",
        shipping: { method: "پست پیشتاز", trackingCode: "1234567890" },
      },
    ],
  },
} as const;

export type FulfillmentStatus = z.infer<typeof fulfillmentStatusContract>;
export type FulfillmentShipping = z.infer<typeof fulfillmentShippingContract>;
export type AdvanceFulfillmentInput = z.infer<typeof advanceFulfillmentInputContract>;
export type FulfillmentTimeline = z.infer<typeof fulfillmentTimelineContract>;
export type FulfillmentTimelineEntry = z.infer<typeof fulfillmentTimelineEntryContract>;
export type FulfillmentOrderSnapshotInput = z.infer<
  typeof fulfillmentOrderSnapshotInputContract
>;
export type FulfillmentOrderSnapshot = z.infer<typeof fulfillmentOrderSnapshotContract>;
