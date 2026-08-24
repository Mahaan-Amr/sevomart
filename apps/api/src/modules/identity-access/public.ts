import type {
  IranianMobile,
  OtpCode,
  IdentitySession,
  MySellerApplications,
  PlatformSellerApplicationListQuery,
  PlatformSellerApplicationPage,
  PlatformSellerApplicationView,
  ReadMySellerApplicationsQuery,
  RejectSellerApplication,
  RequestSellerApplicationInformation,
  ResubmitSellerApplication,
  SellerApplicationInput,
  SellerApplicationStatus,
  SellerApplicationView,
  WithdrawSellerApplication,
} from "@sevo/contracts/identity-access/v1";

export const IDENTITY_SESSION_READER = Symbol("IDENTITY_SESSION_READER");

export interface IdentitySessionReader {
  readActiveIdentitySession(token: string): Promise<IdentitySession | undefined>;
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
  permission: "SELLER_APPLICATION_REVIEW";
};

export interface PlatformAgentSessionAuthorizer {
  authorizeSellerApplicationReview(token: string): Promise<PlatformAgentActor>;
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
}
