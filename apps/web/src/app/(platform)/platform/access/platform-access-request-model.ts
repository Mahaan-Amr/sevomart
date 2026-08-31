import type {
  PlatformAccessScope,
  Responsibility,
} from "@sevo/contracts/identity-access/v1";

export type AllowedAction = PlatformAccessScope["allowedActions"][number];
export type ScopeAction = AllowedAction | "REVIEW_AND_RESOLVE_DISPUTE";

export function sensitiveRequestDetails(input: {
  responsibility: Responsibility;
  resourceType: PlatformAccessScope["resourceType"];
  action: ScopeAction;
}) {
  const disputeAssignment = input.action === "REVIEW_AND_RESOLVE_DISPUTE";
  if (
    disputeAssignment &&
    (input.responsibility !== "DISPUTE_REVIEW" || input.resourceType !== "DISPUTE_CASE")
  ) {
    throw new Error("dispute assignment scope is invalid");
  }
  return {
    purposeCode: disputeAssignment
      ? ("RESOLVE_ASSIGNED_CASE" as const)
      : ("VERIFY_CASE_EVIDENCE" as const),
    allowedActions: disputeAssignment
      ? (["REVEAL_MINIMUM", "UPDATE_CASE_STATUS"] as const)
      : ([input.action] as readonly AllowedAction[]),
  };
}

export function supportsDisputeAssignment(
  responsibility: Responsibility,
  resourceType: PlatformAccessScope["resourceType"],
) {
  return responsibility === "DISPUTE_REVIEW" && resourceType === "DISPUTE_CASE";
}
