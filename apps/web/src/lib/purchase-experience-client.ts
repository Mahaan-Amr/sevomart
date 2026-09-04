import { purchaseExperienceEligibilityDecisionV2Contract } from "@sevo/contracts/content/v2";

export async function readPurchaseExperienceEligibility(orderItemId: string) {
  const response = await fetch(
    `/api/purchase-experiences/eligibility/${encodeURIComponent(orderItemId)}`,
    { cache: "no-store" },
  );
  if (response.status === 401) return { status: "UNAUTHENTICATED" } as const;
  const decision = purchaseExperienceEligibilityDecisionV2Contract.safeParse(
    await response.json(),
  );
  if (!response.ok || !decision.success) {
    throw new Error("purchase experience eligibility unavailable");
  }
  return { status: "READY", decision: decision.data } as const;
}
