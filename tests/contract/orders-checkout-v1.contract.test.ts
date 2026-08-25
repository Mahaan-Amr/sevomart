import {
  checkoutPreparationContract,
  checkoutRevisionConflictContract,
  createOrderInputContract,
  orderContract,
  orderCreatedV1Contract,
  orderExpiredV1Contract,
  prepareCheckoutInputContract,
} from "@sevo/contracts/orders/v1";
import { describe, expect, it } from "vitest";

const ids = {
  cart: "15e66295-eecd-4a7d-b06c-1d0909ab89c7",
  checkout: "e571d3b9-53cb-47de-8e62-31257784a10c",
  order: "47a3f408-858c-45d7-a0bd-ab84a28718ef",
  reservation: "6070faec-78f8-4a5f-86da-cdd19b39c5a3",
  store: "ad75d73c-1744-422c-a6ae-31195ed6abf1",
  product: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
  variant: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
  address: "8ec7bd58-c323-41eb-aa17-b63b7ca9f8d4",
  shipping: "be77af55-ce97-46d5-8540-b5d55652daf1",
};

const preparation = {
  checkoutRevision: ids.checkout,
  expiresAt: "2026-08-24T20:10:00.000Z",
  cart: { cartId: ids.cart, revision: 4 },
  store: { storeId: ids.store, name: "خانه فنجان" },
  items: [
    {
      productId: ids.product,
      variantId: ids.variant,
      name: "فنجان سرامیکی",
      quantity: 2,
      publicationVersion: 3,
      unitPrice: { amount: 4_500_000, currency: "IRR" },
      lineTotal: { amount: 9_000_000, currency: "IRR" },
    },
  ],
  address: {
    addressId: ids.address,
    revision: 2,
    recipientName: "سارا احمدی",
    recipientMobile: "09123456789",
    provinceText: "تهران",
    cityText: "تهران",
    addressLine: "خیابان آزادی، کوچه بهار، پلاک ۱۲",
    postalCode: "1234567890",
  },
  shippingMethod: {
    id: ids.shipping,
    revision: 1,
    code: "NATIONAL_POST",
    label: "پست پیشتاز",
    fee: { amount: 500_000, currency: "IRR" },
    estimatedDeliveryText: "۳ تا ۵ روز کاری",
    requiresDeliveryAddress: true,
  },
  returnPolicy: { revision: 2, text: "تا هفت روز امکان درخواست مرجوعی دارید." },
  subtotal: { amount: 9_000_000, currency: "IRR" },
  total: { amount: 9_500_000, currency: "IRR" },
  settlement: {
    mode: "DIRECT",
    disclosure:
      "مبلغ این سفارش مستقیماً برای فروشگاه تسویه می‌شود. سیاست مرجوعی را فروشگاه تعیین می‌کند. سوو گزارش مشکل و تخلف را پیگیری می‌کند، اما بازپرداخت را تضمین نمی‌کند.",
  },
} as const;

describe("checkout and CreateOrder.v1 contracts", () => {
  it("accepts only confirmed revisions and returns an immutable review snapshot", () => {
    expect(
      prepareCheckoutInputContract.parse({
        cartId: ids.cart,
        cartRevision: 4,
        savedAddressId: ids.address,
        addressRevision: 2,
        shippingMethodId: ids.shipping,
        shippingMethodRevision: 1,
      }),
    ).toMatchObject({ cartRevision: 4, addressRevision: 2 });
    expect(checkoutPreparationContract.parse(preparation)).toEqual(preparation);
    expect(
      createOrderInputContract.parse({
        checkoutRevision: ids.checkout,
        cartRevision: 4,
        addressRevision: 2,
        shippingMethodRevision: 1,
        returnPolicyRevision: 2,
      }),
    ).toMatchObject({ checkoutRevision: ids.checkout, returnPolicyRevision: 2 });
  });

  it("returns structured actionable changes instead of silently accepting stale data", () => {
    expect(
      checkoutRevisionConflictContract.parse({
        code: "CART_CHANGED",
        message: "اطلاعات سفارش تغییر کرده است؛ سبد را دوباره بررسی کنید.",
        correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
        changes: [
          {
            kind: "PRICE_CHANGED",
            variantId: ids.variant,
            previous: { amount: 4_500_000, currency: "IRR" },
            current: { amount: 4_700_000, currency: "IRR" },
          },
          { kind: "POLICY_CHANGED" },
        ],
      }).changes,
    ).toHaveLength(2);
  });

  it("keeps an in-progress idempotent order retry actionable", () => {
    expect(
      checkoutRevisionConflictContract.parse({
        code: "IDEMPOTENCY_IN_PROGRESS",
        message: "این درخواست هنوز در حال انجام است. کمی بعد دوباره تلاش کنید.",
        correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
      }).code,
    ).toBe("IDEMPOTENCY_IN_PROGRESS");
  });

  it("models one pending order with a single expiring reservation", () => {
    expect(
      orderContract.parse({
        orderId: ids.order,
        status: "PENDING_PAYMENT",
        reservationId: ids.reservation,
        reservationExpiresAt: "2026-08-24T20:15:00.000Z",
        createdAt: "2026-08-24T20:00:00.000Z",
        review: preparation,
      }),
    ).toMatchObject({ orderId: ids.order, status: "PENDING_PAYMENT" });
  });

  it("publishes privacy-minimal versioned order lifecycle events", () => {
    const base = {
      version: 1 as const,
      eventId: "0ba5139f-7a57-45d3-9e0f-539763623493",
      aggregateId: ids.order,
      occurredAt: "2026-08-24T20:00:00.000Z",
      correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
      causationId: "7609f906-c921-490c-a793-84398fb67e0c",
    };
    expect(
      orderCreatedV1Contract.parse({
        ...base,
        eventType: "OrderCreated.v1",
        aggregateVersion: 1,
        actor: { type: "IDENTITY", id: ids.store },
        payload: {
          status: "PENDING_PAYMENT",
          total: preparation.total,
        },
      }).payload,
    ).toEqual({ status: "PENDING_PAYMENT", total: preparation.total });
    expect(
      orderExpiredV1Contract.parse({
        ...base,
        eventType: "OrderExpired.v1",
        aggregateVersion: 2,
        actor: { type: "SYSTEM" },
        payload: { status: "EXPIRED" },
      }).aggregateVersion,
    ).toBe(2);
  });
});
