import { purchaseExperienceEligibilityDecisionV2Contract } from "@sevo/contracts/content/v2";

import type { OrderPurchaseExperienceEligibilityRead } from "../orders/public";
import type { PurchaseEligibilityRead } from "./public";

export function createOrderPurchaseEligibilityRead(
  orders: OrderPurchaseExperienceEligibilityRead,
): PurchaseEligibilityRead {
  return {
    async readEligibility(input) {
      return purchaseExperienceEligibilityDecisionV2Contract.parse(
        await orders.readPurchaseExperienceEligibility(input),
      );
    },
  };
}
