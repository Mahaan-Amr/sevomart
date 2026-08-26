import { z } from "zod";

import {
  eventEnvelopeV1Contract,
  identityIdContract,
  timestampV1Contract,
} from "../../platform/v1/index";

export const PLATFORM_ACCESS_DEFAULT_TTL_MINUTES = 30;
export const PLATFORM_ACCESS_MAX_TTL_MINUTES = 60;
export const EMERGENCY_ACCESS_MAX_TTL_MINUTES = 30;
export const PLATFORM_ACCESS_STRONG_AUTH_MAX_AGE_MINUTES = 5;

export const platformAccessV1Paths = {
  responsibilityGrants: "/v1/platform/access/responsibility-grants",
  responsibilityGrantApproval:
    "/v1/platform/access/responsibility-grants/{grantId}/approval",
  responsibilityGrantRevocation:
    "/v1/platform/access/responsibility-grants/{grantId}/revocation",
  responsibilityGrantRejection:
    "/v1/platform/access/responsibility-grants/{grantId}/rejection",
  sensitiveAccessGrants: "/v1/platform/access/sensitive-grants",
  sensitiveAccessApproval: "/v1/platform/access/sensitive-grants/{grantId}/approval",
  sensitiveAccessRevocation:
    "/v1/platform/access/sensitive-grants/{grantId}/revocation",
  sensitiveAccessRejection: "/v1/platform/access/sensitive-grants/{grantId}/rejection",
  emergencyAccessGrants: "/v1/platform/access/emergency-grants",
  emergencyAccessApproval: "/v1/platform/access/emergency-grants/{grantId}/approval",
  emergencyAccessActivation:
    "/v1/platform/access/emergency-grants/{grantId}/activation",
  emergencyAccessRevocation:
    "/v1/platform/access/emergency-grants/{grantId}/revocation",
  emergencyAccessClosure: "/v1/platform/access/emergency-grants/{grantId}/closure",
  emergencyAccessRejection: "/v1/platform/access/emergency-grants/{grantId}/rejection",
  emergencyAccessReview: "/v1/platform/access/emergency-grants/{grantId}/review",
  audit: "/v1/platform/access/audit",
} as const;

export const platformAccessGrantIdContract = z.uuid().brand<"PlatformAccessGrantId">();
export const platformAccessAuditIdContract = z.uuid().brand<"PlatformAccessAuditId">();
export const platformAccessCursorContract = z.string().min(1).max(500);
export const platformAccessPageLimitContract = z.int().min(1).max(100);
export const platformAccessStatusContract = z.enum([
  "PENDING_APPROVAL",
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
  "CLOSED",
]);

export const responsibilityContract = z.enum([
  "ACCESS_ADMINISTRATION",
  "ACCESS_AUDIT_REVIEW",
  "SELLER_APPLICATION_REVIEW",
  "PAYMENT_REVIEW",
  "PAYMENT_OUTCOME_CHANGE",
  "DISPUTE_REVIEW",
  "VIOLATION_REVIEW",
  "RELATED_BUYER_CONTEXT_REVEAL",
  "SENSITIVE_IDENTITY_BANKING_BROAD_VIEW",
  "HIGH_RISK_BULK_EXPORT",
]);

export const highRiskResponsibilityContract = z.enum([
  "ACCESS_ADMINISTRATION",
  "PAYMENT_OUTCOME_CHANGE",
  "SENSITIVE_IDENTITY_BANKING_BROAD_VIEW",
  "HIGH_RISK_BULK_EXPORT",
]);

const highRiskResponsibilities = new Set(
  highRiskResponsibilityContract.options as readonly string[],
);

export const responsibilityGrantControlModeContract = z.enum([
  "DIRECT",
  "DUAL_CONTROL",
  "SINGLE_MANAGER_EXCEPTION",
]);

export const platformAccessResourceTypeContract = z.enum([
  "SELLER_APPLICATION",
  "PAYMENT_REVIEW",
  "ORDER",
  "DISPUTE_CASE",
  "VIOLATION_CASE",
  "IDENTITY_VERIFICATION",
]);

export const platformAccessAllowedActionContract = z.enum([
  "READ_MASKED",
  "REVEAL_MINIMUM",
  "ADD_CASE_NOTE",
  "UPDATE_CASE_STATUS",
  "CONTAIN_INCIDENT",
  "REVOKE_ACCESS",
]);

export const platformAccessScopeContract = z
  .object({
    resourceType: platformAccessResourceTypeContract,
    resourceId: z.uuid(),
    allowedActions: z
      .array(platformAccessAllowedActionContract)
      .min(1)
      .max(6)
      .refine((actions) => new Set(actions).size === actions.length, {
        message: "allowed actions must be unique",
      }),
  })
  .strict();

export const platformAccessPurposeCodeContract = z.enum([
  "RESOLVE_ASSIGNED_CASE",
  "VERIFY_CASE_EVIDENCE",
  "CONTAIN_ACTIVE_INCIDENT",
]);

export const sensitiveAccessRequestModeContract = z.enum([
  "AGENT_REQUEST",
  "MANAGER_ASSIGNMENT",
]);
export const sensitiveAccessControlModeContract = z.enum([
  "REQUEST_APPROVAL",
  "DIRECT_ASSIGNMENT",
  "SINGLE_MANAGER_EXCEPTION",
]);

const internalReasonContract = z.string().trim().min(10).max(1_000);
const strongAuthenticationAtContract = timestampV1Contract;
const activeAccessManagerCountContract = z.int().min(1);

export const requestResponsibilityGrantCommandContract = z
  .object({
    requesterIdentityId: identityIdContract,
    recipientIdentityId: identityIdContract,
    responsibility: responsibilityContract,
    reason: internalReasonContract,
    activeAccessManagerCount: activeAccessManagerCountContract,
    controlMode: responsibilityGrantControlModeContract,
    strongAuthenticationAt: strongAuthenticationAtContract,
  })
  .strict()
  .superRefine((command, context) => {
    if (command.requesterIdentityId === command.recipientIdentityId) {
      context.addIssue({
        code: "custom",
        path: ["recipientIdentityId"],
        message: "self-grant is forbidden",
      });
    }

    const highRisk = highRiskResponsibilities.has(command.responsibility);
    const expectedMode = !highRisk
      ? "DIRECT"
      : command.activeAccessManagerCount === 1
        ? "SINGLE_MANAGER_EXCEPTION"
        : "DUAL_CONTROL";
    if (command.controlMode !== expectedMode) {
      context.addIssue({
        code: "custom",
        path: ["controlMode"],
        message: `control mode must be ${expectedMode}`,
      });
    }
  });

export const approveResponsibilityGrantCommandContract = z
  .object({
    grantId: platformAccessGrantIdContract,
    requesterIdentityId: identityIdContract,
    recipientIdentityId: identityIdContract,
    approverIdentityId: identityIdContract,
    responsibility: highRiskResponsibilityContract,
    activeAccessManagerCount: z.int().min(2),
    strongAuthenticationAt: strongAuthenticationAtContract,
  })
  .strict()
  .superRefine((command, context) => {
    if (
      command.approverIdentityId === command.requesterIdentityId ||
      command.approverIdentityId === command.recipientIdentityId
    ) {
      context.addIssue({
        code: "custom",
        path: ["approverIdentityId"],
        message: "approver must be distinct from requester and recipient",
      });
    }
  });

export const requestSensitiveAccessCommandContract = z
  .object({
    requesterIdentityId: identityIdContract,
    recipientIdentityId: identityIdContract,
    responsibility: responsibilityContract,
    purposeCode: platformAccessPurposeCodeContract,
    reason: internalReasonContract,
    scope: platformAccessScopeContract,
    ttlMinutes: z
      .int()
      .positive()
      .max(PLATFORM_ACCESS_MAX_TTL_MINUTES)
      .default(PLATFORM_ACCESS_DEFAULT_TTL_MINUTES),
    requestMode: sensitiveAccessRequestModeContract,
    activeAccessManagerCount: activeAccessManagerCountContract,
    controlMode: sensitiveAccessControlModeContract,
    strongAuthenticationAt: strongAuthenticationAtContract,
  })
  .strict()
  .superRefine((command, context) => {
    if (command.requestMode === "AGENT_REQUEST") {
      if (command.requesterIdentityId !== command.recipientIdentityId) {
        context.addIssue({
          code: "custom",
          path: ["recipientIdentityId"],
          message: "an agent request can only request access for its actor",
        });
      }
      if (command.controlMode !== "REQUEST_APPROVAL") {
        context.addIssue({
          code: "custom",
          path: ["controlMode"],
          message: "an agent request requires approval",
        });
      }
      return;
    }

    if (command.requesterIdentityId === command.recipientIdentityId) {
      context.addIssue({
        code: "custom",
        path: ["recipientIdentityId"],
        message: "a manager cannot assign sensitive access to itself",
      });
    }
    const expectedMode =
      command.activeAccessManagerCount === 1
        ? "SINGLE_MANAGER_EXCEPTION"
        : "DIRECT_ASSIGNMENT";
    if (command.controlMode !== expectedMode) {
      context.addIssue({
        code: "custom",
        path: ["controlMode"],
        message: `manager assignment requires ${expectedMode}`,
      });
    }
  });

export const approveSensitiveAccessCommandContract = z
  .object({
    grantId: platformAccessGrantIdContract,
    requesterIdentityId: identityIdContract,
    recipientIdentityId: identityIdContract,
    approverIdentityId: identityIdContract,
    activeAccessManagerCount: activeAccessManagerCountContract,
    strongAuthenticationAt: strongAuthenticationAtContract,
  })
  .strict()
  .superRefine((command, context) => {
    if (
      command.approverIdentityId === command.requesterIdentityId ||
      command.approverIdentityId === command.recipientIdentityId
    ) {
      context.addIssue({
        code: "custom",
        path: ["approverIdentityId"],
        message: "self-approval is forbidden",
      });
    }
  });

export const emergencyAccessControlModeContract = z.enum([
  "DUAL_CONTROL",
  "SINGLE_MANAGER_EXCEPTION",
]);

export const requestEmergencyAccessCommandContract = z
  .object({
    requesterIdentityId: identityIdContract,
    incidentId: z.string().trim().min(3).max(120),
    reason: internalReasonContract,
    scope: platformAccessScopeContract,
    ttlMinutes: z
      .int()
      .positive()
      .max(EMERGENCY_ACCESS_MAX_TTL_MINUTES)
      .default(EMERGENCY_ACCESS_MAX_TTL_MINUTES),
    activeAccessManagerCount: activeAccessManagerCountContract,
    controlMode: emergencyAccessControlModeContract,
    strongAuthenticationAt: strongAuthenticationAtContract,
  })
  .strict()
  .superRefine((command, context) => {
    const expectedMode =
      command.activeAccessManagerCount === 1
        ? "SINGLE_MANAGER_EXCEPTION"
        : "DUAL_CONTROL";
    if (command.controlMode !== expectedMode) {
      context.addIssue({
        code: "custom",
        path: ["controlMode"],
        message: `control mode must be ${expectedMode}`,
      });
    }
  });

export const approveEmergencyAccessCommandContract = z
  .object({
    grantId: platformAccessGrantIdContract,
    requesterIdentityId: identityIdContract,
    approverIdentityId: identityIdContract,
    activeAccessManagerCount: z.int().min(2),
    strongAuthenticationAt: strongAuthenticationAtContract,
  })
  .strict()
  .superRefine((command, context) => {
    if (command.approverIdentityId === command.requesterIdentityId) {
      context.addIssue({
        code: "custom",
        path: ["approverIdentityId"],
        message: "self-approval is forbidden",
      });
    }
  });

export const emergencyAccessActivationCommandContract = z
  .object({
    grantId: platformAccessGrantIdContract,
    requesterIdentityId: identityIdContract,
    activatorIdentityId: identityIdContract,
    approverIdentityId: identityIdContract.optional(),
    activeAccessManagerCount: activeAccessManagerCountContract,
    controlMode: emergencyAccessControlModeContract,
    strongAuthenticationAt: strongAuthenticationAtContract,
  })
  .strict()
  .superRefine((command, context) => {
    if (command.controlMode === "SINGLE_MANAGER_EXCEPTION") {
      if (
        command.activeAccessManagerCount !== 1 ||
        command.approverIdentityId !== undefined ||
        command.activatorIdentityId !== command.requesterIdentityId
      ) {
        context.addIssue({
          code: "custom",
          path: ["controlMode"],
          message: "single-manager activation cannot claim a second approval",
        });
      }
      return;
    }

    if (
      command.activeAccessManagerCount < 2 ||
      command.approverIdentityId === undefined ||
      command.approverIdentityId === command.requesterIdentityId
    ) {
      context.addIssue({
        code: "custom",
        path: ["approverIdentityId"],
        message: "dual-control activation requires an independent approval",
      });
    }
  });

export const revokePlatformAccessCommandContract = z
  .object({
    grantId: platformAccessGrantIdContract,
    actorIdentityId: identityIdContract,
    reason: internalReasonContract,
    expectedRevision: z.int().positive(),
  })
  .strict();

export const closeEmergencyAccessCommandContract = z
  .object({
    grantId: platformAccessGrantIdContract,
    actorIdentityId: identityIdContract,
    reason: internalReasonContract,
    expectedRevision: z.int().positive(),
  })
  .strict();

export const rejectPlatformAccessCommandContract = z
  .object({
    grantId: platformAccessGrantIdContract,
    requesterIdentityId: identityIdContract,
    recipientIdentityId: identityIdContract,
    reviewerIdentityId: identityIdContract,
    reason: internalReasonContract,
    expectedRevision: z.int().positive(),
  })
  .strict()
  .superRefine((command, context) => {
    if (
      command.reviewerIdentityId === command.requesterIdentityId ||
      command.reviewerIdentityId === command.recipientIdentityId
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewerIdentityId"],
        message: "a requester or recipient cannot reject its own request",
      });
    }
  });

export const emergencyAccessReviewModeContract = z.enum([
  "INDEPENDENT",
  "WITHOUT_INDEPENDENT_REVIEW",
]);
export const emergencyAccessReviewFindingContract = z.enum([
  "CONTROLS_FOLLOWED",
  "SCOPE_EXCEEDED",
  "AUDIT_INCOMPLETE",
  "FOLLOW_UP_REQUIRED",
]);

export const completeEmergencyAccessReviewCommandContract = z
  .object({
    grantId: platformAccessGrantIdContract,
    requesterIdentityId: identityIdContract,
    approverIdentityId: identityIdContract.nullable(),
    reviewerIdentityId: identityIdContract,
    reviewMode: emergencyAccessReviewModeContract,
    availableHumanReviewerCount: z.int().positive(),
    findingCode: emergencyAccessReviewFindingContract,
    reviewDueAt: timestampV1Contract,
    reviewedAt: timestampV1Contract,
    expectedRevision: z.int().positive(),
  })
  .strict()
  .superRefine((command, context) => {
    if (command.reviewMode === "WITHOUT_INDEPENDENT_REVIEW") {
      if (
        command.availableHumanReviewerCount !== 1 ||
        command.reviewerIdentityId !== command.requesterIdentityId ||
        command.approverIdentityId !== null
      ) {
        context.addIssue({
          code: "custom",
          path: ["reviewMode"],
          message: "self-review is only valid when one human reviewer exists",
        });
      }
      return;
    }

    if (
      command.reviewerIdentityId === command.requesterIdentityId ||
      command.reviewerIdentityId === command.approverIdentityId
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewerIdentityId"],
        message: "post-incident review must be independent",
      });
    }
  });

export const platformAccessListQueryContract = z
  .object({
    subjectIdentityId: identityIdContract.optional(),
    status: platformAccessStatusContract.optional(),
    cursor: platformAccessCursorContract.optional(),
    limit: platformAccessPageLimitContract.default(20),
  })
  .strict();

export const platformAccessAuditQueryContract = z
  .object({
    grantId: platformAccessGrantIdContract.optional(),
    actorIdentityId: identityIdContract.optional(),
    cursor: platformAccessCursorContract.optional(),
    limit: platformAccessPageLimitContract.default(50),
  })
  .strict();

export const platformAccessAuditActionContract = z.enum([
  "GRANT_REQUESTED",
  "GRANT_APPROVED",
  "GRANT_ACTIVATED",
  "GRANT_REJECTED",
  "GRANT_REVOKED",
  "GRANT_EXPIRED",
  "EMERGENCY_ACCESS_CLOSED",
  "SENSITIVE_FIELD_REVEALED",
  "SENSITIVE_CHANGE_ATTEMPTED",
  "POST_INCIDENT_REVIEW_COMPLETED",
]);

export const platformAccessAuditReasonCodeContract = z.enum([
  "RESPONSIBILITY_GRANTED",
  "CASE_ASSIGNED",
  "CASE_ACCESS_REQUESTED",
  "CASE_ACCESS_APPROVED",
  "ACCESS_REQUEST_REJECTED",
  "OPERATIONAL_NEED_ENDED",
  "ACCESS_REVOKED_FOR_SAFETY",
  "TTL_EXPIRED",
  "INCIDENT_CONTAINMENT",
  "POST_INCIDENT_REVIEW",
]);

export const platformAccessAuditEntryContract = z
  .object({
    auditId: platformAccessAuditIdContract,
    grantId: platformAccessGrantIdContract,
    action: platformAccessAuditActionContract,
    actorIdentityId: identityIdContract,
    subjectIdentityId: identityIdContract,
    scope: platformAccessScopeContract.optional(),
    reasonCode: platformAccessAuditReasonCodeContract,
    outcome: z.enum(["SUCCEEDED", "DENIED", "STOPPED_AFTER_REVOCATION"]),
    singleManagerException: z.boolean(),
    correlationId: z.uuid(),
    occurredAt: timestampV1Contract,
  })
  .strict();

const responsibilityGrantEventPayloadContract = z
  .object({
    grantKind: z.literal("RESPONSIBILITY"),
    grantId: platformAccessGrantIdContract,
    subjectIdentityId: identityIdContract,
    responsibility: responsibilityContract,
    status: z.enum(["PENDING_APPROVAL", "ACTIVE", "REVOKED"]),
    singleManagerException: z.boolean(),
    auditRequired: z.literal(true),
  })
  .strict();

const timeBoundGrantEventPayloadContract = z
  .object({
    grantKind: z.enum(["SENSITIVE_ACCESS", "EMERGENCY_ACCESS"]),
    grantId: platformAccessGrantIdContract,
    subjectIdentityId: identityIdContract,
    status: z.enum(["PENDING_APPROVAL", "ACTIVE", "EXPIRED", "REVOKED", "CLOSED"]),
    scope: platformAccessScopeContract,
    expiresAt: timestampV1Contract,
    singleManagerException: z.boolean(),
    auditRequired: z.literal(true),
  })
  .strict();

const platformAccessEventActorContract = z.union([
  z.object({ type: z.literal("IDENTITY"), id: identityIdContract }).strict(),
  z.object({ type: z.literal("SYSTEM") }).strict(),
]);

function responsibilityAccessEventContract<
  const EventType extends string,
  const Status extends "PENDING_APPROVAL" | "ACTIVE" | "REVOKED",
>(eventType: EventType, status: Status) {
  return eventEnvelopeV1Contract
    .extend({
      eventType: z.literal(eventType),
      actor: platformAccessEventActorContract,
      payload: responsibilityGrantEventPayloadContract.extend({
        status: z.literal(status),
      }),
    })
    .strict();
}

function timeBoundAccessEventContract<
  const EventType extends string,
  const GrantKind extends "SENSITIVE_ACCESS" | "EMERGENCY_ACCESS",
  const Status extends "PENDING_APPROVAL" | "ACTIVE" | "EXPIRED" | "REVOKED" | "CLOSED",
>(eventType: EventType, grantKind: GrantKind, status: Status) {
  return eventEnvelopeV1Contract
    .extend({
      eventType: z.literal(eventType),
      actor: platformAccessEventActorContract,
      payload: timeBoundGrantEventPayloadContract.extend({
        grantKind: z.literal(grantKind),
        status: z.literal(status),
      }),
    })
    .strict();
}

export const platformPermissionGrantRequestedV1Contract =
  responsibilityAccessEventContract(
    "PlatformPermissionGrantRequested.v1",
    "PENDING_APPROVAL",
  );
export const platformPermissionGrantedV1Contract = responsibilityAccessEventContract(
  "PlatformPermissionGranted.v1",
  "ACTIVE",
);
export const platformPermissionRevokedV1Contract = responsibilityAccessEventContract(
  "PlatformPermissionRevoked.v1",
  "REVOKED",
);
export const sensitiveAccessRequestedV1Contract = timeBoundAccessEventContract(
  "SensitiveAccessRequested.v1",
  "SENSITIVE_ACCESS",
  "PENDING_APPROVAL",
);
export const sensitiveAccessGrantedV1Contract = timeBoundAccessEventContract(
  "SensitiveAccessGranted.v1",
  "SENSITIVE_ACCESS",
  "ACTIVE",
);
export const sensitiveAccessRevokedV1Contract = timeBoundAccessEventContract(
  "SensitiveAccessRevoked.v1",
  "SENSITIVE_ACCESS",
  "REVOKED",
);
export const sensitiveAccessExpiredV1Contract = timeBoundAccessEventContract(
  "SensitiveAccessExpired.v1",
  "SENSITIVE_ACCESS",
  "EXPIRED",
);
export const emergencyAccessRequestedV1Contract = timeBoundAccessEventContract(
  "EmergencyAccessRequested.v1",
  "EMERGENCY_ACCESS",
  "PENDING_APPROVAL",
);
export const emergencyAccessActivatedV1Contract = timeBoundAccessEventContract(
  "EmergencyAccessActivated.v1",
  "EMERGENCY_ACCESS",
  "ACTIVE",
);
export const emergencyAccessRevokedV1Contract = timeBoundAccessEventContract(
  "EmergencyAccessRevoked.v1",
  "EMERGENCY_ACCESS",
  "REVOKED",
);
export const emergencyAccessExpiredV1Contract = timeBoundAccessEventContract(
  "EmergencyAccessExpired.v1",
  "EMERGENCY_ACCESS",
  "EXPIRED",
);
export const emergencyAccessClosedV1Contract = timeBoundAccessEventContract(
  "EmergencyAccessClosed.v1",
  "EMERGENCY_ACCESS",
  "CLOSED",
);

export const platformAccessEventContract = z.discriminatedUnion("eventType", [
  platformPermissionGrantRequestedV1Contract,
  platformPermissionGrantedV1Contract,
  platformPermissionRevokedV1Contract,
  sensitiveAccessRequestedV1Contract,
  sensitiveAccessGrantedV1Contract,
  sensitiveAccessRevokedV1Contract,
  sensitiveAccessExpiredV1Contract,
  emergencyAccessRequestedV1Contract,
  emergencyAccessActivatedV1Contract,
  emergencyAccessRevokedV1Contract,
  emergencyAccessExpiredV1Contract,
  emergencyAccessClosedV1Contract,
]);

export const platformAccessErrorContract = z
  .object({
    code: z.enum([
      "SELF_GRANT_FORBIDDEN",
      "SELF_APPROVAL_FORBIDDEN",
      "SECOND_MANAGER_REQUIRED",
      "SINGLE_MANAGER_EXCEPTION_REQUIRED",
      "RESPONSIBILITY_REQUIRED",
      "SENSITIVE_SCOPE_REQUIRED",
      "STRONG_AUTHENTICATION_REQUIRED",
      "STRONG_AUTHENTICATION_STALE",
      "ACCESS_GRANT_NOT_FOUND",
      "ACCESS_GRANT_REVISION_CONFLICT",
      "INVALID_ACCESS_TRANSITION",
      "ACCESS_ALREADY_REVOKED",
      "EMERGENCY_REVIEW_OVERDUE",
      "IDEMPOTENCY_CONFLICT",
      "IDEMPOTENCY_IN_PROGRESS",
    ]),
    message: z.string().min(1),
    correlationId: z.string().min(1),
  })
  .strict();

export const responsibilityGrantRequestInputContract = z
  .object({
    recipientIdentityId: identityIdContract,
    responsibility: responsibilityContract,
    reason: internalReasonContract,
  })
  .strict();

export const sensitiveAccessRequestInputContract = z
  .object({
    recipientIdentityId: identityIdContract.optional(),
    responsibility: responsibilityContract,
    purposeCode: platformAccessPurposeCodeContract,
    reason: internalReasonContract,
    scope: platformAccessScopeContract,
    ttlMinutes: z
      .int()
      .positive()
      .max(PLATFORM_ACCESS_MAX_TTL_MINUTES)
      .default(PLATFORM_ACCESS_DEFAULT_TTL_MINUTES),
  })
  .strict();

export const emergencyAccessRequestInputContract = z
  .object({
    incidentId: z.string().trim().min(3).max(120),
    reason: internalReasonContract,
    scope: platformAccessScopeContract,
    ttlMinutes: z
      .int()
      .positive()
      .max(EMERGENCY_ACCESS_MAX_TTL_MINUTES)
      .default(EMERGENCY_ACCESS_MAX_TTL_MINUTES),
  })
  .strict();

export const platformAccessApprovalInputContract = z
  .object({ expectedRevision: z.int().positive() })
  .strict();

export const platformAccessRevocationInputContract = z
  .object({
    expectedRevision: z.int().positive(),
    reason: internalReasonContract,
  })
  .strict();

export const emergencyAccessActivationInputContract = z
  .object({ expectedRevision: z.int().positive() })
  .strict();

export const emergencyAccessClosureInputContract = z
  .object({
    expectedRevision: z.int().positive(),
    reason: internalReasonContract,
  })
  .strict();

export const platformAccessRejectionInputContract = z
  .object({
    expectedRevision: z.int().positive(),
    reason: internalReasonContract,
  })
  .strict();

export const emergencyAccessReviewInputContract = z
  .object({
    expectedRevision: z.int().positive(),
    findingCode: emergencyAccessReviewFindingContract,
  })
  .strict();

const platformAccessGrantBaseShape = {
  grantId: platformAccessGrantIdContract,
  subjectIdentityId: identityIdContract,
  requestedByIdentityId: identityIdContract,
  approvedByIdentityId: identityIdContract.nullable(),
  revision: z.int().positive(),
  singleManagerException: z.boolean(),
  createdAt: timestampV1Contract,
  activatedAt: timestampV1Contract.nullable(),
  revokedAt: timestampV1Contract.nullable(),
} as const;

export const responsibilityGrantViewContract = z
  .object({
    ...platformAccessGrantBaseShape,
    grantKind: z.literal("RESPONSIBILITY"),
    status: z.enum(["PENDING_APPROVAL", "ACTIVE", "REVOKED"]),
    responsibility: responsibilityContract,
    expiresAt: z.null(),
  })
  .strict();

export const sensitiveAccessGrantViewContract = z
  .object({
    ...platformAccessGrantBaseShape,
    grantKind: z.literal("SENSITIVE_ACCESS"),
    status: z.enum(["PENDING_APPROVAL", "ACTIVE", "EXPIRED", "REVOKED"]),
    responsibility: responsibilityContract,
    purposeCode: platformAccessPurposeCodeContract,
    scope: platformAccessScopeContract,
    expiresAt: timestampV1Contract,
  })
  .strict();

export const emergencyAccessGrantViewContract = z
  .object({
    ...platformAccessGrantBaseShape,
    grantKind: z.literal("EMERGENCY_ACCESS"),
    status: z.enum(["PENDING_APPROVAL", "ACTIVE", "EXPIRED", "REVOKED", "CLOSED"]),
    incidentId: z.string().min(3).max(120),
    scope: platformAccessScopeContract,
    expiresAt: timestampV1Contract,
    reviewDueAt: timestampV1Contract,
    reviewStatus: z.enum([
      "NOT_DUE",
      "PENDING",
      "OVERDUE",
      "COMPLETED",
      "COMPLETED_WITHOUT_INDEPENDENT_REVIEW",
    ]),
  })
  .strict();

export const platformAccessGrantContract = z.discriminatedUnion("grantKind", [
  responsibilityGrantViewContract,
  sensitiveAccessGrantViewContract,
  emergencyAccessGrantViewContract,
]);

export const platformAccessGrantPageContract = z
  .object({
    items: z.array(platformAccessGrantContract),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const platformAccessAuditPageContract = z
  .object({
    items: z.array(platformAccessAuditEntryContract),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const platformAccessV1Schemas = {
  PlatformAccessGrantId: platformAccessGrantIdContract,
  PlatformAccessCursor: platformAccessCursorContract,
  PlatformAccessPageLimit: platformAccessPageLimitContract,
  PlatformAccessSubjectIdentityId: identityIdContract,
  PlatformAccessStatus: platformAccessStatusContract,
  Responsibility: responsibilityContract,
  PlatformAccessScope: platformAccessScopeContract,
  ResponsibilityGrantRequestInput: responsibilityGrantRequestInputContract,
  SensitiveAccessRequestInput: sensitiveAccessRequestInputContract,
  EmergencyAccessRequestInput: emergencyAccessRequestInputContract,
  PlatformAccessApprovalInput: platformAccessApprovalInputContract,
  PlatformAccessRevocationInput: platformAccessRevocationInputContract,
  EmergencyAccessActivationInput: emergencyAccessActivationInputContract,
  EmergencyAccessClosureInput: emergencyAccessClosureInputContract,
  PlatformAccessRejectionInput: platformAccessRejectionInputContract,
  EmergencyAccessReviewInput: emergencyAccessReviewInputContract,
  PlatformAccessGrant: platformAccessGrantContract,
  PlatformAccessGrantPage: platformAccessGrantPageContract,
  PlatformAccessAuditPage: platformAccessAuditPageContract,
  PlatformAccessError: platformAccessErrorContract,
} as const;

export const platformAccessV1Examples = {
  PlatformAccessGrantId: "44444444-4444-4444-8444-444444444444",
  PlatformAccessCursor: "eyJvY2N1cnJlZEF0IjoiMjAyNi0wOC0yNlQxMDowMDowMC4wMDBaIn0",
  PlatformAccessPageLimit: 20,
  PlatformAccessSubjectIdentityId: "11111111-1111-4111-8111-111111111111",
  PlatformAccessStatus: "ACTIVE",
  ResponsibilityGrantRequestInput: {
    recipientIdentityId: "22222222-2222-4222-8222-222222222222",
    responsibility: "PAYMENT_REVIEW",
    reason: "رسیدگی به صف بررسی نتیجه‌های پرداخت",
  },
  SensitiveAccessRequestInput: {
    responsibility: "PAYMENT_REVIEW",
    purposeCode: "RESOLVE_ASSIGNED_CASE",
    reason: "بررسی مغایرت نتیجه پرداخت همین پرونده",
    scope: {
      resourceType: "PAYMENT_REVIEW",
      resourceId: "55555555-5555-4555-8555-555555555555",
      allowedActions: ["READ_MASKED", "REVEAL_MINIMUM"],
    },
    ttlMinutes: PLATFORM_ACCESS_DEFAULT_TTL_MINUTES,
  },
  EmergencyAccessRequestInput: {
    incidentId: "INC-2026-0042",
    reason: "خطر مشخص برای صحت نتیجه‌های پرداخت",
    scope: {
      resourceType: "PAYMENT_REVIEW",
      resourceId: "55555555-5555-4555-8555-555555555555",
      allowedActions: ["READ_MASKED", "CONTAIN_INCIDENT"],
    },
    ttlMinutes: EMERGENCY_ACCESS_MAX_TTL_MINUTES,
  },
  PlatformAccessApprovalInput: { expectedRevision: 1 },
  PlatformAccessRevocationInput: {
    expectedRevision: 2,
    reason: "نیاز عملیاتی این دسترسی پایان یافته است",
  },
  EmergencyAccessActivationInput: { expectedRevision: 2 },
  EmergencyAccessClosureInput: {
    expectedRevision: 3,
    reason: "مهار حادثه تکمیل و نشست اضطراری بسته شد",
  },
  PlatformAccessRejectionInput: {
    expectedRevision: 1,
    reason: "درخواست با محدوده مجاز پرونده هم‌خوان نیست",
  },
  EmergencyAccessReviewInput: {
    expectedRevision: 4,
    findingCode: "CONTROLS_FOLLOWED",
  },
  PlatformAccessGrant: {
    grantKind: "SENSITIVE_ACCESS",
    grantId: "44444444-4444-4444-8444-444444444444",
    subjectIdentityId: "11111111-1111-4111-8111-111111111111",
    requestedByIdentityId: "11111111-1111-4111-8111-111111111111",
    approvedByIdentityId: "33333333-3333-4333-8333-333333333333",
    status: "ACTIVE",
    revision: 2,
    singleManagerException: false,
    createdAt: "2026-08-26T10:00:00.000Z",
    activatedAt: "2026-08-26T10:01:00.000Z",
    revokedAt: null,
    responsibility: "PAYMENT_REVIEW",
    purposeCode: "RESOLVE_ASSIGNED_CASE",
    scope: {
      resourceType: "PAYMENT_REVIEW",
      resourceId: "55555555-5555-4555-8555-555555555555",
      allowedActions: ["READ_MASKED", "REVEAL_MINIMUM"],
    },
    expiresAt: "2026-08-26T10:31:00.000Z",
  },
  PlatformAccessGrantPage: { items: [], nextCursor: null },
  PlatformAccessAuditPage: { items: [], nextCursor: null },
  PlatformAccessError: {
    code: "SELF_APPROVAL_FORBIDDEN",
    message: "تأییدکننده باید از درخواست‌کننده جدا باشد.",
    correlationId: "66666666-6666-4666-8666-666666666666",
  },
} as const;

export type Responsibility = z.infer<typeof responsibilityContract>;
export type PlatformAccessScope = z.infer<typeof platformAccessScopeContract>;
export type PlatformAccessAuditEntry = z.infer<typeof platformAccessAuditEntryContract>;
export type PlatformAccessEvent = z.infer<typeof platformAccessEventContract>;
export type PlatformAccessError = z.infer<typeof platformAccessErrorContract>;
export type PlatformAccessGrant = z.infer<typeof platformAccessGrantContract>;
