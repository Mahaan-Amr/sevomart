import {
  identityStoreApiOperations,
  identityStoreContractExamples,
  identityStoreContractSchemas,
} from "@sevo/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

type OpenApiOperation = {
  security?: Array<Record<string, unknown>>;
  requestBody?: {
    content: Record<string, { schema: { $ref: string }; example?: unknown }>;
  };
  responses: Record<
    string,
    { content?: Record<string, { schema: { $ref: string }; example?: unknown }> }
  >;
};

describe("OpenAPI identity and store compatibility", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => close?.());

  it("publishes every versioned operation with explicit authentication", async () => {
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

    for (const operationContract of identityStoreApiOperations) {
      const operation = document.paths[operationContract.path]?.[
        operationContract.method
      ] as OpenApiOperation | undefined;

      expect(
        operation,
        `${operationContract.method.toUpperCase()} ${operationContract.path}`,
      ).toBeDefined();
      expect(operation?.security).toEqual(
        operationContract.auth === "seller-session" ? [{ sellerSession: [] }] : [],
      );
      expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(
        [...operationContract.responses].map(({ status }) => `${status}`).sort(),
      );
    }
  });

  it("keeps documented schemas and examples consumable by the shared contracts", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/openapi.json",
    });
    const document = response.json();

    for (const schemaName of Object.keys(identityStoreContractSchemas)) {
      const schema = document.components.schemas[schemaName];
      expect(schema, schemaName).toBeDefined();
      expect(JSON.stringify(schema)).not.toContain('"any"');
      expect(JSON.stringify(schema)).not.toContain('{}"');

      const example = identityStoreContractExamples[schemaName];
      if (example !== undefined) {
        expect(
          identityStoreContractSchemas[schemaName].safeParse(example).success,
          schemaName,
        ).toBe(true);
      }
    }

    for (const operationContract of identityStoreApiOperations) {
      const operation = document.paths[operationContract.path][
        operationContract.method
      ] as OpenApiOperation;

      if (operationContract.request) {
        const requestMedia = operation.requestBody?.content["application/json"];
        expect(requestMedia?.schema.$ref).toBe(
          `#/components/schemas/${operationContract.request}`,
        );
        expect(
          identityStoreContractSchemas[operationContract.request].safeParse(
            requestMedia?.example,
          ).success,
        ).toBe(true);
      }

      for (const responseContract of operationContract.responses) {
        const responseMedia =
          operation.responses[`${responseContract.status}`].content?.[
            "application/json"
          ];
        expect(responseMedia?.schema.$ref).toBe(
          `#/components/schemas/${responseContract.schema}`,
        );
        expect(
          identityStoreContractSchemas[responseContract.schema].safeParse(
            responseMedia?.example,
          ).success,
        ).toBe(true);
      }
    }
  });
});
