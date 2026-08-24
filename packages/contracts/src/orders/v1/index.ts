import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import { mediaIdContract } from "../../media-v1";
import {
  moneyV1Contract,
  productIdContract,
  storeIdContract,
  variantIdContract,
} from "../../platform/v1/index";

export const cartIdContract = z.uuid().brand("CartId");
export const cartIdempotencyKeyContract = z.string().min(1).max(200);

export const cartMutationInputContract = z
  .object({
    variantId: variantIdContract,
    quantity: z.int().min(1).max(99),
    expectedRevision: z.int().nonnegative(),
  })
  .strict();

export const replaceCartStoreInputContract = cartMutationInputContract.extend({
  confirmed: z.literal(true),
});

export const cartItemContract = z
  .object({
    productId: productIdContract,
    variantId: variantIdContract,
    name: z.string().min(1).max(120),
    image: z
      .object({
        id: mediaIdContract,
        url: z.string().regex(/^\/v1\/media\/[0-9a-f-]{36}$/),
      })
      .strict(),
    quantity: z.int().min(1).max(99),
    unitPrice: moneyV1Contract,
    availability: z.enum(["AVAILABLE", "OUT_OF_STOCK", "UNAVAILABLE"]),
  })
  .strict();

export const cartContract = z
  .object({
    cartId: cartIdContract,
    store: z.object({ storeId: storeIdContract, name: z.string().min(1) }).strict(),
    revision: z.int().nonnegative(),
    requiresResolution: z.boolean(),
    items: z.array(cartItemContract).max(100),
  })
  .strict();

export const emptyCartContract = z.object({ cart: z.null() }).strict();
export const cartReadResultContract = z
  .object({ cart: cartContract.nullable() })
  .strict();

const cartSummaryContract = z
  .object({
    cartId: cartIdContract,
    storeName: z.string().min(1),
    itemCount: z.int().nonnegative(),
    revision: z.int().nonnegative(),
  })
  .strict();

export const cartConflictContract = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("SAME_STORE"),
      guest: cartSummaryContract,
      buyer: cartSummaryContract,
      combinedQuantities: z.array(
        z
          .object({
            variantId: variantIdContract,
            guestQuantity: z.int().nonnegative(),
            buyerQuantity: z.int().nonnegative(),
            mergedQuantity: z.int().min(1).max(99),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("DIFFERENT_STORE"),
      guest: cartSummaryContract,
      buyer: cartSummaryContract,
    })
    .strict(),
]);

export const attachCartInputContract = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("MERGE"),
      guestRevision: z.int().nonnegative(),
      buyerRevision: z.int().nonnegative(),
    })
    .strict(),
  z
    .object({
      decision: z.enum(["KEEP_GUEST", "KEEP_BUYER"]),
      guestRevision: z.int().nonnegative(),
      buyerRevision: z.int().nonnegative(),
    })
    .strict(),
]);

export const cartResolutionContract = z.union([
  z.object({ status: z.literal("ATTACHED"), cart: cartContract }).strict(),
  z.object({ status: z.literal("EMPTY") }).strict(),
  z
    .object({
      status: z.literal("RESOLUTION_REQUIRED"),
      conflict: cartConflictContract,
      code: z.literal("CART_RESOLUTION_REQUIRED").optional(),
      message: z.string().min(1).optional(),
      correlationId: z.string().min(1).optional(),
    })
    .strict(),
]);

export const cartErrorContract = z
  .object({
    code: z.enum([
      "CART_REVISION_CONFLICT",
      "CART_EXPIRED",
      "INVALID_QUANTITY",
      "CART_LIMIT_REACHED",
      "STORE_REPLACEMENT_CONFIRMATION_REQUIRED",
      "CART_RESOLUTION_REQUIRED",
      "VARIANT_UNAVAILABLE",
      "IDEMPOTENCY_CONFLICT",
      "PRECONDITION_REQUIRED",
    ]),
    message: z.string().min(1),
    correlationId: z.string().min(1),
    currentCart: cartContract.nullable().optional(),
    storeReplacement: z
      .object({
        currentStoreName: z.string().min(1),
        nextStoreName: z.string().min(1),
        removedItemCount: z.int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ordersV1Schemas = {
  CartId: cartIdContract,
  CartVariantId: variantIdContract,
  CartIdempotencyKey: cartIdempotencyKeyContract,
  CartMutationInput: cartMutationInputContract,
  ReplaceCartStoreInput: replaceCartStoreInputContract,
  CartItem: cartItemContract,
  Cart: cartContract,
  EmptyCart: emptyCartContract,
  CartReadResult: cartReadResultContract,
  CartConflict: cartConflictContract,
  AttachCartInput: attachCartInputContract,
  CartResolution: cartResolutionContract,
  CartError: cartErrorContract,
} as const;

export function createOrdersV1JsonSchemas() {
  return createJsonSchemaMap(ordersV1Schemas);
}

export const ordersV1Examples = {
  CartId: "15e66295-eecd-4a7d-b06c-1d0909ab89c7",
  CartVariantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
  CartIdempotencyKey: "cart-add-01",
  CartMutationInput: {
    variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
    quantity: 2,
    expectedRevision: 0,
  },
  ReplaceCartStoreInput: {
    variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
    quantity: 1,
    expectedRevision: 1,
    confirmed: true,
  },
  Cart: {
    cartId: "15e66295-eecd-4a7d-b06c-1d0909ab89c7",
    store: {
      storeId: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
      name: "خانه فنجان",
    },
    revision: 1,
    requiresResolution: false,
    items: [
      {
        productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
        variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
        name: "فنجان سرامیکی",
        image: {
          id: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
          url: "/v1/media/807c619f-a989-4fd9-8b78-a437a07c7bc4",
        },
        quantity: 2,
        unitPrice: { amount: 4_500_000, currency: "IRR" },
        availability: "AVAILABLE",
      },
    ],
  },
  EmptyCart: { cart: null },
  CartReadResult: { cart: null },
  AttachCartInput: {
    decision: "MERGE",
    guestRevision: 1,
    buyerRevision: 2,
  },
  CartResolution: {
    status: "ATTACHED",
    cart: {
      cartId: "15e66295-eecd-4a7d-b06c-1d0909ab89c7",
      store: {
        storeId: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
        name: "خانه فنجان",
      },
      revision: 1,
      requiresResolution: false,
      items: [],
    },
  },
  CartError: {
    code: "CART_REVISION_CONFLICT",
    message: "سبد در جای دیگری تغییر کرده است.",
    correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
  },
} as const;

export type CartId = z.infer<typeof cartIdContract>;
export type Cart = z.infer<typeof cartContract>;
export type CartItem = z.infer<typeof cartItemContract>;
export type CartMutationInput = z.infer<typeof cartMutationInputContract>;
export type ReplaceCartStoreInput = z.infer<typeof replaceCartStoreInputContract>;
export type CartConflict = z.infer<typeof cartConflictContract>;
export type AttachCartInput = z.infer<typeof attachCartInputContract>;
export type CartResolution = z.infer<typeof cartResolutionContract>;
