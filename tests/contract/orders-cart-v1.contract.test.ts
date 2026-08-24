import {
  attachCartInputContract,
  cartConflictContract,
  cartContract,
  cartItemRemovalInputContract,
  cartMutationInputContract,
  cartReviewInputContract,
} from "@sevo/contracts/orders/v1";
import { describe, expect, it } from "vitest";

const ids = {
  cart: "15e66295-eecd-4a7d-b06c-1d0909ab89c7",
  store: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
  product: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
  variant: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
  media: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
};

describe("Cart.v1 contract", () => {
  it("accepts only a variant, bounded quantity and expected revision from clients", () => {
    expect(
      cartMutationInputContract.parse({
        variantId: ids.variant,
        quantity: 2,
        expectedRevision: 0,
      }),
    ).toEqual({ variantId: ids.variant, quantity: 2, expectedRevision: 0 });

    expect(
      cartMutationInputContract.safeParse({
        variantId: ids.variant,
        quantity: 2,
        expectedRevision: 0,
        unitPrice: { amount: 10, currency: "IRR" },
      }).success,
    ).toBe(false);
    expect(
      cartMutationInputContract.safeParse({
        variantId: ids.variant,
        quantity: 100,
        expectedRevision: 0,
      }).success,
    ).toBe(false);
  });

  it("returns authoritative display data without exposing stock counts", () => {
    const cart = cartContract.parse({
      cartId: ids.cart,
      store: { storeId: ids.store, name: "خانه فنجان" },
      revision: 1,
      requiresResolution: false,
      reviewRequired: true,
      reviewChanges: [
        {
          kind: "PRICE_CHANGED",
          variantId: ids.variant,
          previousUnitPrice: { amount: 4_300_000, currency: "IRR" },
          currentUnitPrice: { amount: 4_500_000, currency: "IRR" },
        },
      ],
      items: [
        {
          productId: ids.product,
          variantId: ids.variant,
          name: "فنجان سرامیکی",
          image: { id: ids.media, url: `/v1/media/${ids.media}` },
          quantity: 2,
          unitPrice: { amount: 4_500_000, currency: "IRR" },
          availability: "AVAILABLE",
        },
      ],
    });

    expect(cart.items[0]?.unitPrice.amount).toBe(4_500_000);
    expect(cart.items[0]).not.toHaveProperty("onHand");
    expect(cart.reviewRequired).toBe(true);
  });

  it("requires the current revision for removal and explicit review", () => {
    expect(cartItemRemovalInputContract.parse({ expectedRevision: 4 })).toEqual({
      expectedRevision: 4,
    });
    expect(
      cartReviewInputContract.parse({ expectedRevision: 4, confirmed: true }),
    ).toEqual({ expectedRevision: 4, confirmed: true });
  });

  it("models explicit same-store merge and different-store selection", () => {
    expect(
      attachCartInputContract.parse({
        decision: "MERGE",
        guestRevision: 2,
        buyerRevision: 3,
      }),
    ).toEqual({ decision: "MERGE", guestRevision: 2, buyerRevision: 3 });

    expect(
      cartConflictContract.parse({
        kind: "DIFFERENT_STORE",
        guest: {
          cartId: ids.cart,
          storeName: "خانه فنجان",
          itemCount: 1,
          revision: 1,
        },
        buyer: {
          cartId: "bf02af8a-ee54-43c7-9f64-13bb91c50bf9",
          storeName: "خانه پارچه",
          itemCount: 2,
          revision: 2,
        },
      }).kind,
    ).toBe("DIFFERENT_STORE");
  });
});
