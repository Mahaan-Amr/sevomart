import {
  sellerApplicationEventContract,
  sellerApplicationInputContract,
  sellerApplicationStatusContract,
  sellerApplicationV1Paths,
} from "@sevo/contracts/identity-access/v1";
import { describe, expect, it } from "vitest";

describe("seller application v1 contract", () => {
  it("accepts only the four necessary category-neutral application fields", () => {
    const result = sellerApplicationInputContract.safeParse({
      applicantName: "نگار محمدی",
      proposedStoreName: "خانه ماه",
      goodsAreaText: "سفال دست‌ساز",
      currentSalesMethod: "فروش از راه اینستاگرام و پیام مستقیم",
      mobile: "09123456789",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      applicantName: "نگار محمدی",
      proposedStoreName: "خانه ماه",
      goodsAreaText: "سفال دست‌ساز",
      currentSalesMethod: "فروش از راه اینستاگرام و پیام مستقیم",
    });
  });

  it("publishes the canonical lifecycle and applicant endpoints", () => {
    expect(sellerApplicationStatusContract.options).toEqual([
      "SUBMITTED",
      "NEEDS_INFORMATION",
      "APPROVED",
      "REJECTED",
      "WITHDRAWN",
    ]);
    expect(sellerApplicationV1Paths).toEqual({
      submit: "/v1/seller-applications",
      readMine: "/v1/seller-applications/mine",
      resubmit: "/v1/seller-applications/{applicationId}/resubmission",
      withdraw: "/v1/seller-applications/{applicationId}/withdrawal",
    });
  });

  it("keeps versioned event payloads free of names, request text and reasons", () => {
    const event = sellerApplicationEventContract.parse({
      version: 1,
      eventId: "7ef2709b-066f-4d6e-82f6-791c75a46fc7",
      eventType: "SellerApplicationSubmitted.v1",
      aggregateId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
      aggregateVersion: 1,
      occurredAt: "2026-08-24T08:00:00.000Z",
      correlationId: "592b7574-c60d-42dd-b91d-1603092b9835",
      actor: {
        type: "IDENTITY",
        id: "021e92b0-9188-442f-9713-4fcf85b7f7e5",
      },
      payload: {
        applicationId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
        identityId: "021e92b0-9188-442f-9713-4fcf85b7f7e5",
        status: "SUBMITTED",
        revision: 1,
        actorKind: "APPLICANT",
      },
    });

    expect(JSON.stringify(event.payload)).not.toMatch(
      /applicantName|proposedStoreName|goodsAreaText|currentSalesMethod|Reason/i,
    );
  });

  it("publishes the applicant withdrawal event without request text", () => {
    const event = sellerApplicationEventContract.parse({
      version: 1,
      eventId: "7ef2709b-066f-4d6e-82f6-791c75a46fc7",
      eventType: "SellerApplicationWithdrawn.v1",
      aggregateId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
      aggregateVersion: 2,
      occurredAt: "2026-08-24T08:05:00.000Z",
      correlationId: "592b7574-c60d-42dd-b91d-1603092b9835",
      actor: {
        type: "IDENTITY",
        id: "021e92b0-9188-442f-9713-4fcf85b7f7e5",
      },
      payload: {
        applicationId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
        identityId: "021e92b0-9188-442f-9713-4fcf85b7f7e5",
        status: "WITHDRAWN",
        revision: 1,
        actorKind: "APPLICANT",
      },
    });

    expect(event.payload.status).toBe("WITHDRAWN");
  });
});
