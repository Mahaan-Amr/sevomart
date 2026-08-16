import { createHash } from "node:crypto";

import { apiErrorV1Schemas } from "@sevo/contracts/api-errors/v1";
import { identityAccessV1Schemas } from "@sevo/contracts/identity-access/v1";
import { mediaV1Schemas } from "@sevo/contracts/media/v1";
import { storeV1Schemas } from "@sevo/contracts/store/v1";
import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { addIdentityStoreOpenApiContract } from "../../apps/api/src/openapi/identity-store.openapi";
import { apiTestEnvironment } from "../helpers/api-test-environment";

type OpenApiOperation = {
  security?: Array<Record<string, unknown>>;
  responses: Record<string, unknown>;
};

const contractSchemas = {
  ...identityAccessV1Schemas,
  ...storeV1Schemas,
  ...mediaV1Schemas,
  ...apiErrorV1Schemas,
};

const frozenConsumerOperations = [
  ["post", "/v1/auth/otp/requests", "none", [202, 422, 500]],
  ["post", "/v1/auth/otp/verifications", "none", [200, 401, 422, 500]],
  ["get", "/v1/seller/store/draft", "seller", [200, 401, 404, 500]],
  ["put", "/v1/seller/store/draft", "seller", [200, 401, 409, 422, 500]],
  ["get", "/v1/store-slugs/{slug}/availability", "seller", [200, 401, 422, 500]],
  ["post", "/v1/seller/media", "seller", [201, 401, 422, 500]],
  ["get", "/v1/media/{mediaId}", "none", [200, 404, 500]],
  ["get", "/v1/seller/store/preview", "seller", [200, 401, 404, 500]],
  ["post", "/v1/seller/store/publication", "seller", [200, 401, 404, 409, 422, 500]],
  ["get", "/v1/stores/{slug}", "none", [200, 404, 500]],
] as const;

describe("OpenAPI identity and store compatibility", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => close?.());

  it("matches the frozen Web consumer surface and complete v1 hash", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/openapi.json",
    });
    const document = response.json();

    expect(document.components.securitySchemes.sellerSession).toMatchObject({
      type: "apiKey",
      in: "cookie",
    });

    for (const [method, path, auth, statuses] of frozenConsumerOperations) {
      const operation = document.paths[path]?.[method] as OpenApiOperation | undefined;
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation?.security).toEqual(
        auth === "seller" ? [{ sellerSession: [] }] : [],
      );
      expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(
        statuses.map(String).sort(),
      );
    }

    expect(document.components.schemas.StoreDraftInput.required ?? []).toEqual([]);
    expect(document.components.schemas.PublicStore.required).toEqual(
      expect.arrayContaining([
        "name",
        "slug",
        "shippingMethods",
        "returnPolicy",
        "activeProductCount",
      ]),
    );

    const completeSurfaceHash = createHash("sha256")
      .update(
        JSON.stringify({
          paths: document.paths,
          schemas: document.components.schemas,
          securitySchemes: document.components.securitySchemes,
        }),
      )
      .digest("hex");
    expect(completeSurfaceHash).toBe(
      "a0b2b099f1d22b17d726ad04916432e07d29ba4be8eace969c792a30d190ff02",
    );
  });

  it("publishes each owned module schema without ambiguous any", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/openapi.json",
    });
    const document = response.json();

    for (const schemaName of Object.keys(contractSchemas)) {
      const schema = document.components.schemas[schemaName];
      expect(schema, schemaName).toBeDefined();
      expect(JSON.stringify(schema)).not.toContain('"any"');
    }
  });

  it("rejects a registered API route that disagrees with the contract", () => {
    expect(() =>
      addIdentityStoreOpenApiContract({
        openapi: "3.0.0",
        info: { title: "test", version: "1" },
        paths: {
          "/v1/auth/otp/requests": {
            post: { responses: { "204": { description: "wrong" } } },
          },
        },
      }),
    ).toThrow("POST /v1/auth/otp/requests does not match its v1 OpenAPI contract");
  });
});
