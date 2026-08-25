import {
  checkoutPreparationContract,
  directSettlementDisclosure,
  orderContract,
} from "@sevo/contracts/orders/v1";
import { describe, expect, it, vi } from "vitest";

import { CheckoutService } from "../../apps/api/src/modules/orders/application/checkout.service";
import {
  CheckoutChangedError,
  type CartRepository,
  type CheckoutRepository,
  type SavedAddressRepository,
} from "../../apps/api/src/modules/orders/public";
import type { InventoryAuthoring } from "../../apps/api/src/modules/inventory/public";
import type { ProductAuthoritativeRead } from "../../apps/api/src/modules/product/public";
import type { StoreAuthoritativeRead } from "../../apps/api/src/modules/store/public";

const ids = {
  identity: "0fc8f4a0-0cf8-4df0-9fde-82234ef66413",
  cart: "15e66295-eecd-4a7d-b06c-1d0909ab89c7",
  checkout: "e571d3b9-53cb-47de-8e62-31257784a10c",
  store: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
  product: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
  variant: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
  shipping: "be77af55-ce97-46d5-8540-b5d55652daf1",
};

const preparation = checkoutPreparationContract.parse({
  checkoutRevision: ids.checkout,
  expiresAt: "2099-08-24T20:10:00.000Z",
  cart: { cartId: ids.cart, revision: 4 },
  store: { storeId: ids.store, name: "خانه فنجان" },
  items: [
    {
      productId: ids.product,
      variantId: ids.variant,
      name: "فنجان سرامیکی",
      quantity: 1,
      publicationVersion: 3,
      unitPrice: { amount: 4_500_000, currency: "IRR" },
      lineTotal: { amount: 4_500_000, currency: "IRR" },
    },
  ],
  shippingMethod: {
    id: ids.shipping,
    revision: 1,
    code: "PICKUP",
    label: "تحویل حضوری",
    fee: { amount: 0, currency: "IRR" },
    estimatedDeliveryText: "هماهنگی با فروشگاه",
    requiresDeliveryAddress: false,
  },
  returnPolicy: { revision: 2, text: "تا هفت روز امکان درخواست مرجوعی دارید." },
  subtotal: { amount: 4_500_000, currency: "IRR" },
  total: { amount: 4_500_000, currency: "IRR" },
  settlement: { mode: "DIRECT", disclosure: directSettlementDisclosure },
});

describe("CheckoutService CreateOrder", () => {
  it("replays the same order before expiry and stock revalidation", async () => {
    const replay = orderContract.parse({
      orderId: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
      status: "PENDING_PAYMENT",
      reservationId: "6070faec-78f8-4a5f-86da-cdd19b39c5a3",
      reservationExpiresAt: "2026-08-24T20:15:00.000Z",
      createdAt: "2026-08-24T20:00:00.000Z",
      review: preparation,
    });
    const readPreparation = vi.fn();
    const repository = {
      replayOrder: vi.fn().mockResolvedValue(replay),
      readPreparation,
    } as unknown as CheckoutRepository;
    const service = new CheckoutService(
      repository,
      {} as CartRepository,
      {} as SavedAddressRepository,
      {} as ProductAuthoritativeRead,
      {} as InventoryAuthoring,
      {} as StoreAuthoritativeRead,
    );

    await expect(
      service.createOrder(
        ids.identity,
        {
          checkoutRevision: ids.checkout,
          cartRevision: 4,
          shippingMethodRevision: 1,
          returnPolicyRevision: 2,
        },
        "retry-key",
        "7609f906-c921-490c-a793-84398fb67e0c",
      ),
    ).resolves.toEqual(replay);
    expect(readPreparation).not.toHaveBeenCalled();
  });

  it("rejects a newer caller revision when the confirmed checkout is stale", async () => {
    const createOrder = vi.fn();
    const repository = {
      readPreparation: vi.fn().mockResolvedValue(preparation),
      createOrder,
    } as unknown as CheckoutRepository;
    const carts = {
      readBuyer: vi.fn().mockResolvedValue({
        cartId: ids.cart,
        storeId: ids.store,
        identityId: ids.identity,
        revision: 5,
        reviewedPolicyRevision: 2,
        reviewedShippingHash: "shipping",
        items: [
          {
            productId: ids.product,
            variantId: ids.variant,
            quantity: 1,
            reviewedPublicationVersion: 3,
            reviewedUnitPriceAmount: 4_500_000,
          },
        ],
      }),
    } as unknown as CartRepository;
    const service = new CheckoutService(
      repository,
      carts,
      {} as SavedAddressRepository,
      {} as ProductAuthoritativeRead,
      {} as InventoryAuthoring,
      {} as StoreAuthoritativeRead,
    );

    await expect(
      service.createOrder(
        ids.identity,
        {
          checkoutRevision: ids.checkout,
          cartRevision: 5,
          shippingMethodRevision: 1,
          returnPolicyRevision: 2,
        },
        "retry-key",
        "7609f906-c921-490c-a793-84398fb67e0c",
      ),
    ).rejects.toBeInstanceOf(CheckoutChangedError);
    expect(createOrder).not.toHaveBeenCalled();
  });
});
