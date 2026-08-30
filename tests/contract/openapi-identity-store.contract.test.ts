import { createHash } from "node:crypto";

import { apiErrorV1Schemas } from "@sevo/contracts/api-errors/v1";
import { identityAccessV1Schemas } from "@sevo/contracts/identity-access/v1";
import { mediaV1Schemas } from "@sevo/contracts/media/v1";
import { storeV1Schemas } from "@sevo/contracts/store/v1";
import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { contribute_identity_access_openApi } from "../../apps/api/src/openapi/modules/identity-access";
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
  [
    "post",
    "/v1/conversations/{conversationId}/media",
    "identity",
    [201, 401, 404, 413, 422, 429, 500],
  ],
  ["post", "/v1/auth/otp/requests", "none", [202, 422, 429, 500]],
  ["post", "/v1/auth/otp/verifications", "none", [200, 401, 422, 500]],
  ["get", "/v1/auth/session", "identity", [200, 401, 500]],
  ["delete", "/v1/auth/session", "none", [204, 500]],
  ["post", "/v1/seller-applications", "identity", [201, 401, 409, 422, 500]],
  ["get", "/v1/seller-applications/mine", "identity", [200, 401, 422, 500]],
  [
    "post",
    "/v1/seller-applications/{applicationId}/resubmission",
    "identity",
    [200, 401, 404, 409, 422, 500],
  ],
  [
    "post",
    "/v1/seller-applications/{applicationId}/withdrawal",
    "identity",
    [200, 401, 404, 409, 422, 500],
  ],
  ["get", "/v1/platform/seller-applications", "platform", [200, 401, 403, 422, 500]],
  [
    "get",
    "/v1/platform/seller-applications/{applicationId}",
    "platform",
    [200, 401, 403, 404, 422, 500],
  ],
  [
    "post",
    "/v1/platform/seller-applications/{applicationId}/information-request",
    "platform",
    [200, 401, 403, 404, 409, 422, 500],
  ],
  [
    "post",
    "/v1/platform/seller-applications/{applicationId}/rejection",
    "platform",
    [200, 401, 403, 404, 409, 422, 500],
  ],
  ["get", "/v1/seller/store/draft", "identity", [200, 401, 404, 500]],
  ["put", "/v1/seller/store/draft", "identity", [200, 401, 409, 422, 428, 500]],
  ["get", "/v1/store-slugs/{slug}/availability", "identity", [200, 401, 422, 500]],
  ["post", "/v1/seller/media", "identity", [201, 401, 413, 422, 429, 500]],
  ["get", "/v1/media/{mediaId}", "none", [200, 401, 404, 500]],
  ["get", "/v1/seller/store/preview", "identity", [200, 401, 404, 500]],
  [
    "post",
    "/v1/seller/store/publication",
    "identity",
    [200, 401, 404, 409, 422, 428, 500],
  ],
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

    expect(document.components.securitySchemes.identitySession).toMatchObject({
      type: "apiKey",
      in: "cookie",
    });
    expect(document.components.securitySchemes.platformAgentSession).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "sevo_platform_session",
    });

    for (const [method, path, auth, statuses] of frozenConsumerOperations) {
      const operation = document.paths[path]?.[method] as OpenApiOperation | undefined;
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation?.security).toEqual(
        auth === "identity"
          ? [{ identitySession: [] }]
          : auth === "platform"
            ? [{ platformAgentSession: [] }]
            : [],
      );
      expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(
        statuses.map(String).sort(),
      );
    }

    for (const path of [
      "/v1/seller-applications",
      "/v1/seller-applications/{applicationId}/resubmission",
      "/v1/seller-applications/{applicationId}/withdrawal",
      "/v1/platform/seller-applications/{applicationId}/approval",
    ]) {
      expect(document.paths[path].post.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { $ref: "#/components/schemas/IdempotencyKey" },
          }),
        ]),
      );
      expect(document.paths[path].post.responses["409"].headers).toMatchObject({
        "Retry-After": expect.objectContaining({
          schema: { type: "string" },
        }),
      });
    }

    expect(document.paths["/v1/seller-applications/mine"].get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "cursor", in: "query", required: false }),
        expect.objectContaining({ name: "limit", in: "query", required: false }),
      ]),
    );
    expect(
      document.paths["/v1/seller-applications/mine"].get.responses["422"].content[
        "application/json"
      ].schema,
    ).toEqual({ $ref: "#/components/schemas/SellerApplicationReadMineError" });

    expect(document.components.schemas.StoreDraftInput.required ?? []).toEqual([]);
    expect(
      document.paths["/v1/seller/media"].post.requestBody.content["multipart/form-data"]
        .schema,
    ).toEqual({ $ref: "#/components/schemas/MediaUploadInput" });
    expect(document.components.schemas.MediaUploadInput.properties.file).toMatchObject({
      type: "string",
      format: "binary",
      "x-maxBytes": 10 * 1024 * 1024,
      "x-maxPixels": 24_000_000,
      "x-acceptedMediaTypes": ["image/jpeg", "image/png", "image/webp"],
    });
    expect(document.components.schemas.PublicStore.required).toEqual(
      expect.arrayContaining([
        "name",
        "slug",
        "shippingMethods",
        "returnPolicy",
        "settlementDestination",
        "activeProductCount",
      ]),
    );
    expect(document.components.schemas.PublicStore.properties).toHaveProperty(
      "settlementDestination",
    );
    for (const [method, path] of [
      ["put", "/v1/seller/store/draft"],
      ["post", "/v1/seller/store/publication"],
    ] as const) {
      expect(document.paths[path][method].parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Idempotency-Key", required: true }),
          expect.objectContaining({ name: "If-Match", required: true }),
        ]),
      );
    }

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
      "affcbb14fffed6adefacffeae124ee347739f6147d19c7a1fedb94d642b94bff",
    );
  });

  it("documents internal Store reads and durable events without exposing an owner HTTP endpoint", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/openapi.json" });
    const document = response.json();
    const schemas = document.components.schemas;
    expect(schemas.StoreAuthoritativeSnapshotV1.properties).toHaveProperty(
      "sellerAccess",
    );
    expect(schemas.StoreAuthoritativeSnapshotV1.required).not.toContain("sellerAccess");
    expect(schemas.StoreSellerAccessV1.properties.active).toMatchObject({
      type: "boolean",
    });
    expect(schemas.StorePublishedV1.properties.payload.required).not.toContain(
      "publicationVersion",
    );
    expect(schemas.StoreUnpublishedV1.properties.payload.required).toContain(
      "publicationVersion",
    );
    for (const name of [
      "StorePublishedV1",
      "StoreUnpublishedV1",
      "StorePolicyChangedV1",
    ]) {
      expect(schemas[name].properties.payload.additionalProperties).toBe(false);
    }
    expect(schemas.PublicStore.properties).not.toHaveProperty("owner");
    expect(schemas.PublicStore.properties).not.toHaveProperty("sellerAccess");
    expect(
      document.paths["/v1/stores/{slug}"].get.responses["200"].content[
        "application/json"
      ].schema,
    ).toEqual({ $ref: "#/components/schemas/PublicStore" });
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
      contribute_identity_access_openApi({
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
