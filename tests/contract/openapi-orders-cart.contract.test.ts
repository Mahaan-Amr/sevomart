import { afterEach, describe, expect, it } from "vitest";

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
      ["post", "/v1/cart/store-replacement", "replaceCartStore", false],
      ["post", "/v1/cart/attach", "attachGuestCart", true],
      ["post", "/v1/cart/resolve", "resolveCartConflict", true],
    ] as const;

    for (const [method, path, operationId, authenticated] of expected) {
      const operation = document.paths[path]?.[method];
      expect(operation?.operationId).toBe(operationId);
      expect(operation?.security).toEqual(
        authenticated ? [{ identitySession: [] }] : [],
      );
    }
    for (const [method, path] of expected
      .slice(1)
      .map(([method, path]) => [method, path])) {
      expect(document.paths[path][method].parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Idempotency-Key", required: true }),
        ]),
      );
    }
  });
});
