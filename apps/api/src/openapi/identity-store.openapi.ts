import type { OpenAPIObject } from "@nestjs/swagger";
import {
  createIdentityStoreJsonSchemas,
  identityStoreApiOperations,
  identityStoreContractExamples,
  type IdentityStoreSchemaName,
} from "@sevo/contracts";

const responseDescriptions: Record<number, string> = {
  200: "Successful response",
  202: "Request accepted",
  401: "Seller session is missing or invalid",
  404: "Store was not found",
  409: "Store slug conflicts with an existing store",
  422: "Request validation failed",
  500: "Unexpected server error",
};

type SchemaReference = { $ref: string };
type JsonResponse = {
  description: string;
  headers?: Record<string, { description: string; schema: { type: "string" } }>;
  content: Record<"application/json", { schema: SchemaReference; example?: unknown }>;
};

type ContractOperation = {
  operationId: string;
  tags: string[];
  security: Array<Record<string, string[]>>;
  parameters?: Array<{
    name: string;
    in: "path";
    required: true;
    schema: Record<string, string | number>;
    example: string;
  }>;
  requestBody?: {
    required: true;
    content: Record<"application/json", { schema: SchemaReference; example?: unknown }>;
  };
  responses: Record<string, JsonResponse>;
};

function schemaReference(schemaName: IdentityStoreSchemaName): SchemaReference {
  return { $ref: `#/components/schemas/${schemaName}` };
}

function response(status: number, schemaName: IdentityStoreSchemaName): JsonResponse {
  const responseObject: JsonResponse = {
    description: responseDescriptions[status] ?? "Response",
    content: {
      "application/json": {
        schema: schemaReference(schemaName),
        example: identityStoreContractExamples[schemaName],
      },
    },
  };

  if (schemaName === "SellerSession") {
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
  Object.assign(document.components.schemas, createIdentityStoreJsonSchemas());
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
      tags: [contract.path.startsWith("/v1/auth") ? "identity-access" : "store"],
      security: contract.auth === "seller-session" ? [{ sellerSession: [] }] : [],
      responses: Object.fromEntries(
        contract.responses.map(({ status, schema }) => [
          `${status}`,
          response(status, schema),
        ]),
      ),
    };

    if (contract.path.includes("{slug}")) {
      operation.parameters = [
        {
          name: "slug",
          in: "path",
          required: true,
          schema: {
            type: "string",
            minLength: 3,
            maxLength: 48,
            pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
          },
          example: "khane-sofal-mah",
        },
      ];
    }

    if ("request" in contract && contract.request) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: schemaReference(contract.request),
            example: identityStoreContractExamples[contract.request],
          },
        },
      };
    }

    const pathItem = (document.paths[contract.path] ??= {});
    pathItem[contract.method] = operation;
  }

  return document;
}
