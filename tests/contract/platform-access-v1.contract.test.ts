import {
  approveResponsibilityGrantCommandContract,
  approveSensitiveAccessCommandContract,
  completeEmergencyAccessReviewCommandContract,
  emergencyAccessGrantViewContract,
  emergencyAccessActivationCommandContract,
  identityAccessV1Schemas,
  platformAccessAuditEntryContract,
  platformAccessErrorContract,
  platformAccessEventContract,
  platformAccessRejectionContract,
  platformAccessV1Paths,
  requestEmergencyAccessCommandContract,
  requestResponsibilityGrantCommandContract,
  responsibilityGrantViewContract,
  requestSensitiveAccessCommandContract,
  rejectPlatformAccessCommandContract,
  sensitiveAccessRequestInputContract,
  sensitiveAccessGrantedV1Contract,
  sensitiveAccessGrantViewContract,
  sensitiveAccessRejectedV1Contract,
} from "@sevo/contracts/identity-access/v1";
import * as rootContracts from "@sevo/contracts";
import { describe, expect, it } from "vitest";

import { contribute_identity_access_openApi } from "../../apps/api/src/openapi/modules/identity-access";

const requesterIdentityId = "11111111-1111-4111-8111-111111111111";
const recipientIdentityId = "22222222-2222-4222-8222-222222222222";
const approverIdentityId = "33333333-3333-4333-8333-333333333333";
const grantId = "44444444-4444-4444-8444-444444444444";
const resourceId = "55555555-5555-4555-8555-555555555555";
const correlationId = "66666666-6666-4666-8666-666666666666";
const authenticatedAt = "2026-08-26T09:55:00.000Z";

const paymentReviewScope = {
  resourceType: "PAYMENT_REVIEW" as const,
  resourceId,
  allowedActions: ["READ_MASKED", "REVEAL_MINIMUM"] as const,
};

describe("platform access v1 contract", () => {
  it("publishes module-owned paths for responsibility, sensitive and emergency access", () => {
    expect(platformAccessV1Paths).toEqual({
      responsibilityGrants: "/v1/platform/access/responsibility-grants",
      responsibilityGrantApproval:
        "/v1/platform/access/responsibility-grants/{grantId}/approval",
      responsibilityGrantRevocation:
        "/v1/platform/access/responsibility-grants/{grantId}/revocation",
      responsibilityGrantRejection:
        "/v1/platform/access/responsibility-grants/{grantId}/rejection",
      sensitiveAccessGrants: "/v1/platform/access/sensitive-grants",
      sensitiveAccessApproval:
        "/v1/platform/access/sensitive-grants/{grantId}/approval",
      sensitiveAccessRevocation:
        "/v1/platform/access/sensitive-grants/{grantId}/revocation",
      sensitiveAccessRejection:
        "/v1/platform/access/sensitive-grants/{grantId}/rejection",
      emergencyAccessGrants: "/v1/platform/access/emergency-grants",
      emergencyAccessApproval:
        "/v1/platform/access/emergency-grants/{grantId}/approval",
      emergencyAccessActivation:
        "/v1/platform/access/emergency-grants/{grantId}/activation",
      emergencyAccessRevocation:
        "/v1/platform/access/emergency-grants/{grantId}/revocation",
      emergencyAccessClosure: "/v1/platform/access/emergency-grants/{grantId}/closure",
      emergencyAccessRejection:
        "/v1/platform/access/emergency-grants/{grantId}/rejection",
      emergencyAccessReview: "/v1/platform/access/emergency-grants/{grantId}/review",
      audit: "/v1/platform/access/audit",
    });
  });

  it("keeps identity-access artifacts off the shared package root", () => {
    expect(rootContracts).not.toHaveProperty("platformAccessV1Paths");
    expect(rootContracts).not.toHaveProperty(
      "requestResponsibilityGrantCommandContract",
    );
    expect(rootContracts).not.toHaveProperty("platformAccessEventContract");
  });

  it("rejects self-grant and requires the correct control mode for high-risk grants", () => {
    const command = {
      requesterIdentityId,
      recipientIdentityId: requesterIdentityId,
      responsibility: "ACCESS_ADMINISTRATION" as const,
      reason: "بازیابی اداره دسترسی برای عامل نام‌دار",
      activeAccessManagerCount: 1,
      controlMode: "SINGLE_MANAGER_EXCEPTION" as const,
      strongAuthenticationAt: authenticatedAt,
    };

    expect(requestResponsibilityGrantCommandContract.safeParse(command).success).toBe(
      false,
    );
    expect(
      requestResponsibilityGrantCommandContract.safeParse({
        ...command,
        recipientIdentityId,
      }).success,
    ).toBe(true);
    expect(
      requestResponsibilityGrantCommandContract.safeParse({
        ...command,
        recipientIdentityId,
        activeAccessManagerCount: 2,
        controlMode: "SINGLE_MANAGER_EXCEPTION",
      }).success,
    ).toBe(false);
  });

  it("rejects self-approval and keeps dual-control participants distinct", () => {
    const responsibilityApproval = {
      grantId,
      requesterIdentityId,
      recipientIdentityId,
      approverIdentityId: requesterIdentityId,
      responsibility: "ACCESS_ADMINISTRATION" as const,
      activeAccessManagerCount: 2,
      strongAuthenticationAt: authenticatedAt,
    };
    expect(
      approveResponsibilityGrantCommandContract.safeParse(responsibilityApproval)
        .success,
    ).toBe(false);
    expect(
      approveResponsibilityGrantCommandContract.safeParse({
        ...responsibilityApproval,
        approverIdentityId,
      }).success,
    ).toBe(true);

    expect(
      approveSensitiveAccessCommandContract.safeParse({
        grantId,
        requesterIdentityId,
        recipientIdentityId: requesterIdentityId,
        approverIdentityId: requesterIdentityId,
        activeAccessManagerCount: 2,
        strongAuthenticationAt: authenticatedAt,
      }).success,
    ).toBe(false);
  });

  it("bounds sensitive access to one purpose, case scope and 30-60 minute TTL", () => {
    const command = {
      requesterIdentityId,
      recipientIdentityId: requesterIdentityId,
      responsibility: "PAYMENT_REVIEW" as const,
      purposeCode: "RESOLVE_ASSIGNED_CASE" as const,
      reason: "بررسی مغایرت نتیجه پرداخت همین پرونده",
      scope: paymentReviewScope,
      ttlMinutes: 30,
      requestMode: "AGENT_REQUEST" as const,
      activeAccessManagerCount: 2,
      controlMode: "REQUEST_APPROVAL" as const,
      strongAuthenticationAt: authenticatedAt,
    };

    expect(requestSensitiveAccessCommandContract.safeParse(command).success).toBe(true);
    expect(
      requestSensitiveAccessCommandContract.safeParse({
        ...command,
        ttlMinutes: 61,
      }).success,
    ).toBe(false);
    expect(
      requestSensitiveAccessCommandContract.safeParse({
        ...command,
        scope: { ...paymentReviewScope, allowedActions: ["BULK_EXPORT"] },
      }).success,
    ).toBe(false);

    expect(
      sensitiveAccessRequestInputContract.parse({
        recipientIdentityId,
        responsibility: "PAYMENT_REVIEW",
        purposeCode: "RESOLVE_ASSIGNED_CASE",
        reason: "تخصیص پرونده پرداخت به عامل مشخص",
        scope: paymentReviewScope,
        ttlMinutes: 30,
      }).recipientIdentityId,
    ).toBe(recipientIdentityId);
    expect(
      requestSensitiveAccessCommandContract.safeParse({
        ...command,
        recipientIdentityId,
        requestMode: "MANAGER_ASSIGNMENT",
        activeAccessManagerCount: 1,
        controlMode: "SINGLE_MANAGER_EXCEPTION",
      }).success,
    ).toBe(true);
    expect(
      approveSensitiveAccessCommandContract.safeParse({
        grantId,
        requesterIdentityId,
        recipientIdentityId: requesterIdentityId,
        approverIdentityId,
        activeAccessManagerCount: 1,
        strongAuthenticationAt: authenticatedAt,
      }).success,
    ).toBe(true);
  });

  it("allows the explicit single-manager emergency exception without faking approval", () => {
    const request = requestEmergencyAccessCommandContract.parse({
      requesterIdentityId,
      incidentId: "INC-2026-0042",
      reason: "خطر مشخص برای صحت نتیجه‌های پرداخت",
      scope: paymentReviewScope,
      ttlMinutes: 30,
      activeAccessManagerCount: 1,
      controlMode: "SINGLE_MANAGER_EXCEPTION",
      strongAuthenticationAt: authenticatedAt,
    });
    expect(request.controlMode).toBe("SINGLE_MANAGER_EXCEPTION");

    expect(
      emergencyAccessActivationCommandContract.safeParse({
        grantId,
        requesterIdentityId,
        activatorIdentityId: requesterIdentityId,
        activeAccessManagerCount: 1,
        controlMode: "SINGLE_MANAGER_EXCEPTION",
        strongAuthenticationAt: authenticatedAt,
      }).success,
    ).toBe(true);
    expect(
      emergencyAccessActivationCommandContract.safeParse({
        grantId,
        requesterIdentityId,
        activatorIdentityId: requesterIdentityId,
        approverIdentityId: requesterIdentityId,
        activeAccessManagerCount: 2,
        controlMode: "DUAL_CONTROL",
        strongAuthenticationAt: authenticatedAt,
      }).success,
    ).toBe(false);
  });

  it("publishes executable rejection and post-incident review commands", () => {
    expect(
      rejectPlatformAccessCommandContract.safeParse({
        grantId,
        requesterIdentityId,
        recipientIdentityId: requesterIdentityId,
        reviewerIdentityId: requesterIdentityId,
        reason: "درخواست با محدوده مجاز پرونده هم‌خوان نیست",
        expectedRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      rejectPlatformAccessCommandContract.safeParse({
        grantId,
        requesterIdentityId,
        recipientIdentityId: requesterIdentityId,
        reviewerIdentityId: approverIdentityId,
        reason: "درخواست با محدوده مجاز پرونده هم‌خوان نیست",
        expectedRevision: 1,
      }).success,
    ).toBe(true);

    const rejection = platformAccessRejectionContract.parse({
      grantId,
      grantKind: "SENSITIVE_ACCESS",
      requestStatus: "REJECTED",
      revision: 2,
      rejectedAt: "2026-08-26T10:03:00.000Z",
    });
    expect(
      sensitiveAccessRejectedV1Contract.parse({
        version: 1,
        eventId: "99999999-9999-4999-8999-999999999999",
        eventType: "SensitiveAccessRejected.v1",
        aggregateId: grantId,
        aggregateVersion: 2,
        occurredAt: rejection.rejectedAt,
        correlationId,
        actor: { type: "IDENTITY", id: approverIdentityId },
        payload: {
          grantKind: rejection.grantKind,
          grantId,
          subjectIdentityId: requesterIdentityId,
          requestStatus: rejection.requestStatus,
          auditRequired: true,
        },
      }).payload.requestStatus,
    ).toBe("REJECTED");

    expect(
      completeEmergencyAccessReviewCommandContract.safeParse({
        grantId,
        requesterIdentityId,
        approverIdentityId,
        reviewerIdentityId: requesterIdentityId,
        reviewMode: "INDEPENDENT",
        availableHumanReviewerCount: 2,
        findingCode: "CONTROLS_FOLLOWED",
        reviewDueAt: "2026-08-27T10:00:00.000Z",
        reviewedAt: "2026-08-26T16:00:00.000Z",
        expectedRevision: 4,
      }).success,
    ).toBe(false);
    expect(
      completeEmergencyAccessReviewCommandContract.safeParse({
        grantId,
        requesterIdentityId,
        approverIdentityId: null,
        reviewerIdentityId: requesterIdentityId,
        reviewMode: "WITHOUT_INDEPENDENT_REVIEW",
        availableHumanReviewerCount: 1,
        findingCode: "CONTROLS_FOLLOWED",
        reviewDueAt: "2026-08-27T10:00:00.000Z",
        reviewedAt: "2026-08-26T16:00:00.000Z",
        expectedRevision: 4,
      }).success,
    ).toBe(true);
  });

  it("restricts each grant kind to its approved lifecycle", () => {
    const base = {
      grantId,
      subjectIdentityId: requesterIdentityId,
      requestedByIdentityId: requesterIdentityId,
      approvedByIdentityId: approverIdentityId,
      revision: 2,
      singleManagerException: false,
      createdAt: "2026-08-26T10:00:00.000Z",
      activatedAt: "2026-08-26T10:01:00.000Z",
      revokedAt: null,
    };
    expect(
      responsibilityGrantViewContract.safeParse({
        ...base,
        grantKind: "RESPONSIBILITY",
        responsibility: "PAYMENT_REVIEW",
        status: "EXPIRED",
        expiresAt: null,
      }).success,
    ).toBe(false);
    expect(
      sensitiveAccessGrantViewContract.safeParse({
        ...base,
        grantKind: "SENSITIVE_ACCESS",
        responsibility: "PAYMENT_REVIEW",
        purposeCode: "RESOLVE_ASSIGNED_CASE",
        scope: paymentReviewScope,
        status: "CLOSED",
        expiresAt: "2026-08-26T10:31:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      emergencyAccessGrantViewContract.safeParse({
        ...base,
        grantKind: "EMERGENCY_ACCESS",
        incidentId: "INC-2026-0042",
        scope: paymentReviewScope,
        status: "CLOSED",
        expiresAt: "2026-08-26T10:31:00.000Z",
        reviewDueAt: "2026-08-27T10:00:00.000Z",
        reviewStatus: "PENDING",
      }).success,
    ).toBe(true);
  });

  it("publishes PII-free lifecycle events and append-only audit records", () => {
    const eventInput = {
      version: 1,
      eventId: "77777777-7777-4777-8777-777777777777",
      eventType: "SensitiveAccessGranted.v1",
      aggregateId: grantId,
      aggregateVersion: 2,
      occurredAt: "2026-08-26T10:00:00.000Z",
      correlationId,
      actor: { type: "IDENTITY", id: approverIdentityId },
      payload: {
        grantKind: "SENSITIVE_ACCESS",
        grantId,
        subjectIdentityId: requesterIdentityId,
        status: "ACTIVE",
        scope: paymentReviewScope,
        expiresAt: "2026-08-26T10:30:00.000Z",
        singleManagerException: false,
        auditRequired: true,
      },
    } as const;
    const event = sensitiveAccessGrantedV1Contract.parse(eventInput);
    expect(platformAccessEventContract.parse(eventInput)).toEqual(event);
    expect(JSON.stringify(event)).not.toMatch(/mobile|bank|rawValue|reason/i);
    expect(
      platformAccessEventContract.safeParse({
        ...event,
        eventType: "EmergencyAccessActivated.v1",
      }).success,
    ).toBe(false);

    expect(
      platformAccessAuditEntryContract.parse({
        auditId: "88888888-8888-4888-8888-888888888888",
        grantId,
        action: "SENSITIVE_FIELD_REVEALED",
        actorIdentityId: requesterIdentityId,
        subjectIdentityId: requesterIdentityId,
        scope: paymentReviewScope,
        reasonCode: "CASE_ACCESS_APPROVED",
        reason: "بررسی مغایرت نتیجه پرداخت همین پرونده",
        outcome: "SUCCEEDED",
        singleManagerException: false,
        correlationId,
        occurredAt: "2026-08-26T10:01:00.000Z",
      }).action,
    ).toBe("SENSITIVE_FIELD_REVEALED");
    expect(
      platformAccessAuditEntryContract.safeParse({
        auditId: "88888888-8888-4888-8888-888888888888",
        grantId,
        action: "SENSITIVE_FIELD_REVEALED",
        actorIdentityId: requesterIdentityId,
        subjectIdentityId: requesterIdentityId,
        scope: paymentReviewScope,
        reasonCode: "CASE_ACCESS_APPROVED",
        reason: "برای تماس با 09123456789 اطلاعات پرونده آشکار شد",
        outcome: "SUCCEEDED",
        singleManagerException: false,
        correlationId,
        occurredAt: "2026-08-26T10:01:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("publishes stable errors for policy and lifecycle failures", () => {
    expect(
      platformAccessErrorContract.parse({
        code: "SELF_APPROVAL_FORBIDDEN",
        message: "تأییدکننده باید از درخواست‌کننده جدا باشد.",
        correlationId,
      }).code,
    ).toBe("SELF_APPROVAL_FORBIDDEN");
    expect(
      platformAccessErrorContract.safeParse({
        code: "SELF_APPROVAL_FORBIDDEN",
        message: "تأییدکننده باید از درخواست‌کننده جدا باشد.",
        correlationId,
        details: { rawBankAccount: "IR000000000000000000000000" },
      }).success,
    ).toBe(false);
  });

  it("publishes executable JSON schemas and OpenAPI operations from the owner fragment", () => {
    expect(identityAccessV1Schemas).toMatchObject({
      ResponsibilityGrantRequestInput: expect.anything(),
      SensitiveAccessRequestInput: expect.anything(),
      EmergencyAccessRequestInput: expect.anything(),
      PlatformAccessGrant: expect.anything(),
      PlatformAccessRejection: expect.anything(),
      PlatformAccessAuditPage: expect.anything(),
      PlatformAccessRejectionInput: expect.anything(),
      EmergencyAccessReviewInput: expect.anything(),
      PlatformAccessError: platformAccessErrorContract,
    });

    const document = contribute_identity_access_openApi({
      openapi: "3.0.0",
      info: { title: "test", version: "1" },
      paths: {},
    });
    const expectedOperations = [
      [
        "post",
        platformAccessV1Paths.responsibilityGrants,
        "requestResponsibilityGrant",
      ],
      ["get", platformAccessV1Paths.responsibilityGrants, "listResponsibilityGrants"],
      [
        "post",
        platformAccessV1Paths.responsibilityGrantApproval,
        "approveResponsibilityGrant",
      ],
      [
        "post",
        platformAccessV1Paths.responsibilityGrantRevocation,
        "revokeResponsibilityGrant",
      ],
      [
        "post",
        platformAccessV1Paths.responsibilityGrantRejection,
        "rejectResponsibilityGrant",
      ],
      ["post", platformAccessV1Paths.sensitiveAccessGrants, "requestSensitiveAccess"],
      ["get", platformAccessV1Paths.sensitiveAccessGrants, "listSensitiveAccessGrants"],
      ["post", platformAccessV1Paths.sensitiveAccessApproval, "approveSensitiveAccess"],
      [
        "post",
        platformAccessV1Paths.sensitiveAccessRevocation,
        "revokeSensitiveAccess",
      ],
      ["post", platformAccessV1Paths.sensitiveAccessRejection, "rejectSensitiveAccess"],
      ["post", platformAccessV1Paths.emergencyAccessGrants, "requestEmergencyAccess"],
      ["get", platformAccessV1Paths.emergencyAccessGrants, "listEmergencyAccessGrants"],
      ["post", platformAccessV1Paths.emergencyAccessApproval, "approveEmergencyAccess"],
      [
        "post",
        platformAccessV1Paths.emergencyAccessActivation,
        "activateEmergencyAccess",
      ],
      [
        "post",
        platformAccessV1Paths.emergencyAccessRevocation,
        "revokeEmergencyAccess",
      ],
      ["post", platformAccessV1Paths.emergencyAccessClosure, "closeEmergencyAccess"],
      ["post", platformAccessV1Paths.emergencyAccessRejection, "rejectEmergencyAccess"],
      [
        "post",
        platformAccessV1Paths.emergencyAccessReview,
        "completeEmergencyAccessReview",
      ],
      ["get", platformAccessV1Paths.audit, "listPlatformAccessAudit"],
    ] as const;

    for (const [method, path, operationId] of expectedOperations) {
      expect(document.paths[path]?.[method]?.operationId).toBe(operationId);
      expect(document.paths[path]?.[method]?.security).toEqual([
        { platformAgentSession: [] },
      ]);
    }
    for (const path of [
      platformAccessV1Paths.responsibilityGrants,
      platformAccessV1Paths.sensitiveAccessGrants,
      platformAccessV1Paths.emergencyAccessGrants,
    ]) {
      expect(
        document.paths[path]?.get?.parameters?.map(
          (parameter: { name: string }) => parameter.name,
        ),
      ).toEqual(["subjectIdentityId", "status", "cursor", "limit"]);
    }
    expect(
      document.paths[platformAccessV1Paths.audit]?.get?.parameters?.map(
        (parameter: { name: string }) => parameter.name,
      ),
    ).toEqual(["grantId", "actorIdentityId", "cursor", "limit"]);
    for (const path of [
      platformAccessV1Paths.responsibilityGrantRejection,
      platformAccessV1Paths.sensitiveAccessRejection,
      platformAccessV1Paths.emergencyAccessRejection,
    ]) {
      expect(
        document.paths[path]?.post?.responses?.["200"]?.content?.["application/json"]
          ?.schema,
      ).toEqual({ $ref: "#/components/schemas/PlatformAccessRejection" });
    }
    expect(document.components?.schemas?.PlatformAccessError).toBeDefined();
  });
});
