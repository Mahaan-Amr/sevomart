import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import type {
  IranianMobile,
  OtpChallenge,
  OtpChallengeId,
  OtpCode,
  SellerSession,
} from "@sevo/contracts/identity-access/v1";

import type { IdentityAccessRepository, OtpProvider } from "../public";

const DEV_OTP_CODE = "111111" as OtpCode;
const CHALLENGE_LIFETIME_MS = 10 * 60 * 1_000;
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export class TestMobileNotAllowedError extends Error {}
export class OtpRejectedError extends Error {}
export class InvalidSellerSessionError extends Error {}

export type VerifiedSellerSession = {
  session: SellerSession;
  token: string;
};

export class SellerOtpService {
  readonly #allowedMobiles?: ReadonlySet<IranianMobile>;

  constructor(
    private readonly provider: OtpProvider,
    private readonly repository: IdentityAccessRepository,
    allowedMobiles: readonly IranianMobile[] | undefined,
    private readonly now: () => Date = () => new Date(),
    private readonly createOtpCode: () => OtpCode = () => DEV_OTP_CODE,
  ) {
    this.#allowedMobiles = allowedMobiles ? new Set(allowedMobiles) : undefined;
  }

  async requestOtp(
    mobile: IranianMobile,
    correlationId: string,
  ): Promise<OtpChallenge> {
    if (this.#allowedMobiles && !this.#allowedMobiles.has(mobile)) {
      throw new TestMobileNotAllowedError();
    }

    const challengeId = randomUUID() as OtpChallengeId;
    const expiresAt = new Date(this.now().getTime() + CHALLENGE_LIFETIME_MS);
    const code = this.createOtpCode();
    const receipt = await this.provider.deliverOtp({
      mobile,
      code,
      expiresAt,
      correlationId,
    });
    await this.repository.saveChallenge({
      id: challengeId,
      mobile,
      codeHash: hashChallengeCode(challengeId, code),
      providerReference: receipt.providerReference,
      expiresAt,
    });

    return { challengeId, expiresAt: expiresAt.toISOString() };
  }

  async verifyOtp(
    challengeId: OtpChallengeId,
    code: OtpCode,
  ): Promise<VerifiedSellerSession> {
    const mobile = await this.repository.consumeValidChallenge(
      challengeId,
      hashChallengeCode(challengeId, code),
      this.now(),
    );
    if (!mobile) {
      throw new OtpRejectedError();
    }

    const seller = await this.repository.findOrCreateSeller(mobile);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + SESSION_LIFETIME_MS);
    await this.repository.saveSession({
      id: randomUUID(),
      tokenHash: hashToken(token),
      sellerId: seller.id,
      expiresAt,
    });

    return {
      token,
      session: {
        seller,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  async readSession(token: string): Promise<SellerSession> {
    const activeSession = await this.repository.findActiveSession(
      hashToken(token),
      this.now(),
    );
    if (!activeSession) throw new InvalidSellerSessionError();
    return {
      seller: activeSession.seller,
      expiresAt: activeSession.expiresAt.toISOString(),
    };
  }
}

export function createProductionOtpCode(): OtpCode {
  let code: string;
  do {
    code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  } while (code === DEV_OTP_CODE);
  return code as OtpCode;
}

function hashChallengeCode(challengeId: string, code: string): string {
  return createHash("sha256").update(`${challengeId}:${code}`).digest("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
