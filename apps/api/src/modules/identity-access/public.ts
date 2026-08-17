import type {
  IranianMobile,
  OtpCode,
  SellerSession,
} from "@sevo/contracts/identity-access/v1";

export const SELLER_SESSION_READER = Symbol("SELLER_SESSION_READER");

export interface SellerSessionReader {
  readActiveSellerSession(token: string): Promise<SellerSession | undefined>;
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

export type SellerIdentity = {
  id: string;
  mobile: IranianMobile;
};

export type StoredSellerSession = {
  id: string;
  tokenHash: string;
  sellerId: string;
  expiresAt: Date;
};

export type ActiveSellerSession = {
  seller: SellerIdentity;
  expiresAt: Date;
};

export interface IdentityAccessRepository {
  saveChallenge(challenge: StoredOtpChallenge): Promise<void>;
  consumeValidChallenge(
    challengeId: string,
    codeHash: string,
    now: Date,
  ): Promise<IranianMobile | undefined>;
  findOrCreateSeller(mobile: IranianMobile): Promise<SellerIdentity>;
  saveSession(session: StoredSellerSession): Promise<void>;
  findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<ActiveSellerSession | undefined>;
}
