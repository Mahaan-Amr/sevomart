import { z } from "zod";
import { createJsonSchemaMap } from "../../json-schema";

import {
  eventActorV1Contract,
  eventEnvelopeV1Contract,
  productIdContract,
  storeIdContract,
  variantIdContract,
} from "../../platform/v1/index";

// Internal authoritative read; exact counts are never a public product response.
export const inventoryAvailabilityReadV1Contract = z
  .object({
    onHand: z.int().nonnegative(),
    reserved: z.int().nonnegative(),
    available: z.int(),
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
  InventoryAvailabilityReadV1: inventoryAvailabilityReadV1Contract,
  VariantAvailabilityChangedV1: variantAvailabilityChangedV1Contract,
} as const;

export function createInventoryV1JsonSchemas() {
  return createJsonSchemaMap(inventoryV1Schemas);
}
