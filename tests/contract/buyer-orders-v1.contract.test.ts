import {
  buyerOrderPageContract,
  buyerOrderSnapshotContract,
  ordersV1Operations,
} from "@sevo/contracts/orders/v1";
import { describe, expect, it } from "vitest";
import { paymentsV1Operations } from "@sevo/contracts/payments/v1";

const orderId = "47a3f408-858c-45d7-a0bd-ab84a28718ef";
const storeId = "ad75d73c-1744-422c-a6ae-31195ed6abf1";

describe("BuyerOrderRead.v1", () => {
  it("publishes canonical buyer list and detail operations", () => {
    expect(ordersV1Operations.listBuyerOrders).toEqual({
      operationId: "listBuyerOrders",
      method: "get",
      path: "/v1/orders",
    });
    expect(ordersV1Operations.readBuyerOrder).toEqual({
      operationId: "readBuyerOrder",
      method: "get",
      path: "/v1/orders/{orderId}",
    });
    expect(paymentsV1Operations.readBuyerDirectRefund).toEqual({
      operationId: "readBuyerDirectRefund",
      method: "get",
      path: "/v1/orders/{orderId}/direct-refund",
    });
  });

  it("keeps the list summary free of delivery PII", () => {
    const page = buyerOrderPageContract.parse({
      items: [
        {
          orderId,
          store: { storeId, name: "خانه فنجان" },
          status: "PAID",
          total: { amount: 9_500_000, currency: "IRR" },
          itemCount: 2,
          createdAt: "2026-08-24T20:00:00.000Z",
          paidAt: "2026-08-24T20:03:00.000Z",
        },
      ],
    });

    expect(JSON.stringify(page)).not.toMatch(/0912|address|postal|recipient/i);
  });

  it("returns the immutable checkout snapshot and audited order timeline", () => {
    expect(
      buyerOrderSnapshotContract.parse({
        orderId,
        status: "PAID",
        store: { storeId, name: "خانه فنجان" },
        items: [
          {
            productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
            variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
            name: "فنجان سرامیکی",
            quantity: 2,
            unitPrice: { amount: 4_500_000, currency: "IRR" },
            lineTotal: { amount: 9_000_000, currency: "IRR" },
          },
        ],
        delivery: {
          recipientName: "سارا احمدی",
          recipientMobile: "09123456789",
          provinceText: "تهران",
          cityText: "تهران",
          addressLine: "خیابان آزادی، کوچه بهار، پلاک ۱۲",
          postalCode: "1234567890",
        },
        shippingMethod: {
          label: "پست پیشتاز",
          fee: { amount: 500_000, currency: "IRR" },
          estimatedDeliveryText: "۳ تا ۵ روز کاری",
        },
        returnPolicy: {
          revision: 2,
          text: "تا هفت روز امکان درخواست مرجوعی دارید.",
        },
        settlement: { mode: "DIRECT" },
        subtotal: { amount: 9_000_000, currency: "IRR" },
        total: { amount: 9_500_000, currency: "IRR" },
        reservationExpiresAt: "2026-08-24T20:15:00.000Z",
        createdAt: "2026-08-24T20:00:00.000Z",
        paidAt: "2026-08-24T20:03:00.000Z",
        timeline: [
          {
            fromStatus: "PENDING_PAYMENT",
            toStatus: "PAID",
            reasonCode: "PAYMENT_CONFIRMED",
            occurredAt: "2026-08-24T20:03:00.000Z",
          },
        ],
      }),
    ).toMatchObject({ orderId, status: "PAID" });
  });
});
