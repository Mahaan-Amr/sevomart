import {
  approveResponsibilityGrantCommandContract,
  approveSensitiveAccessCommandContract,
  emergencyAccessActivationCommandContract,
  identityAccessV1Schemas,
  platformAccessAuditEntryContract,
  platformAccessErrorContract,
  platformAccessEventContract,
  platformAccessV1Paths,
  requestEmergencyAccessCommandContract,
  requestResponsibilityGrantCommandContract,
  requestSensitiveAccessCommandContract,
  sensitiveAccessGrantedV1Contract,
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
      sensitiveAccessGrants: "/v1/platform/access/sensitive-grants",
      sensitiveAccessApproval:
        "/v1/platform/access/sensitive-grants/{grantId}/approval",
      sensitiveAccessRevocation:
        "/v1/platform/access/sensitive-grants/{grantId}/revocation",
      emergencyAccessGrants: "/v1/platform/access/emergency-grants",
      emergencyAccessApproval:
        "/v1/platform/access/emergency-grants/{grantId}/approval",
      emergencyAccessActivation:
        "/v1/platform/access/emergency-grants/{grantId}/activation",
      emergencyAccessRevocation:
        "/v1/platform/access/emergency-grants/{grantId}/revocation",
      emergencyAccessClosure: "/v1/platform/access/emergency-grants/{grantId}/closure",
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
        outcome: "SUCCEEDED",
        singleManagerException: false,
        correlationId,
        occurredAt: "2026-08-26T10:01:00.000Z",
      }).action,
    ).toBe("SENSITIVE_FIELD_REVEALED");
  });

  it("publishes stable errors for policy and lifecycle failures", () => {
    expect(
      platformAccessErrorContract.parse({
        code: "SELF_APPROVAL_FORBIDDEN",
        message: "تأییدکننده باید از درخواست‌کننده جدا باشد.",
        correlationId,
      }).code,
    ).toBe("SELF_APPROVAL_FORBIDDEN");
  });

  it("publishes executable JSON schemas and OpenAPI operations from the owner fragment", () => {
    expect(identityAccessV1Schemas).toMatchObject({
      ResponsibilityGrantRequestInput: expect.anything(),
      SensitiveAccessRequestInput: expect.anything(),
      EmergencyAccessRequestInput: expect.anything(),
      PlatformAccessGrant: expect.anything(),
      PlatformAccessAuditPage: expect.anything(),
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
      ["post", platformAccessV1Paths.sensitiveAccessGrants, "requestSensitiveAccess"],
      ["get", platformAccessV1Paths.sensitiveAccessGrants, "listSensitiveAccessGrants"],
      ["post", platformAccessV1Paths.emergencyAccessGrants, "requestEmergencyAccess"],
      ["get", platformAccessV1Paths.emergencyAccessGrants, "listEmergencyAccessGrants"],
      [
        "post",
        platformAccessV1Paths.emergencyAccessActivation,
        "activateEmergencyAccess",
      ],
      ["get", platformAccessV1Paths.audit, "listPlatformAccessAudit"],
    ] as const;

    for (const [method, path, operationId] of expectedOperations) {
      expect(document.paths[path]?.[method]?.operationId).toBe(operationId);
      expect(document.paths[path]?.[method]?.security).toEqual([
        { platformAgentSession: [] },
      ]);
    }
    expect(document.components?.schemas?.PlatformAccessError).toBeDefined();
  });
});
