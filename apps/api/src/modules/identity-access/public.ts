import type {
  IranianMobile,
  OtpCode,
  IdentitySession,
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
