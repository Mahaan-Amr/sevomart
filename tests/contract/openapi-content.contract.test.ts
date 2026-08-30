import { contentV1Operations } from "@sevo/contracts/content/v1";
import { contentV2Operations } from "@sevo/contracts/content/v2";
import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("OpenAPI content v1 contract", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => close?.());

  it("publishes the compatible v1 and executable v2 contracts together", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/openapi.json",
    });
    const document = response.json();

    for (const operation of [
      ...Object.values(contentV1Operations),
      ...Object.values(contentV2Operations),
    ]) {
      const published = document.paths[operation.path]?.[operation.method];
      expect(published?.operationId).toBe(operation.operationId);
      expect(published?.security).toEqual([{ identitySession: [] }]);
      expect(published?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Idempotency-Key", required: true }),
        ]),
      );
    }
    expect(document.components.schemas).toEqual(
      expect.objectContaining({
        PublishSalesContentInput: expect.any(Object),
        SalesContent: expect.any(Object),
        SalesContentProductEligibilityDecision: expect.any(Object),
        SalesContentPublishedV1: expect.any(Object),
        PurchaseExperienceEligibilityDecision: expect.any(Object),
        PublishPurchaseExperienceInput: expect.any(Object),
        PurchaseExperience: expect.any(Object),
        PurchaseExperiencePublishedV1: expect.any(Object),
        ContentError: expect.any(Object),
        PublishSalesContentInputV2: expect.any(Object),
        PurchaseExperienceEligibilityDecisionV2: expect.any(Object),
        PublishPurchaseExperienceInputV2: expect.any(Object),
      }),
    );
  });
});
