import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("discovery following OpenAPI contract", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => close?.());

  it("publishes authenticated idempotent follow writes with concurrency headers", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/openapi.json",
    });
    const document = response.json();
    const path = document.paths["/v1/me/follows/{storeId}"];

    expect(path.put.operationId).toBe("activateStoreFollow");
    expect(path.delete.operationId).toBe("deactivateStoreFollow");
    for (const operation of [path.put, path.delete]) {
      expect(operation.security).toEqual([{ identitySession: [] }]);
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "storeId", in: "path", required: true }),
          expect.objectContaining({
            name: "Idempotency-Key",
            in: "header",
            required: true,
          }),
          expect.objectContaining({ name: "If-Match", in: "header", required: false }),
        ]),
      );
      expect(operation.responses["200"].headers).toHaveProperty("ETag");
      expect(operation.responses).toHaveProperty("409");
      expect(operation.responses).toHaveProperty("428");
    }
    expect(document.components.schemas).toHaveProperty("StoreFollowViewV1");
    expect(document.components.schemas).toHaveProperty("DiscoveryFollowErrorV1");
  });
});
