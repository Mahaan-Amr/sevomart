import { afterEach, describe, expect, it } from "vitest";
import { ordersV1Operations } from "@sevo/contracts/orders/v1";
import { paymentsV1Operations } from "@sevo/contracts/payments/v1";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("OpenAPI guest cart and login attachment", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => close?.());

  it("publishes anonymous cart reads and writes plus authenticated attachment", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/openapi.json",
    });
    const document = response.json();
    const expected = [
      ["get", "/v1/cart", "readCart", false],
      ["put", "/v1/cart/items/{variantId}", "upsertCartItem", false],
      ["delete", "/v1/cart/items/{variantId}", "removeCartItem", false],
      ["post", "/v1/cart/review", "confirmCartReview", false],
      ["post", "/v1/cart/store-replacement", "replaceCartStore", false],
      ["post", "/v1/cart/attach", "attachGuestCart", true],
      ["post", "/v1/cart/resolve", "resolveCartConflict", true],
      ["get", "/v1/checkout/options", "readCheckoutOptions", true],
      ["post", "/v1/checkout/prepare", "prepareCheckout", true],
      ["post", "/v1/orders", "createOrder", true],
      ["get", "/v1/seller/buyers", "listStoreBuyers", true],
      [
        "post",
        "/v1/seller/orders/{orderId}/delivery-details/reveal",
        "revealSellerOrderDeliveryDetails",
        true,
      ],
      ["get", "/v1/addresses", "listSavedAddresses", true],
      ["post", "/v1/addresses", "createSavedAddress", true],
      ["put", "/v1/addresses/{addressId}", "updateSavedAddress", true],
      ["delete", "/v1/addresses/{addressId}", "deleteSavedAddress", true],
    ] as const;

    for (const [method, path, operationId, authenticated] of expected) {
      const operation = document.paths[path]?.[method];
      expect(operation?.operationId).toBe(operationId);
      expect(operation?.security).toEqual(
        authenticated ? [{ identitySession: [] }] : [],
      );
    }
    const writes = expected.filter(
      ([method, path]) =>
        method !== "get" &&
        path !== "/v1/checkout/prepare" &&
        !path.endsWith("/delivery-details/reveal"),
    );
    for (const [method, path] of writes.map(([method, path]) => [method, path])) {
      expect(document.paths[path][method].parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Idempotency-Key", required: true }),
        ]),
      );
    }
    expect(
      document.paths["/v1/addresses"].post.responses["409"].headers,
    ).toHaveProperty("Retry-After");
    expect(document.paths["/v1/orders"].post.responses["409"].headers).toHaveProperty(
      "Retry-After",
    );
    for (const [method, path] of writes
      .filter(([, path]) => path.startsWith("/v1/cart"))
      .map(([method, path]) => [method, path])) {
      expect(document.paths[path][method].responses["409"].headers).toHaveProperty(
        "Retry-After",
      );
    }
    expect(document.paths["/v1/cart/attach"].post.responses["409"].content).toEqual(
      expect.objectContaining({
        "application/json": expect.objectContaining({
          schema: expect.objectContaining({
            $ref: expect.stringContaining("CartAttachConflict"),
          }),
        }),
      }),
    );
    expect(document.paths["/v1/cart/items/{variantId}"].put.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "X-Sevo-Guest-Scope",
          required: false,
        }),
      ]),
    );
    expect(document.components.schemas.CartError.properties.code.enum).toContain(
      "GUEST_SCOPE_REQUIRED",
    );
  });

  it("derives every order and payment path from its versioned contract", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/openapi.json",
    });
    const document = response.json();

    for (const operation of [
      ...Object.values(ordersV1Operations),
      ...Object.values(paymentsV1Operations),
    ]) {
      expect(
        document.paths[operation.path]?.[operation.method]?.operationId,
        `${operation.method.toUpperCase()} ${operation.path}`,
      ).toBe(operation.operationId);
    }
    expect(document.components.schemas).toEqual(
      expect.objectContaining({
        OrderStatus: expect.any(Object),
        OrderStateTransitionAudit: expect.any(Object),
        OrderBecameActionableV1: expect.any(Object),
        DirectPaymentAttemptStatus: expect.any(Object),
        PaymentAttemptAudit: expect.any(Object),
        DirectPaymentAttemptConfirmedV1: expect.any(Object),
      }),
    );
  });
});
