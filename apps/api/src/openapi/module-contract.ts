import type { OpenAPIObject } from "@nestjs/swagger";

export type ApiResponseContract =
  | { status: number; schema: string }
  | { status: number; binaryMedia: true }
  | { status: number; noContent: true };

export type ApiResponseMetadata = {
  descriptions: Readonly<Record<number, string>>;
  headersBySchema?: Readonly<
    Record<string, Record<string, { description: string; schema: { type: "string" } }>>
  >;
};

export type ApiOperationContract = {
  operationId: string;
  method: "delete" | "get" | "post" | "put";
  path: string;
  tag: string;
  auth: "identity-session" | "none";
  pathParameter?: {
    name: string;
    schema: string;
    example: string;
  };
  request?: {
    schema: string;
    example: unknown;
    contentType?: "application/json" | "multipart/form-data";
  };
  responses: readonly ApiResponseContract[];
};

type SchemaReference = { $ref: string };
type ContractResponse = {
  description: string;
  headers?: Record<string, { description: string; schema: { type: "string" } }>;
  content?: Record<
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
    content: Record<string, { schema: SchemaReference; example?: unknown }>;
  };
  responses: Record<string, ContractResponse>;
};

function schemaReference(schemaName: string): SchemaReference {
  return { $ref: `#/components/schemas/${schemaName}` };
}

function response(
  contract: ApiResponseContract,
  examples: Record<string, unknown>,
  metadata: ApiResponseMetadata,
): ContractResponse {
  const description = metadata.descriptions[contract.status];
  if (!description) {
    throw new Error(`OpenAPI response ${contract.status} requires a description`);
  }
  if ("noContent" in contract) {
    return { description };
  }
  if ("binaryMedia" in contract) {
    return {
      description,
      content: { "image/*": { schema: { type: "string", format: "binary" } } },
    };
  }

  const responseObject: ContractResponse = {
    description,
    content: {
      "application/json": {
        schema: schemaReference(contract.schema),
        example: examples[contract.schema],
      },
    },
  };
  const headers = metadata.headersBySchema?.[contract.schema];
  if (headers) responseObject.headers = headers;
  return responseObject;
}

export function addModuleOpenApiContract(
  document: OpenAPIObject,
  schemas: Record<string, unknown>,
  examples: Record<string, unknown>,
  operations: readonly ApiOperationContract[],
  responseMetadata: ApiResponseMetadata,
): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  Object.assign(document.components.schemas, schemas);

  for (const contract of operations) {
    const operation: ContractOperation = {
      operationId: contract.operationId,
      tags: [contract.tag],
      security: contract.auth === "identity-session" ? [{ identitySession: [] }] : [],
      responses: Object.fromEntries(
        contract.responses.map((responseContract) => [
          `${responseContract.status}`,
          response(responseContract, examples, responseMetadata),
        ]),
      ),
    };
    if (contract.pathParameter) {
      operation.parameters = [
        {
          name: contract.pathParameter.name,
          in: "path",
          required: true,
          schema: schemaReference(contract.pathParameter.schema),
          example: contract.pathParameter.example,
        },
      ];
    }
    if (contract.request) {
      operation.requestBody = {
        required: true,
        content: {
          [contract.request.contentType ?? "application/json"]: {
            schema: schemaReference(contract.request.schema),
            example: contract.request.example,
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
    requestRef:
      Object.values(operation.requestBody?.content ?? {})[0]?.schema.$ref ?? null,
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
  if (
    compatibilitySignature(registered as Partial<ContractOperation>) !==
    compatibilitySignature(expected)
  ) {
    throw new Error(`${label} does not match its v1 OpenAPI contract`);
  }
}
