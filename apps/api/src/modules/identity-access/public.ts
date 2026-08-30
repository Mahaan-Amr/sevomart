import type {
  ApproveSellerApplication,
  ApproveSellerApplicationResult,
  IranianMobile,
  OtpCode,
  IdentitySession,
  MySellerApplications,
  PlatformSellerApplicationListQuery,
  PlatformSellerApplicationPage,
  PlatformSellerApplicationView,
  PlatformAgentWorkspaceSession,
  ReadMySellerApplicationsQuery,
  RejectSellerApplication,
  RequestSellerApplicationInformation,
  ResubmitSellerApplication,
  SellerApplicationInput,
  SellerApplicationStatus,
  SellerApplicationView,
  WithdrawSellerApplication,
  PlatformAccessGrant,
  PlatformAccessRejection,
  PlatformAccessScope,
  SensitiveAccessAuthorizationReceipt,
  Responsibility,
} from "@sevo/contracts/identity-access/v1";
import type { IdentityId } from "@sevo/contracts/platform/v1";

export const IDENTITY_SESSION_READER = Symbol("IDENTITY_SESSION_READER");
export const SELLER_ACCESS_READ = Symbol("SELLER_ACCESS_READ");
export const PLATFORM_SENSITIVE_ACCESS = Symbol("PLATFORM_SENSITIVE_ACCESS");

export interface SellerAccessRead {
  isActiveSeller(identityId: IdentityId): Promise<boolean>;
}

export interface IdentitySessionReader {
  readActiveIdentitySession(token: string): Promise<IdentitySession | undefined>;
  readIdentitySession(token: string): Promise<
    | {
        session: IdentitySession;
        identityStatus: "ACTIVE" | "INACTIVE";
      }
    | undefined
  >;
}

export type OtpDelivery = {
  mobile: IranianMobile;
  code: OtpCode;
  expiresAt: Date;
  correlationId: string;
};

export type OtpDeliveryReceipt = {
  providerReference: string;
};

export interface OtpProvider {
  deliverOtp(delivery: OtpDelivery): Promise<OtpDeliveryReceipt>;
}

export type StoredOtpChallenge = {
  id: string;
  mobile: IranianMobile;
  codeHash: string;
  providerReference: string;
  expiresAt: Date;
};

export type SevoIdentity = {
  id: string;
};

export type StoredIdentitySession = {
  id: string;
  tokenHash: string;
  identityId: string;
  audience: "PUBLIC";
  expiresAt: Date;
};

export type ActiveIdentitySession = {
  identityId: string;
  expiresAt: Date;
};

export type IdentitySessionStatus = ActiveIdentitySession & {
  identityStatus: "ACTIVE" | "INACTIVE";
};

export interface IdentityAccessRepository {
  saveChallengeIfAllowed(
    challenge: StoredOtpChallenge,
    since: Date,
    limit: number,
  ): Promise<boolean>;
  updateChallengeProviderReference(
    challengeId: string,
    providerReference: string,
  ): Promise<void>;
  consumeValidChallenge(
    challengeId: string,
    codeHash: string,
    now: Date,
  ): Promise<IranianMobile | undefined>;
  findOrCreateIdentity(mobile: IranianMobile): Promise<SevoIdentity>;
  saveSession(session: StoredIdentitySession): Promise<void>;
  findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<ActiveIdentitySession | undefined>;
  findSession(tokenHash: string, now: Date): Promise<IdentitySessionStatus | undefined>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<boolean>;
}

export type SellerApplicationCommandContext = {
  identityId: string;
  correlationId: string;
  idempotencyKey: string;
};

export class SellerApplicationNotFoundError extends Error {}
export class ActiveSellerApplicationExistsError extends Error {}
export class SellerAccessExistsError extends Error {}
export class InvalidSellerApplicationTransitionError extends Error {}
export class SellerApplicationRevisionConflictError extends Error {}
export class SellerApplicationIdempotencyConflictError extends Error {}
export class SellerApplicationIdempotencyInProgressError extends Error {}
export class SellerApplicationCursorError extends Error {}
export class PlatformPermissionRequiredError extends Error {}
export class PlatformAccessError extends Error {
  constructor(
    readonly code:
      | "SELF_GRANT_FORBIDDEN"
      | "SELF_APPROVAL_FORBIDDEN"
      | "SECOND_MANAGER_REQUIRED"
      | "RESPONSIBILITY_REQUIRED"
      | "SENSITIVE_SCOPE_REQUIRED"
      | "EMERGENCY_SCOPE_REQUIRED"
      | "STRONG_AUTHENTICATION_REQUIRED"
      | "STRONG_AUTHENTICATION_STALE"
      | "ACCESS_GRANT_NOT_FOUND"
      | "ACCESS_GRANT_REVISION_CONFLICT"
      | "INVALID_ACCESS_TRANSITION"
      | "ACCESS_ALREADY_REVOKED"
      | "EMERGENCY_REVIEW_OVERDUE"
      | "IDEMPOTENCY_CONFLICT",
  ) {
    super(code);
  }
}
export class PlatformAgentSessionUnauthorizedError extends Error {}
export class SellerApplicationSelfReviewForbiddenError extends Error {
  constructor(
    readonly status: SellerApplicationStatus,
    readonly revision: number,
  ) {
    super("A platform agent cannot review their own seller application");
  }
}

export type PlatformAgentActor = {
  identityId: string;
  audience: "PLATFORM_AGENT";
  permission: "SELLER_APPLICATION_REVIEW" | "PAYMENT_REVIEW";
};

export interface PlatformAgentSessionAuthorizer {
  readWorkspaceSession(token: string): Promise<PlatformAgentWorkspaceSession>;
  revokeSession(token: string): Promise<boolean>;
  authorizeSellerApplicationReview(
    token: string,
  ): Promise<PlatformAgentActor & { permission: "SELLER_APPLICATION_REVIEW" }>;
  authorizePaymentReview(
    token: string,
  ): Promise<PlatformAgentActor & { permission: "PAYMENT_REVIEW" }>;
}

export type PlatformAccessCommandContext = {
  sessionToken: string;
  correlationId: string;
  idempotencyKey: string;
};

export type OpaquePlatformAccessTransactionContext = Readonly<{
  kind: "opaque-platform-access-transaction";
}>;

export type PlatformSensitiveAction = {
  grantId: string;
  actorIdentityId: string;
  responsibility: Responsibility;
  resourceType: PlatformAccessScope["resourceType"];
  resourceId: string;
  action: PlatformAccessScope["allowedActions"][number];
  reason: string;
  correlationId: string;
};

export type PlatformEmergencyAction = Omit<
  PlatformSensitiveAction,
  "responsibility"
> & {
  incidentId: string;
};

export interface PlatformSensitiveAccess {
  authorizeSensitiveAction(
    transaction: OpaquePlatformAccessTransactionContext,
    input: PlatformSensitiveAction,
  ): Promise<SensitiveAccessAuthorizationReceipt>;
  authorizeEmergencyAction(
    transaction: OpaquePlatformAccessTransactionContext,
    input: PlatformEmergencyAction,
  ): Promise<void>;
}

export interface PlatformAccessCore extends PlatformSensitiveAccess {
  requestResponsibility(
    context: PlatformAccessCommandContext,
    input: {
      recipientIdentityId: string;
      responsibility: Responsibility;
      reason: string;
    },
  ): Promise<PlatformAccessGrant>;
  approveResponsibility(
    context: PlatformAccessCommandContext,
    grantId: string,
    expectedRevision: number,
  ): Promise<PlatformAccessGrant>;
  revokeResponsibility(
    context: PlatformAccessCommandContext,
    grantId: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<PlatformAccessGrant>;
  requestSensitiveAccess(
    context: PlatformAccessCommandContext,
    input: {
      recipientIdentityId?: string;
      responsibility: Responsibility;
      purposeCode:
        "RESOLVE_ASSIGNED_CASE" | "VERIFY_CASE_EVIDENCE" | "CONTAIN_ACTIVE_INCIDENT";
      reason: string;
      scope: PlatformAccessScope;
      ttlMinutes: number;
    },
  ): Promise<PlatformAccessGrant>;
  approveSensitiveAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    expectedRevision: number,
  ): Promise<PlatformAccessGrant>;
  revokeSensitiveAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<PlatformAccessGrant>;
  requestEmergencyAccess(
    context: PlatformAccessCommandContext,
    input: {
      incidentId: string;
      reason: string;
      scope: PlatformAccessScope;
      ttlMinutes: number;
    },
  ): Promise<PlatformAccessGrant>;
  listEmergencyAccess(
    context: Omit<PlatformAccessCommandContext, "idempotencyKey">,
    query: {
      subjectIdentityId?: string;
      status?: "PENDING_APPROVAL" | "ACTIVE" | "EXPIRED" | "REVOKED" | "CLOSED";
      cursor?: string;
      limit: number;
    },
  ): Promise<{ items: PlatformAccessGrant[]; nextCursor: string | null }>;
  approveEmergencyAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    expectedRevision: number,
  ): Promise<PlatformAccessGrant>;
  activateEmergencyAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    expectedRevision: number,
  ): Promise<PlatformAccessGrant>;
  revokeEmergencyAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<PlatformAccessGrant>;
  closeEmergencyAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<PlatformAccessGrant>;
  rejectEmergencyAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<PlatformAccessRejection>;
  completeEmergencyAccessReview(
    context: PlatformAccessCommandContext,
    grantId: string,
    input: {
      expectedRevision: number;
      findingCode:
        | "CONTROLS_FOLLOWED"
        | "SCOPE_EXCEEDED"
        | "AUDIT_INCOMPLETE"
        | "FOLLOW_UP_REQUIRED";
    },
  ): Promise<PlatformAccessGrant>;
}

export type SellerApplicationReviewContext = SellerApplicationCommandContext & {
  audience: "PLATFORM_AGENT";
  permission: "SELLER_APPLICATION_REVIEW";
};

export interface SellerApplicationApplicant {
  submit(
    context: SellerApplicationCommandContext,
    input: SellerApplicationInput,
  ): Promise<SellerApplicationView>;
  readMine(
    identityId: string,
    query?: Partial<ReadMySellerApplicationsQuery>,
  ): Promise<MySellerApplications>;
  resubmit(
    context: SellerApplicationCommandContext,
    applicationId: string,
    input: ResubmitSellerApplication,
  ): Promise<SellerApplicationView>;
  withdraw(
    context: SellerApplicationCommandContext,
    applicationId: string,
    input: WithdrawSellerApplication,
  ): Promise<SellerApplicationView>;
}

export interface SellerApplicationReviewer {
  list(
    query?: Partial<PlatformSellerApplicationListQuery>,
  ): Promise<PlatformSellerApplicationPage>;
  read(
    context: Omit<SellerApplicationReviewContext, "idempotencyKey">,
    applicationId: string,
  ): Promise<PlatformSellerApplicationView>;
  requestInformation(
    context: SellerApplicationReviewContext,
    applicationId: string,
    input: RequestSellerApplicationInformation,
  ): Promise<PlatformSellerApplicationView>;
  reject(
    context: SellerApplicationReviewContext,
    applicationId: string,
    input: RejectSellerApplication,
  ): Promise<PlatformSellerApplicationView>;
  approve(
    context: SellerApplicationReviewContext,
    applicationId: string,
    input: ApproveSellerApplication,
  ): Promise<ApproveSellerApplicationResult>;
}

export interface SellerApprovalRecovery {
  nextPending(): Promise<string | null>;
  recover(recoveryId: string): Promise<void>;
}
