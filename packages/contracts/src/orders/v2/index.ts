import { z } from "zod";

import {
  moneyV1Contract,
  orderIdContract,
  storeIdContract,
} from "../../platform/v1/index";
import { storeSlugContract } from "../../store-v1";
import {
  cartIdContract,
  cartItemContract,
  cartReviewChangeContract,
  checkoutOptionsContract,
  checkoutPreparationContract,
  savedAddressContract,
} from "../v1/index";

export const cartStoreV2Contract = z
  .object({
    storeId: storeIdContract,
    name: z.string().min(1),
    slug: storeSlugContract.optional(),
    items: z.array(cartItemContract).min(1).max(100),
    subtotal: moneyV1Contract,
  })
  .strict();

export const cartReviewChangeV2Contract = z
  .object({
    storeId: storeIdContract,
    change: cartReviewChangeContract,
  })
  .strict();

export const cartV2Contract = z
  .object({
    cartId: cartIdContract,
    revision: z.int().nonnegative(),
    reviewRequired: z.boolean(),
    reviewChanges: z.array(cartReviewChangeV2Contract),
    stores: z.array(cartStoreV2Contract).max(100),
    subtotal: moneyV1Contract,
  })
  .strict();

export const cartReadV2Contract = z
  .object({ cart: cartV2Contract.nullable() })
  .strict();

export const purchaseGroupIdContract = z.uuid().brand("PurchaseGroupId");

export const checkoutStoreOptionsV2Contract = z
  .object({
    storeId: storeIdContract,
    name: z.string().min(1),
    shippingMethods: z
      .array(checkoutOptionsContract.shape.shippingMethods.element)
      .max(5),
  })
  .strict();

export const checkoutOptionsV2Contract = z
  .object({
    cart: checkoutOptionsContract.shape.cart,
    stores: z.array(checkoutStoreOptionsV2Contract).min(1).max(100),
    addresses: z.array(savedAddressContract),
  })
  .strict();

export const prepareCheckoutInputV2Contract = z
  .object({
    cartId: cartIdContract,
    cartRevision: z.int().nonnegative(),
    savedAddressId: z.uuid().optional(),
    addressRevision: z.int().positive().optional(),
    shipping: z
      .array(
        z
          .object({
            storeId: storeIdContract,
            shippingMethodId: z.uuid(),
            shippingMethodRevision: z.int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
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
    if (
      new Set(input.shipping.map((item) => item.storeId)).size !== input.shipping.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Shipping methods must have distinct stores",
      });
    }
  });

export const checkoutPreparationV2Contract = z
  .object({
    checkoutRevision: z.uuid(),
    expiresAt: z.iso.datetime({ offset: true }),
    cart: checkoutOptionsContract.shape.cart,
    stores: z.array(checkoutPreparationContract).min(1).max(100),
    total: moneyV1Contract,
  })
  .strict();

export const createPurchaseGroupInputContract = z
  .object({
    checkoutRevision: z.uuid(),
    cartRevision: z.int().nonnegative(),
  })
  .strict();

export const devPurchaseGroupPaymentInputContract = z
  .object({
    scenario: z.enum(["success", "failure", "pending"]).default("success"),
  })
  .strict();

export const purchaseGroupContract = z
  .object({
    groupId: purchaseGroupIdContract,
    status: z.enum(["PENDING_PAYMENT", "PAYMENT_REVIEW", "PAID", "EXPIRED"]),
    total: moneyV1Contract,
    createdAt: z.iso.datetime({ offset: true }),
    reservationExpiresAt: z.iso.datetime({ offset: true }),
    paidAt: z.iso.datetime({ offset: true }).optional(),
    stores: z
      .array(
        z
          .object({
            storeId: storeIdContract,
            name: z.string().min(1),
            orderId: orderIdContract,
            status: z.string().min(1),
            total: moneyV1Contract,
            shippingLabel: z.string().min(1),
            returnPolicyText: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const devPurchaseGroupPaymentResultContract = z
  .object({
    paymentStatus: z.enum(["CONFIRMED", "FAILED", "REVIEW_REQUIRED"]),
    purchase: purchaseGroupContract,
  })
  .strict();

export const purchaseGroupListContract = z
  .object({
    items: z.array(purchaseGroupContract).max(100),
  })
  .strict();

export const ordersV2Operations = {
  readCart: { operationId: "readCartV2", method: "get", path: "/v2/cart" },
  putCartItem: {
    operationId: "putCartItemV2",
    method: "put",
    path: "/v2/cart/items/{variantId}",
  },
  removeCartItem: {
    operationId: "removeCartItemV2",
    method: "delete",
    path: "/v2/cart/items/{variantId}",
  },
  attachCart: {
    operationId: "attachCartV2",
    method: "post",
    path: "/v2/cart/attach",
  },
  reviewCart: {
    operationId: "reviewCartV2",
    method: "post",
    path: "/v2/cart/review",
  },
  readCheckoutOptions: {
    operationId: "readCheckoutOptionsV2",
    method: "get",
    path: "/v2/checkout/options",
  },
  prepareCheckout: {
    operationId: "prepareCheckoutV2",
    method: "post",
    path: "/v2/checkout/prepare",
  },
  createPurchaseGroup: {
    operationId: "createPurchaseGroupV2",
    method: "post",
    path: "/v2/purchase-groups",
  },
  listPurchaseGroups: {
    operationId: "listPurchaseGroupsV2",
    method: "get",
    path: "/v2/purchase-groups",
  },
  readPurchaseGroup: {
    operationId: "readPurchaseGroupV2",
    method: "get",
    path: "/v2/purchase-groups/{groupId}",
  },
  payPurchaseGroupDev: {
    operationId: "payPurchaseGroupDevV2",
    method: "post",
    path: "/v2/purchase-groups/{groupId}/dev-payment",
  },
} as const;

export type CartV2 = z.infer<typeof cartV2Contract>;
export type CartReadV2 = z.infer<typeof cartReadV2Contract>;
export type CheckoutOptionsV2 = z.infer<typeof checkoutOptionsV2Contract>;
export type PrepareCheckoutInputV2 = z.infer<typeof prepareCheckoutInputV2Contract>;
export type CheckoutPreparationV2 = z.infer<typeof checkoutPreparationV2Contract>;
export type PurchaseGroupV2 = z.infer<typeof purchaseGroupContract>;
