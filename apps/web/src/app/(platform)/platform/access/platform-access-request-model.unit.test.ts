import { describe, expect, it } from "vitest";

import { sensitiveRequestDetails } from "./platform-access-request-model";

describe("sensitiveRequestDetails", () => {
  it("gives a manager-assigned dispute reviewer both reveal and transition actions", () => {
    expect(
      sensitiveRequestDetails({
        responsibility: "DISPUTE_REVIEW",
        resourceType: "DISPUTE_CASE",
        action: "REVIEW_AND_RESOLVE_DISPUTE",
      }),
    ).toEqual({
      purposeCode: "RESOLVE_ASSIGNED_CASE",
      allowedActions: ["REVEAL_MINIMUM", "UPDATE_CASE_STATUS"],
    });
  });

  it("keeps ordinary sensitive grants least-privileged", () => {
    expect(
      sensitiveRequestDetails({
        responsibility: "PAYMENT_REVIEW",
        resourceType: "PAYMENT_REVIEW",
        action: "READ_MASKED",
      }),
    ).toEqual({
      purposeCode: "VERIFY_CASE_EVIDENCE",
      allowedActions: ["READ_MASKED"],
    });
  });
});
