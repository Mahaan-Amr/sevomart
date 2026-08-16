import { healthResponseContract } from "@sevo/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("OpenAPI health compatibility", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => close?.());

  it("publishes the same required literals as the shared health contract", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();

    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/openapi.json",
    });
    const document = response.json();
    const schema = document.components.schemas.HealthResponseDto;

    expect(document.paths).toHaveProperty("/v1/health");
    expect(schema.required).toEqual(
      expect.arrayContaining(["status", "service", "version"]),
    );
    expect(schema.properties).toMatchObject({
      status: { type: "string", enum: ["ok"] },
      service: { type: "string", enum: ["api"] },
      version: { type: "number", enum: [1] },
    });
    expect(
      healthResponseContract.parse(
        Object.fromEntries(
          Object.entries(schema.properties).map(([name, property]) => [
            name,
            (property as { enum: unknown[] }).enum[0],
          ]),
        ),
      ),
    ).toEqual({ status: "ok", service: "api", version: 1 });
  });
});
