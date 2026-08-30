import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("OpenAPI fulfillment v1 contract", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => close?.());

  it("documents retry guidance for an in-progress advance", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/openapi.json",
    });
    const document = response.json();
    const operation =
      document.paths["/v1/seller/orders/{orderId}/fulfillment/advance"].post;

    expect(operation.responses["409"].headers).toMatchObject({
      "Retry-After": expect.objectContaining({
        schema: expect.objectContaining({ type: "string" }),
      }),
    });
  });
});
