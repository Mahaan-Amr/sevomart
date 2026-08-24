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
export const cartGuestScopeContract = z.uuid();

export const cartMutationInputContract = z
  .object({
    variantId: variantIdContract,
    quantity: z.int().min(1).max(99),
    expectedRevision: z.int().nonnegative(),
  })
  .strict();

export const cartItemRemovalInputContract = z
  .object({ expectedRevision: z.int().nonnegative() })
  .strict();

export const cartReviewInputContract = cartItemRemovalInputContract.extend({
  confirmed: z.literal(true),
});

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

export const cartReviewChangeContract = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("PRICE_CHANGED"),
      variantId: variantIdContract,
      previousUnitPrice: moneyV1Contract,
      currentUnitPrice: moneyV1Contract,
    })
    .strict(),
  z
    .object({ kind: z.literal("PRODUCT_CHANGED"), variantId: variantIdContract })
    .strict(),
  z
    .object({ kind: z.literal("VARIANT_UNAVAILABLE"), variantId: variantIdContract })
    .strict(),
  z
    .object({
      kind: z.literal("POLICY_CHANGED"),
      currentPolicyText: z.string().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("SHIPPING_METHOD_CHANGED"),
      currentMethods: z
        .array(
          z
            .object({
              label: z.string().min(1).max(60),
              fixedFee: moneyV1Contract,
              estimatedDeliveryText: z.string().min(1).max(120),
            })
            .strict(),
        )
        .max(5),
    })
    .strict(),
]);

export const cartContract = z
  .object({
    cartId: cartIdContract,
    store: z.object({ storeId: storeIdContract, name: z.string().min(1) }).strict(),
    revision: z.int().nonnegative(),
    requiresResolution: z.boolean(),
    reviewRequired: z.boolean(),
    reviewChanges: z.array(cartReviewChangeContract),
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
      mergeAllowed: z.boolean(),
      combinedQuantities: z.array(
        z
          .object({
            variantId: variantIdContract,
            name: z.string().min(1).max(120),
            guestQuantity: z.int().nonnegative(),
            buyerQuantity: z.int().nonnegative(),
            mergedQuantity: z.int().min(1).max(198),
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
      "IDEMPOTENCY_IN_PROGRESS",
      "PRECONDITION_REQUIRED",
      "GUEST_SCOPE_REQUIRED",
    ]),
    message: z.string().min(1),
    correlationId: z.string().min(1),
    currentCart: cartContract.nullable().optional(),
    resolution: z
      .object({
        action: z.literal("REVIEW_AND_RETRY"),
        expectedRevision: z.int().nonnegative(),
      })
      .strict()
      .optional(),
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

export const cartAttachConflictContract = z.union([
  cartResolutionContract,
  cartErrorContract,
]);

export const savedAddressIdContract = z.uuid().brand("SavedAddressId");

const normalizePersianDigits = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    : value;

const savedAddressFields = {
  recipientName: z.string().trim().min(2).max(80),
  recipientMobile: z.preprocess(normalizePersianDigits, z.string().regex(/^09\d{9}$/)),
  provinceText: z.string().trim().min(2).max(80),
  cityText: z.string().trim().min(2).max(80),
  addressLine: z.string().trim().min(5).max(500),
  postalCode: z.preprocess(
    normalizePersianDigits,
    z
      .string()
      .regex(/^\d{10}$/)
      .optional(),
  ),
};

export const createSavedAddressInputContract = z.object(savedAddressFields).strict();

export const updateSavedAddressInputContract = createSavedAddressInputContract.extend({
  expectedRevision: z.int().positive(),
});

export const deleteSavedAddressInputContract = z
  .object({ expectedRevision: z.int().positive() })
  .strict();

export const savedAddressContract = z
  .object({
    addressId: savedAddressIdContract,
    revision: z.int().positive(),
    ...savedAddressFields,
  })
  .strict();

export const savedAddressListContract = z
  .object({ addresses: z.array(savedAddressContract) })
  .strict();

export const savedAddressErrorContract = z
  .object({
    code: z.enum([
      "ADDRESS_INVALID",
      "ADDRESS_REVISION_CONFLICT",
      "ADDRESS_NOT_FOUND",
      "IDEMPOTENCY_CONFLICT",
      "IDEMPOTENCY_IN_PROGRESS",
      "PRECONDITION_REQUIRED",
    ]),
    message: z.string().min(1),
    correlationId: z.string().min(1),
    currentAddress: savedAddressContract.optional(),
  })
  .strict();

export const ordersV1Schemas = {
  CartId: cartIdContract,
  CartVariantId: variantIdContract,
  CartIdempotencyKey: cartIdempotencyKeyContract,
  CartGuestScope: cartGuestScopeContract,
  CartMutationInput: cartMutationInputContract,
  CartItemRemovalInput: cartItemRemovalInputContract,
  CartReviewInput: cartReviewInputContract,
  ReplaceCartStoreInput: replaceCartStoreInputContract,
  CartItem: cartItemContract,
  Cart: cartContract,
  EmptyCart: emptyCartContract,
  CartReadResult: cartReadResultContract,
  CartConflict: cartConflictContract,
  AttachCartInput: attachCartInputContract,
  CartResolution: cartResolutionContract,
  CartError: cartErrorContract,
  CartAttachConflict: cartAttachConflictContract,
  SavedAddressId: savedAddressIdContract,
  CreateSavedAddressInput: createSavedAddressInputContract,
  UpdateSavedAddressInput: updateSavedAddressInputContract,
  DeleteSavedAddressInput: deleteSavedAddressInputContract,
  SavedAddress: savedAddressContract,
  SavedAddressList: savedAddressListContract,
  SavedAddressError: savedAddressErrorContract,
} as const;

export function createOrdersV1JsonSchemas() {
  return createJsonSchemaMap(ordersV1Schemas);
}

export const ordersV1Examples = {
  CartId: "15e66295-eecd-4a7d-b06c-1d0909ab89c7",
  CartVariantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
  CartIdempotencyKey: "cart-add-01",
  CartGuestScope: "f85da696-4939-4f54-936e-44f918c75b8d",
  CartMutationInput: {
    variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
    quantity: 2,
    expectedRevision: 0,
  },
  CartItemRemovalInput: { expectedRevision: 1 },
  CartReviewInput: { expectedRevision: 1, confirmed: true },
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
    reviewRequired: false,
    reviewChanges: [],
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
      reviewRequired: false,
      reviewChanges: [],
      items: [],
    },
  },
  CartError: {
    code: "CART_REVISION_CONFLICT",
    message: "سبد در جای دیگری تغییر کرده است.",
    correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
  },
  SavedAddressId: "0fe9edc9-e3b7-47d5-a3d0-290de59d118e",
  CreateSavedAddressInput: {
    recipientName: "سارا احمدی",
    recipientMobile: "09123456789",
    provinceText: "تهران",
    cityText: "تهران",
    addressLine: "خیابان آزادی، کوچه بهار، پلاک ۱۲",
    postalCode: "1234567890",
  },
  UpdateSavedAddressInput: {
    recipientName: "سارا احمدی",
    recipientMobile: "09123456789",
    provinceText: "تهران",
    cityText: "تهران",
    addressLine: "خیابان آزادی، کوچه بهار، پلاک ۱۴",
    postalCode: "1234567890",
    expectedRevision: 1,
  },
  DeleteSavedAddressInput: { expectedRevision: 1 },
  SavedAddress: {
    addressId: "0fe9edc9-e3b7-47d5-a3d0-290de59d118e",
    revision: 1,
    recipientName: "سارا احمدی",
    recipientMobile: "09123456789",
    provinceText: "تهران",
    cityText: "تهران",
    addressLine: "خیابان آزادی، کوچه بهار، پلاک ۱۲",
    postalCode: "1234567890",
  },
  SavedAddressList: { addresses: [] },
  SavedAddressError: {
    code: "ADDRESS_INVALID",
    message: "اطلاعات نشانی را بررسی کنید.",
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
export type CartReviewChange = z.infer<typeof cartReviewChangeContract>;
export type CartItemRemovalInput = z.infer<typeof cartItemRemovalInputContract>;
export type CartReviewInput = z.infer<typeof cartReviewInputContract>;
export type SavedAddressId = z.infer<typeof savedAddressIdContract>;
export type SavedAddress = z.infer<typeof savedAddressContract>;
export type CreateSavedAddressInput = z.infer<typeof createSavedAddressInputContract>;
export type UpdateSavedAddressInput = z.infer<typeof updateSavedAddressInputContract>;
export type DeleteSavedAddressInput = z.infer<typeof deleteSavedAddressInputContract>;
