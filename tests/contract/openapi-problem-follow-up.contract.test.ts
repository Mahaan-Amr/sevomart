import { afterEach, describe, expect, it } from "vitest";
import { problemFollowUpV1Operations } from "@sevo/contracts/problem-follow-up/v1";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("OpenAPI problem follow-up v1", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => close?.());

  it("publishes role-scoped dispute and violation operations without actor spoofing", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/openapi.json",
    });
    const document = response.json();
    const expected = [
      ["post", problemFollowUpV1Operations.openDispute, "identitySession"],
      ["get", problemFollowUpV1Operations.readBuyerDispute, "identitySession"],
      ["get", problemFollowUpV1Operations.listSellerDisputes, "identitySession"],
      ["get", problemFollowUpV1Operations.readSellerDispute, "identitySession"],
      ["post", problemFollowUpV1Operations.respondToDispute, "identitySession"],
      ["get", problemFollowUpV1Operations.listPlatformDisputes, "platformAgentSession"],
      ["get", problemFollowUpV1Operations.readPlatformDispute, "platformAgentSession"],
      ["post", problemFollowUpV1Operations.resolveDispute, "platformAgentSession"],
      ["post", problemFollowUpV1Operations.reopenDispute, "platformAgentSession"],
      [
        "get",
        problemFollowUpV1Operations.listPlatformViolationCases,
        "platformAgentSession",
      ],
      [
        "get",
        problemFollowUpV1Operations.readPlatformViolationCase,
        "platformAgentSession",
      ],
    ] as const;

    for (const [method, contract, securityScheme] of expected) {
      const operation = document.paths[contract.path]?.[method];
      expect(operation?.operationId).toBe(contract.operationId);
      expect(operation?.security).toEqual([{ [securityScheme]: [] }]);
    }

    for (const [method, contract] of expected.filter(([method]) => method === "post")) {
      const operation = document.paths[contract.path][method];
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Idempotency-Key", required: true }),
        ]),
      );
      const requestSchemaName = operation.requestBody.content[
        "application/json"
      ].schema.$ref
        .split("/")
        .at(-1);
      const requestSchema = document.components.schemas[requestSchemaName];
      expect(requestSchema.properties).not.toHaveProperty("actorIdentityId");
      expect(requestSchema.properties).not.toHaveProperty("actorKind");
    }
  });
});
