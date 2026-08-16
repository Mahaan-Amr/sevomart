import { healthResponseContract } from "@sevo/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("GET /v1/health", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => close?.());

  it("exposes the versioned health contract and correlation id", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/v1/health",
        headers: { "x-correlation-id": "test-correlation" },
      });

    expect(response.statusCode).toBe(200);
    expect(healthResponseContract.parse(response.json())).toEqual({
      status: "ok",
      service: "api",
      version: 1,
    });
    expect(response.headers["x-correlation-id"]).toBe("test-correlation");
  });
});
