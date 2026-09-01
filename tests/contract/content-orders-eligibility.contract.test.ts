import { purchaseExperienceEligibilityDecisionV2Contract } from "@sevo/contracts/content/v2";
import {
  orderPurchaseExperienceEligibilityDecisionContract,
  orderPurchaseExperienceEligibilityInputContract,
} from "@sevo/contracts/orders/v1";
import { describe, expect, it } from "vitest";

import { createOrderPurchaseEligibilityRead } from "../../apps/api/src/modules/content/order-purchase-eligibility.adapter";

const input = orderPurchaseExperienceEligibilityInputContract.parse({
  buyerId: "10000000-0000-4000-8000-000000000091",
  orderItemId: "94000000-0000-4000-8000-000000000091",
});

describe("content consumer of Orders purchase eligibility", () => {
  it.each([
    orderPurchaseExperienceEligibilityDecisionContract.parse({
      eligible: true,
      ...input,
      storeId: "20000000-0000-4000-8000-000000000091",
      productId: "30000000-0000-4000-8000-000000000091",
      purchaseStatus: "CONFIRMED",
    }),
    orderPurchaseExperienceEligibilityDecisionContract.parse({
      eligible: false,
      reason: "NOT_ELIGIBLE",
    }),
  ])("accepts an owner-published decision", async (decision) => {
    const adapter = createOrderPurchaseEligibilityRead({
      async readPurchaseExperienceEligibility(received) {
        expect(received).toEqual(input);
        return decision;
      },
    });

    expect(
      purchaseExperienceEligibilityDecisionV2Contract.parse(
        await adapter.readEligibility(input),
      ),
    ).toEqual(decision);
  });

  it("does not turn an Orders infrastructure failure into ineligibility", async () => {
    const failure = new Error("orders unavailable");
    const adapter = createOrderPurchaseEligibilityRead({
      async readPurchaseExperienceEligibility() {
        throw failure;
      },
    });

    await expect(adapter.readEligibility(input)).rejects.toBe(failure);
  });
});
