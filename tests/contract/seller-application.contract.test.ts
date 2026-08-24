import {
  approveSellerApplicationContract,
  approveSellerApplicationResultContract,
  platformSellerApplicationDecisionEventContract,
  platformSellerApplicationV1Paths,
  rejectSellerApplicationContract,
  requestSellerApplicationInformationContract,
  sellerAccessActivatedEventContract,
  sellerApprovalRecoveryRequestedEventContract,
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

  it("publishes the platform review queue and decision contracts", () => {
    expect(platformSellerApplicationV1Paths).toEqual({
      list: "/v1/platform/seller-applications",
      read: "/v1/platform/seller-applications/{applicationId}",
      requestInformation:
        "/v1/platform/seller-applications/{applicationId}/information-request",
      approve: "/v1/platform/seller-applications/{applicationId}/approval",
      reject: "/v1/platform/seller-applications/{applicationId}/rejection",
    });

    expect(
      requestSellerApplicationInformationContract.parse({
        expectedRevision: 1,
        reasonCode: "INFORMATION_INCOMPLETE",
        publicReason: "لطفاً روش فعلی فروش را روشن‌تر توضیح دهید.",
        internalNote: "نیاز به شرح مسیر ثبت سفارش دارد.",
        requestedFields: ["currentSalesMethod"],
      }),
    ).toMatchObject({ requestedFields: ["currentSalesMethod"] });
    expect(
      approveSellerApplicationContract.parse({
        expectedRevision: 1,
        reasonCode: "ELIGIBILITY_CONFIRMED",
        publicReason: "شرایط فروشندگی شما تأیید شد.",
      }),
    ).toMatchObject({ reasonCode: "ELIGIBILITY_CONFIRMED" });
    expect(
      rejectSellerApplicationContract.parse({
        expectedRevision: 1,
        reasonCode: "ELIGIBILITY_NOT_ESTABLISHED",
        publicReason: "با اطلاعات فعلی امکان تأیید فروشندگی وجود ندارد.",
      }),
    ).toMatchObject({ reasonCode: "ELIGIBILITY_NOT_ESTABLISHED" });
  });

  it("publishes the atomic approval result with seller access and store identifiers", () => {
    expect(
      approveSellerApplicationResultContract.parse({
        applicationId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
        revision: 2,
        sellerAccessId: "9ef2709b-066f-4d6e-82f6-791c75a46fc7",
        storeId: "15f00f04-813c-44f9-b681-22cb4f3dbeae",
      }),
    ).toMatchObject({ revision: 2 });
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

  it("keeps platform decision events free of request and reason text", () => {
    const event = platformSellerApplicationDecisionEventContract.parse({
      version: 1,
      eventId: "7ef2709b-066f-4d6e-82f6-791c75a46fc7",
      eventType: "SellerApplicationInformationRequested.v1",
      aggregateId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
      aggregateVersion: 2,
      occurredAt: "2026-08-24T08:05:00.000Z",
      correlationId: "592b7574-c60d-42dd-b91d-1603092b9835",
      actor: {
        type: "IDENTITY",
        id: "9921f18f-187f-40dd-a389-1626156366f8",
      },
      payload: {
        applicationId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
        status: "NEEDS_INFORMATION",
        revision: 2,
        reasonCode: "INFORMATION_INCOMPLETE",
        actorKind: "PLATFORM_AGENT",
      },
    });

    expect(JSON.stringify(event.payload)).not.toMatch(
      /applicantName|proposedStoreName|goodsAreaText|currentSalesMethod|publicReason|internalNote/i,
    );
  });

  it("keeps approval and seller-access events free of names and reason text", () => {
    const approval = platformSellerApplicationDecisionEventContract.parse({
      version: 1,
      eventId: "7ef2709b-066f-4d6e-82f6-791c75a46fc7",
      eventType: "SellerApplicationApproved.v1",
      aggregateId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
      aggregateVersion: 2,
      occurredAt: "2026-08-24T08:05:00.000Z",
      correlationId: "592b7574-c60d-42dd-b91d-1603092b9835",
      causationId: "592b7574-c60d-42dd-b91d-1603092b9835",
      actor: {
        type: "IDENTITY",
        id: "9921f18f-187f-40dd-a389-1626156366f8",
      },
      payload: {
        applicationId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
        status: "APPROVED",
        revision: 2,
        reasonCode: "ELIGIBILITY_CONFIRMED",
        actorKind: "PLATFORM_AGENT",
      },
    });
    const access = sellerAccessActivatedEventContract.parse({
      version: 1,
      eventId: "8ef2709b-066f-4d6e-82f6-791c75a46fc7",
      eventType: "SellerAccessActivated.v1",
      aggregateId: "9ef2709b-066f-4d6e-82f6-791c75a46fc7",
      aggregateVersion: 1,
      occurredAt: "2026-08-24T08:05:00.000Z",
      correlationId: "592b7574-c60d-42dd-b91d-1603092b9835",
      causationId: "592b7574-c60d-42dd-b91d-1603092b9835",
      actor: {
        type: "IDENTITY",
        id: "9921f18f-187f-40dd-a389-1626156366f8",
      },
      payload: {
        sellerAccessId: "9ef2709b-066f-4d6e-82f6-791c75a46fc7",
        identityId: "021e92b0-9188-442f-9713-4fcf85b7f7e5",
        status: "ACTIVE",
        actorKind: "PLATFORM_AGENT",
      },
    });

    expect(JSON.stringify([approval.payload, access.payload])).not.toMatch(
      /applicantName|proposedStoreName|goodsAreaText|currentSalesMethod|publicReason|internalNote/i,
    );
  });

  it("publishes a private recovery signal with identifiers only", () => {
    const event = sellerApprovalRecoveryRequestedEventContract.parse({
      version: 1,
      eventId: "7ef2709b-066f-4d6e-82f6-791c75a46fc7",
      eventType: "SellerApprovalRecoveryRequested.v1",
      aggregateId: "8ef2709b-066f-4d6e-82f6-791c75a46fc7",
      aggregateVersion: 1,
      occurredAt: "2026-08-24T08:05:00.000Z",
      correlationId: "592b7574-c60d-42dd-b91d-1603092b9835",
      causationId: "592b7574-c60d-42dd-b91d-1603092b9835",
      actor: {
        type: "IDENTITY",
        id: "9921f18f-187f-40dd-a389-1626156366f8",
      },
      payload: {
        recoveryId: "8ef2709b-066f-4d6e-82f6-791c75a46fc7",
        applicationId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
        actorKind: "PLATFORM_AGENT",
      },
    });

    expect(JSON.stringify(event.payload)).not.toMatch(
      /applicantName|proposedStoreName|goodsAreaText|currentSalesMethod|publicReason|internalNote/i,
    );
  });
});
