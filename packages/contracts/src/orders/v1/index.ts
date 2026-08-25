import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import { mediaIdContract } from "../../media-v1";
import {
  eventActorV1Contract,
  eventEnvelopeV1Contract,
  moneyV1Contract,
  orderIdContract,
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

export const checkoutRevisionContract = z.uuid().brand("CheckoutRevision");
export const reservationIdContract = z.uuid().brand("InventoryReservationId");

export const prepareCheckoutInputContract = z
  .object({
    cartId: cartIdContract,
    cartRevision: z.int().nonnegative(),
    savedAddressId: z.uuid().optional(),
    addressRevision: z.int().positive().optional(),
    shippingMethodId: z.uuid(),
    shippingMethodRevision: z.int().positive(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.savedAddressId === undefined) !==
      (input.addressRevision === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Address id and revision must be supplied together",
      });
    }
  });

const checkoutItemContract = z
  .object({
    productId: productIdContract,
    variantId: variantIdContract,
    name: z.string().min(1).max(120),
    quantity: z.int().min(1).max(99),
    publicationVersion: z.int().positive(),
    unitPrice: moneyV1Contract,
    lineTotal: moneyV1Contract,
  })
  .strict();

const checkoutShippingMethodContract = z
  .object({
    id: z.uuid(),
    revision: z.int().positive(),
    code: z.enum(["NATIONAL_POST", "COURIER", "PICKUP"]),
    label: z.string().min(1).max(60),
    fee: moneyV1Contract,
    estimatedDeliveryText: z.string().min(1).max(120),
    requiresDeliveryAddress: z.boolean(),
  })
  .strict();

const checkoutAddressSnapshotContract = z
  .object({
    addressId: z.uuid(),
    revision: z.int().positive(),
    recipientName: z.string().min(2).max(80),
    recipientMobile: z.string().regex(/^09\d{9}$/),
    provinceText: z.string().min(2).max(80),
    cityText: z.string().min(2).max(80),
    addressLine: z.string().min(5).max(500),
    postalCode: z
      .string()
      .regex(/^\d{10}$/)
      .optional(),
  })
  .strict();

export const directSettlementDisclosure =
  "مبلغ این سفارش مستقیماً برای فروشگاه تسویه می‌شود. سیاست مرجوعی را فروشگاه تعیین می‌کند. سوو گزارش مشکل و تخلف را پیگیری می‌کند، اما بازپرداخت را تضمین نمی‌کند.";

export const checkoutPreparationContract = z
  .object({
    checkoutRevision: checkoutRevisionContract,
    expiresAt: z.iso.datetime({ offset: true }),
    cart: z
      .object({ cartId: cartIdContract, revision: z.int().nonnegative() })
      .strict(),
    store: z.object({ storeId: storeIdContract, name: z.string().min(1) }).strict(),
    items: z.array(checkoutItemContract).min(1).max(100),
    address: checkoutAddressSnapshotContract.optional(),
    shippingMethod: checkoutShippingMethodContract,
    returnPolicy: z
      .object({ revision: z.int().positive(), text: z.string().min(10).max(1_000) })
      .strict(),
    subtotal: moneyV1Contract,
    total: moneyV1Contract,
    settlement: z
      .object({
        mode: z.literal("DIRECT"),
        disclosure: z.literal(directSettlementDisclosure),
      })
      .strict(),
  })
  .strict();

export const createOrderInputContract = z
  .object({
    checkoutRevision: checkoutRevisionContract,
    cartRevision: z.int().nonnegative(),
    addressRevision: z.int().positive().optional(),
    shippingMethodRevision: z.int().positive(),
    returnPolicyRevision: z.int().positive(),
  })
  .strict();

export const checkoutChangeContract = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("PRICE_CHANGED"),
      variantId: variantIdContract,
      previous: moneyV1Contract,
      current: moneyV1Contract,
    })
    .strict(),
  z
    .object({ kind: z.literal("QUANTITY_CHANGED"), variantId: variantIdContract })
    .strict(),
  z
    .object({ kind: z.literal("VARIANT_UNAVAILABLE"), variantId: variantIdContract })
    .strict(),
  z.object({ kind: z.literal("SHIPPING_METHOD_CHANGED") }).strict(),
  z.object({ kind: z.literal("SHIPPING_FEE_CHANGED") }).strict(),
  z.object({ kind: z.literal("POLICY_CHANGED") }).strict(),
  z.object({ kind: z.literal("ADDRESS_CHANGED") }).strict(),
]);

export const checkoutRevisionConflictContract = z
  .object({
    code: z.enum([
      "CART_CHANGED",
      "CHECKOUT_REVISION_EXPIRED",
      "OUT_OF_STOCK",
      "ADDRESS_INVALID",
      "SHIPPING_METHOD_UNAVAILABLE",
      "IDEMPOTENCY_CONFLICT",
      "IDEMPOTENCY_IN_PROGRESS",
      "CHECKOUT_NOT_READY",
      "PRECONDITION_REQUIRED",
      "VALIDATION_ERROR",
    ]),
    message: z.string().min(1),
    correlationId: z.string().min(1),
    changes: z.array(checkoutChangeContract).optional(),
  })
  .strict();

export const orderContract = z
  .object({
    orderId: orderIdContract,
    status: z.literal("PENDING_PAYMENT"),
    reservationId: reservationIdContract,
    reservationExpiresAt: z.iso.datetime({ offset: true }),
    createdAt: z.iso.datetime({ offset: true }),
    review: checkoutPreparationContract,
  })
  .strict();

export const orderCreatedV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("OrderCreated.v1"),
  causationId: z.uuid(),
  actor: eventActorV1Contract,
  payload: z
    .object({
      status: z.literal("PENDING_PAYMENT"),
      total: moneyV1Contract,
    })
    .strict(),
});

export const orderExpiredV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("OrderExpired.v1"),
  causationId: z.uuid(),
  actor: z.object({ type: z.literal("SYSTEM") }).strict(),
  payload: z.object({ status: z.literal("EXPIRED") }).strict(),
});

export const sellerActionableOrderContract = z
  .object({
    orderId: orderIdContract,
    status: z.literal("PAID"),
    total: moneyV1Contract,
    paidAt: z.iso.datetime({ offset: true }),
    createdAt: z.iso.datetime({ offset: true }),
    itemCount: z.int().positive(),
  })
  .strict();

export const sellerActionableOrderListContract = z
  .object({ orders: z.array(sellerActionableOrderContract) })
  .strict();

export const orderBecameActionableV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("OrderBecameActionable.v1"),
  causationId: z.uuid(),
  actor: z.object({ type: z.literal("SYSTEM") }).strict(),
  payload: z.object({ status: z.literal("PAID") }).strict(),
});

export const orderPaymentReviewRequiredV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("OrderPaymentReviewRequired.v1"),
  causationId: z.uuid(),
  actor: z.object({ type: z.literal("SYSTEM") }).strict(),
  payload: z.object({ status: z.literal("PAYMENT_REVIEW") }).strict(),
});

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

export const checkoutOptionsContract = z
  .object({
    cart: z
      .object({ cartId: cartIdContract, revision: z.int().nonnegative() })
      .strict(),
    shippingMethods: z.array(checkoutShippingMethodContract).min(1).max(5),
    addresses: z.array(savedAddressContract),
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
  CheckoutRevision: checkoutRevisionContract,
  InventoryReservationId: reservationIdContract,
  PrepareCheckoutInput: prepareCheckoutInputContract,
  CheckoutPreparation: checkoutPreparationContract,
  CheckoutOptions: checkoutOptionsContract,
  CreateOrderInput: createOrderInputContract,
  CheckoutChange: checkoutChangeContract,
  CheckoutRevisionConflict: checkoutRevisionConflictContract,
  Order: orderContract,
  SellerActionableOrder: sellerActionableOrderContract,
  SellerActionableOrderList: sellerActionableOrderListContract,
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
  SellerActionableOrderList: {
    orders: [
      {
        orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
        status: "PAID",
        total: { amount: 4_500_000, currency: "IRR" },
        paidAt: "2026-08-25T08:02:00.000Z",
        createdAt: "2026-08-25T08:00:00.000Z",
        itemCount: 1,
      },
    ],
  },
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
  CheckoutRevision: "e571d3b9-53cb-47de-8e62-31257784a10c",
  InventoryReservationId: "6070faec-78f8-4a5f-86da-cdd19b39c5a3",
  PrepareCheckoutInput: {
    cartId: "15e66295-eecd-4a7d-b06c-1d0909ab89c7",
    cartRevision: 4,
    savedAddressId: "8ec7bd58-c323-41eb-aa17-b63b7ca9f8d4",
    addressRevision: 2,
    shippingMethodId: "be77af55-ce97-46d5-8540-b5d55652daf1",
    shippingMethodRevision: 1,
  },
  CheckoutPreparation: {
    checkoutRevision: "e571d3b9-53cb-47de-8e62-31257784a10c",
    expiresAt: "2026-08-24T20:10:00.000Z",
    cart: { cartId: "15e66295-eecd-4a7d-b06c-1d0909ab89c7", revision: 4 },
    store: {
      storeId: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
      name: "خانه فنجان",
    },
    items: [
      {
        productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
        variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
        name: "فنجان سرامیکی",
        quantity: 2,
        publicationVersion: 3,
        unitPrice: { amount: 4_500_000, currency: "IRR" },
        lineTotal: { amount: 9_000_000, currency: "IRR" },
      },
    ],
    address: {
      addressId: "8ec7bd58-c323-41eb-aa17-b63b7ca9f8d4",
      revision: 2,
      recipientName: "سارا احمدی",
      recipientMobile: "09123456789",
      provinceText: "تهران",
      cityText: "تهران",
      addressLine: "خیابان آزادی، کوچه بهار، پلاک ۱۲",
      postalCode: "1234567890",
    },
    shippingMethod: {
      id: "be77af55-ce97-46d5-8540-b5d55652daf1",
      revision: 1,
      code: "NATIONAL_POST",
      label: "پست پیشتاز",
      fee: { amount: 500_000, currency: "IRR" },
      estimatedDeliveryText: "۳ تا ۵ روز کاری",
      requiresDeliveryAddress: true,
    },
    returnPolicy: {
      revision: 2,
      text: "تا هفت روز امکان درخواست مرجوعی دارید.",
    },
    subtotal: { amount: 9_000_000, currency: "IRR" },
    total: { amount: 9_500_000, currency: "IRR" },
    settlement: { mode: "DIRECT", disclosure: directSettlementDisclosure },
  },
  CheckoutOptions: {
    cart: { cartId: "15e66295-eecd-4a7d-b06c-1d0909ab89c7", revision: 4 },
    shippingMethods: [
      {
        id: "be77af55-ce97-46d5-8540-b5d55652daf1",
        revision: 1,
        code: "NATIONAL_POST",
        label: "پست پیشتاز",
        fee: { amount: 500_000, currency: "IRR" },
        estimatedDeliveryText: "۳ تا ۵ روز کاری",
        requiresDeliveryAddress: true,
      },
    ],
    addresses: [
      {
        addressId: "8ec7bd58-c323-41eb-aa17-b63b7ca9f8d4",
        revision: 2,
        recipientName: "سارا احمدی",
        recipientMobile: "09123456789",
        provinceText: "تهران",
        cityText: "تهران",
        addressLine: "خیابان آزادی، کوچه بهار، پلاک ۱۲",
        postalCode: "1234567890",
      },
    ],
  },
  CreateOrderInput: {
    checkoutRevision: "e571d3b9-53cb-47de-8e62-31257784a10c",
    cartRevision: 4,
    addressRevision: 2,
    shippingMethodRevision: 1,
    returnPolicyRevision: 2,
  },
  CheckoutRevisionConflict: {
    code: "CART_CHANGED",
    message: "اطلاعات سفارش تغییر کرده است؛ سبد را دوباره بررسی کنید.",
    correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
    changes: [{ kind: "POLICY_CHANGED" }],
  },
  Order: {
    orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
    status: "PENDING_PAYMENT",
    reservationId: "6070faec-78f8-4a5f-86da-cdd19b39c5a3",
    reservationExpiresAt: "2026-08-24T20:15:00.000Z",
    createdAt: "2026-08-24T20:00:00.000Z",
    review: {
      checkoutRevision: "e571d3b9-53cb-47de-8e62-31257784a10c",
      expiresAt: "2026-08-24T20:10:00.000Z",
      cart: { cartId: "15e66295-eecd-4a7d-b06c-1d0909ab89c7", revision: 4 },
      store: {
        storeId: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
        name: "خانه فنجان",
      },
      items: [
        {
          productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
          variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
          name: "فنجان سرامیکی",
          quantity: 2,
          publicationVersion: 3,
          unitPrice: { amount: 4_500_000, currency: "IRR" },
          lineTotal: { amount: 9_000_000, currency: "IRR" },
        },
      ],
      address: {
        addressId: "8ec7bd58-c323-41eb-aa17-b63b7ca9f8d4",
        revision: 2,
        recipientName: "سارا احمدی",
        recipientMobile: "09123456789",
        provinceText: "تهران",
        cityText: "تهران",
        addressLine: "خیابان آزادی، کوچه بهار، پلاک ۱۲",
        postalCode: "1234567890",
      },
      shippingMethod: {
        id: "be77af55-ce97-46d5-8540-b5d55652daf1",
        revision: 1,
        code: "NATIONAL_POST",
        label: "پست پیشتاز",
        fee: { amount: 500_000, currency: "IRR" },
        estimatedDeliveryText: "۳ تا ۵ روز کاری",
        requiresDeliveryAddress: true,
      },
      returnPolicy: {
        revision: 2,
        text: "تا هفت روز امکان درخواست مرجوعی دارید.",
      },
      subtotal: { amount: 9_000_000, currency: "IRR" },
      total: { amount: 9_500_000, currency: "IRR" },
      settlement: { mode: "DIRECT", disclosure: directSettlementDisclosure },
    },
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
export type PrepareCheckoutInput = z.infer<typeof prepareCheckoutInputContract>;
export type CheckoutPreparation = z.infer<typeof checkoutPreparationContract>;
export type CheckoutOptions = z.infer<typeof checkoutOptionsContract>;
export type CreateOrderInput = z.infer<typeof createOrderInputContract>;
export type CheckoutChange = z.infer<typeof checkoutChangeContract>;
export type Order = z.infer<typeof orderContract>;
export type SellerActionableOrder = z.infer<typeof sellerActionableOrderContract>;
export type CartReviewChange = z.infer<typeof cartReviewChangeContract>;
export type CartItemRemovalInput = z.infer<typeof cartItemRemovalInputContract>;
export type CartReviewInput = z.infer<typeof cartReviewInputContract>;
export type SavedAddressId = z.infer<typeof savedAddressIdContract>;
export type SavedAddress = z.infer<typeof savedAddressContract>;
export type CreateSavedAddressInput = z.infer<typeof createSavedAddressInputContract>;
export type UpdateSavedAddressInput = z.infer<typeof updateSavedAddressInputContract>;
export type DeleteSavedAddressInput = z.infer<typeof deleteSavedAddressInputContract>;
