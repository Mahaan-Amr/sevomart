import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("OpenAPI simple product tracer", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => close?.());

  it("publishes authenticated revision writes and anonymous public reads", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/openapi.json",
    });
    const document = response.json();

    for (const name of [
      "ProductAuthoritativeVariantV1",
      "InventoryAvailabilityReadV1",
      "ProductPublishedV1",
      "ProductPublishedV2",
      "ProductUnpublishedV1",
      "VariantPriceChangedV1",
      "VariantAvailabilityChangedV1",
      "SellerInventoryList",
      "ReplaceSellerInventoryBatch",
      "SellerInventoryBatchResult",
    ]) {
      expect(document.components.schemas, name).toHaveProperty(name);
    }

    const expected = [
      ["get", "/v1/seller/inventory", "listSellerInventory", true],
      ["put", "/v1/seller/inventory", "replaceInventoryBatch", true],
      ["post", "/v1/seller/products", "createSellerProduct", true],
      ["get", "/v1/seller/products", "listSellerProducts", true],
      [
        "post",
        "/v1/seller/products/{productId}/images",
        "createProductImageUpload",
        true,
      ],
      ["get", "/v1/seller/products/{productId}", "getSellerProduct", true],
      [
        "put",
        "/v1/seller/products/{productId}/working-copy",
        "replaceProductWorkingCopy",
        true,
      ],
      [
        "put",
        "/v1/seller/products/{productId}/offers",
        "replaceVariantOffersBatch",
        true,
      ],
      [
        "put",
        "/v1/seller/products/{productId}/inventory",
        "replaceProductInventoryBatch",
        true,
      ],
      ["get", "/v1/seller/products/{productId}/preview", "previewSellerProduct", true],
      [
        "post",
        "/v1/seller/products/{productId}/publications",
        "publishSellerProduct",
        true,
      ],
      [
        "post",
        "/v1/seller/products/{productId}/unpublication",
        "unpublishSellerProduct",
        true,
      ],
      [
        "get",
        "/v1/stores/{storeSlug}/products/{productId}",
        "getPublishedStoreProduct",
        false,
      ],
    ] as const;

    for (const [method, path, operationId, authenticated] of expected) {
      const operation = document.paths[path]?.[method];
      expect(operation?.operationId, `${method.toUpperCase()} ${path}`).toBe(
        operationId,
      );
      expect(operation?.security).toEqual(
        authenticated ? [{ identitySession: [] }] : [],
      );
    }

    expect(document.paths["/v1/seller/products"].post.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Idempotency-Key", required: true }),
      ]),
    );
    expect(document.paths["/v1/seller/inventory"].put.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Idempotency-Key", required: true }),
      ]),
    );
    expect(document.paths["/v1/seller/products"].post.parameters).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "If-Match" })]),
    );
    expect(document.paths["/v1/seller/products"].get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "cursor", required: false }),
        expect.objectContaining({ name: "limit", required: false }),
        expect.objectContaining({ name: "state", required: false }),
      ]),
    );
    expect(document.components.schemas).toHaveProperty("SellerProductList");
    expect(Object.keys(document.paths["/v1/seller/products"].get.responses)).toEqual(
      expect.arrayContaining(["200", "401", "403", "404", "422", "500"]),
    );

    for (const [method, path] of [
      ["put", "/v1/seller/products/{productId}/working-copy"],
      ["put", "/v1/seller/products/{productId}/offers"],
      ["put", "/v1/seller/products/{productId}/inventory"],
      ["post", "/v1/seller/products/{productId}/publications"],
      ["post", "/v1/seller/products/{productId}/unpublication"],
    ] as const) {
      expect(document.paths[path][method].parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Idempotency-Key", required: true }),
          expect.objectContaining({ name: "If-Match", required: true }),
        ]),
      );
    }
  });
});
