import {
  buyerOrderPageContract,
  buyerOrderSnapshotContract,
} from "@sevo/contracts/orders/v1";
import { describe, expect, it, vi } from "vitest";

import { CheckoutService } from "../../apps/api/src/modules/orders/application/checkout.service";
import type {
  CartRepository,
  CheckoutRepository,
  SavedAddressRepository,
} from "../../apps/api/src/modules/orders/public";
import type { InventoryAuthoring } from "../../apps/api/src/modules/inventory/public";
import type { ProductAuthoritativeRead } from "../../apps/api/src/modules/product/public";
import type { StoreAuthoritativeRead } from "../../apps/api/src/modules/store/public";

const identityId = "0fc8f4a0-0cf8-4df0-9fde-82234ef66413";
const orderId = "47a3f408-858c-45d7-a0bd-ab84a28718ef";
const storeId = "ad75d73c-1744-422c-a6ae-31195ed6abf1";

const summary = buyerOrderPageContract.parse({
  items: [
    {
      orderId,
      store: { storeId, name: "خانه فنجان" },
      status: "PAID",
      total: { amount: 9_500_000, currency: "IRR" },
      itemCount: 1,
      createdAt: "2026-08-24T20:00:00.000Z",
      paidAt: "2026-08-24T20:03:00.000Z",
    },
  ],
});

const detail = buyerOrderSnapshotContract.parse({
  orderId,
  status: "PAID",
  store: { storeId, name: "خانه فنجان" },
  items: [
    {
      orderItemId: "50000000-0000-4000-8000-000000000001",
      productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
      variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
      name: "فنجان سرامیکی",
      quantity: 1,
      unitPrice: { amount: 9_000_000, currency: "IRR" },
      lineTotal: { amount: 9_000_000, currency: "IRR" },
    },
  ],
  shippingMethod: {
    label: "پست پیشتاز",
    fee: { amount: 500_000, currency: "IRR" },
    estimatedDeliveryText: "۳ تا ۵ روز کاری",
  },
  returnPolicy: { revision: 2, text: "تا هفت روز امکان درخواست مرجوعی دارید." },
  settlement: { mode: "DIRECT" },
  subtotal: { amount: 9_000_000, currency: "IRR" },
  total: { amount: 9_500_000, currency: "IRR" },
  reservationExpiresAt: "2026-08-24T20:15:00.000Z",
  createdAt: "2026-08-24T20:00:00.000Z",
  paidAt: "2026-08-24T20:03:00.000Z",
  timeline: [],
});

function service(repository: CheckoutRepository) {
  return new CheckoutService(
    repository,
    {} as CartRepository,
    {} as SavedAddressRepository,
    {} as ProductAuthoritativeRead,
    {} as InventoryAuthoring,
    {} as StoreAuthoritativeRead,
  );
}

describe("CheckoutService buyer order reads", () => {
  it("binds list reads to the authenticated identity", async () => {
    const listBuyerOrders = vi.fn().mockResolvedValue(summary);
    await expect(
      service({ listBuyerOrders } as unknown as CheckoutRepository).listBuyerOrders(
        identityId,
      ),
    ).resolves.toEqual(summary);
    expect(listBuyerOrders).toHaveBeenCalledWith(identityId);
  });

  it("returns undefined instead of leaking an order outside the identity", async () => {
    const readBuyerOrder = vi.fn().mockResolvedValue(undefined);
    await expect(
      service({ readBuyerOrder } as unknown as CheckoutRepository).readBuyerOrder(
        identityId,
        orderId,
      ),
    ).resolves.toBeUndefined();
    expect(readBuyerOrder).toHaveBeenCalledWith(identityId, orderId);
  });

  it("returns the authoritative snapshot for the owning identity", async () => {
    const readBuyerOrder = vi.fn().mockResolvedValue(detail);
    await expect(
      service({ readBuyerOrder } as unknown as CheckoutRepository).readBuyerOrder(
        identityId,
        orderId,
      ),
    ).resolves.toEqual(detail);
  });
});
