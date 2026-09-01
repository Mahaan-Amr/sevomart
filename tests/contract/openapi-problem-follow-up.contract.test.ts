import { afterEach, describe, expect, it } from "vitest";
import { problemFollowUpV1Operations } from "@sevo/contracts/problem-follow-up/v1";
import {
  problemFollowUpErrorV2Contract,
  problemFollowUpV2Operations,
} from "@sevo/contracts/problem-follow-up/v2";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("OpenAPI problem follow-up v1 reads and v2 mutations", () => {
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
      ["post", problemFollowUpV2Operations.openDispute, "identitySession"],
      ["get", problemFollowUpV1Operations.readBuyerDispute, "identitySession"],
      ["get", problemFollowUpV1Operations.listSellerDisputes, "identitySession"],
      ["get", problemFollowUpV1Operations.readSellerDispute, "identitySession"],
      ["post", problemFollowUpV2Operations.respondToDispute, "identitySession"],
      ["get", problemFollowUpV1Operations.listPlatformDisputes, "platformAgentSession"],
      ["get", problemFollowUpV1Operations.readPlatformDispute, "platformAgentSession"],
      ["post", problemFollowUpV2Operations.resolveDispute, "platformAgentSession"],
      ["post", problemFollowUpV2Operations.reopenDispute, "platformAgentSession"],
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

    for (const contract of [
      problemFollowUpV1Operations.openDispute,
      problemFollowUpV1Operations.respondToDispute,
      problemFollowUpV1Operations.resolveDispute,
      problemFollowUpV1Operations.reopenDispute,
    ]) {
      expect(document.paths[contract.path]?.[contract.method]).toBeUndefined();
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
      expect(JSON.stringify(requestSchema)).not.toContain("actorIdentityId");
      expect(JSON.stringify(requestSchema)).not.toContain("actorKind");
    }

    for (const contract of [
      problemFollowUpV1Operations.readPlatformDispute,
      problemFollowUpV2Operations.resolveDispute,
      problemFollowUpV2Operations.reopenDispute,
      problemFollowUpV1Operations.readPlatformViolationCase,
    ]) {
      const operation = document.paths[contract.path][contract.method];
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "X-Platform-Access-Grant-Id",
            required: true,
          }),
          expect.objectContaining({
            name: "X-Platform-Access-Reason",
            required: true,
          }),
        ]),
      );
    }
  });

  it("publishes the runtime idempotency precondition and concurrency faults", () => {
    for (const code of ["PRECONDITION_REQUIRED", "IDEMPOTENCY_IN_PROGRESS"] as const) {
      expect(
        problemFollowUpErrorV2Contract.safeParse({
          code,
          message: "درخواست قابل انجام نیست.",
          correlationId: "70000000-0000-4000-8000-000000000140",
        }).success,
      ).toBe(true);
    }
  });

  it("mounts the buyer producer route with the shared unauthorized envelope", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: problemFollowUpV2Operations.openDispute.path,
        headers: { "idempotency-key": "unauthorized-open" },
        payload: {},
      });

    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
