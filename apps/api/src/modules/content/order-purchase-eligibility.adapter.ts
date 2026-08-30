import { purchaseExperienceEligibilityDecisionContract } from "@sevo/contracts/content/v1";

import type { OrderPurchaseExperienceEligibilityRead } from "../orders/public";
import type { PurchaseEligibilityRead } from "./public";

export function createOrderPurchaseEligibilityRead(
  orders: OrderPurchaseExperienceEligibilityRead,
): PurchaseEligibilityRead {
  return {
    async readEligibility(input) {
      return purchaseExperienceEligibilityDecisionContract.parse(
        await orders.readPurchaseExperienceEligibility(input),
      );
    },
  };
}
