import type { OpenAPIObject } from "@nestjs/swagger";
import {
  apiErrorV1Examples,
  createApiErrorV1JsonSchemas,
} from "@sevo/contracts/api-errors/v1";
import {
  createIdentityAccessV1JsonSchemas,
  identityAccessV1Examples,
} from "@sevo/contracts/identity-access/v1";
import { createMediaV1JsonSchemas, mediaV1Examples } from "@sevo/contracts/media/v1";
import { createStoreV1JsonSchemas, storeV1Examples } from "@sevo/contracts/store/v1";

import {
  identityStoreApiOperations,
  type ApiResponseContract,
  type IdentityStoreSchemaName,
} from "./identity-store.operations";

const contractExamples = {
  ...identityAccessV1Examples,
  ...storeV1Examples,
  ...mediaV1Examples,
  ...apiErrorV1Examples,
};

const responseDescriptions: Record<number, string> = {
  200: "Successful response",
  201: "Resource created",
  202: "Request accepted",
  401: "Seller session is missing or invalid",
  404: "Store was not found",
  409: "Store slug conflicts with an existing store",
  422: "Request validation failed",
  500: "Unexpected server error",
};

type SchemaReference = { $ref: string };
type ContractResponse = {
  description: string;
  headers?: Record<string, { description: string; schema: { type: "string" } }>;
  content: Record<
    string,
    { schema: SchemaReference | Record<string, string>; example?: unknown }
  >;
};

type ContractOperation = {
  operationId: string;
  tags: string[];
  security: Array<Record<string, string[]>>;
  parameters?: Array<{
    name: string;
    in: "path";
    required: true;
    schema: SchemaReference;
    example: string;
  }>;
  requestBody?: {
    required: true;
    content: Record<"application/json", { schema: SchemaReference; example?: unknown }>;
  };
  responses: Record<string, ContractResponse>;
};

function schemaReference(schemaName: IdentityStoreSchemaName): SchemaReference {
  return { $ref: `#/components/schemas/${schemaName}` };
}

function response(contract: ApiResponseContract): ContractResponse {
  if ("binaryMedia" in contract) {
    return {
      description: responseDescriptions[contract.status] ?? "Media content",
      content: {
        "image/*": { schema: { type: "string", format: "binary" } },
      },
    };
  }

  const responseObject: ContractResponse = {
    description: responseDescriptions[contract.status] ?? "Response",
    content: {
      "application/json": {
        schema: schemaReference(contract.schema),
        example: contractExamples[contract.schema],
      },
    },
  };

  if (contract.schema === "SellerSession") {
    responseObject.headers = {
      "Set-Cookie": {
        description: "Creates the HTTP-only seller session cookie.",
        schema: { type: "string" },
      },
    };
  }

  return responseObject;
}

export function addIdentityStoreOpenApiContract(
  document: OpenAPIObject,
): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  Object.assign(
    document.components.schemas,
    createIdentityAccessV1JsonSchemas(),
    createStoreV1JsonSchemas(),
    createMediaV1JsonSchemas(),
    createApiErrorV1JsonSchemas(),
  );
  document.components.securitySchemes ??= {};
  document.components.securitySchemes.sellerSession = {
    type: "apiKey",
    in: "cookie",
    name: "sevo_seller_session",
    description: "HTTP-only session established after OTP verification.",
  };

  for (const contract of identityStoreApiOperations) {
    const operation: ContractOperation = {
      operationId: contract.operationId,
      tags: [
        contract.path.startsWith("/v1/auth")
          ? "identity-access"
          : contract.path.includes("media")
            ? "media"
            : "store",
      ],
      security: contract.auth === "seller-session" ? [{ sellerSession: [] }] : [],
      responses: Object.fromEntries(
        contract.responses.map((responseContract) => [
          `${responseContract.status}`,
          response(responseContract),
        ]),
      ),
    };

    if ("pathParameter" in contract && contract.pathParameter) {
      const isSlug = contract.pathParameter === "slug";
      operation.parameters = [
        {
          name: contract.pathParameter,
          in: "path",
          required: true,
          schema: schemaReference(isSlug ? "StoreSlug" : "MediaId"),
          example: isSlug ? storeV1Examples.StoreSlug : mediaV1Examples.MediaId,
        },
      ];
    }

    if ("request" in contract && contract.request) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: schemaReference(contract.request),
            example: contractExamples[contract.request],
          },
        },
      };
    }

    const pathItem = (document.paths[contract.path] ??= {});
    const registeredOperation = pathItem[contract.method];
    if (registeredOperation) {
      assertRegisteredOperationCompatible(
        registeredOperation,
        operation,
        `${contract.method.toUpperCase()} ${contract.path}`,
      );
    }
    pathItem[contract.method] = operation;
  }

  return document;
}

function compatibilitySignature(operation: Partial<ContractOperation>): string {
  return JSON.stringify({
    security: operation.security ?? [],
    parameterRefs:
      operation.parameters?.map(({ name, schema }) => [name, schema.$ref]) ?? [],
    requestRef: operation.requestBody?.content["application/json"].schema.$ref ?? null,
    responses: Object.fromEntries(
      Object.entries(operation.responses ?? {}).map(([status, value]) => [
        status,
        Object.fromEntries(
          Object.entries(value.content ?? {}).map(([contentType, media]) => [
            contentType,
            media.schema,
          ]),
        ),
      ]),
    ),
  });
}

function assertRegisteredOperationCompatible(
  registered: unknown,
  expected: ContractOperation,
  label: string,
): void {
  const signature = compatibilitySignature(registered as Partial<ContractOperation>);
  if (signature !== compatibilitySignature(expected)) {
    throw new Error(`${label} does not match its v1 OpenAPI contract`);
  }
}
