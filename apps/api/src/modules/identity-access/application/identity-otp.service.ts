import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import type {
  IranianMobile,
  IdentitySession,
  OtpChallenge,
  OtpChallengeId,
  OtpCode,
} from "@sevo/contracts/identity-access/v1";

import type { IdentityAccessRepository, OtpProvider } from "../public";

const DEV_OTP_CODE = "111111" as OtpCode;
const CHALLENGE_LIFETIME_MS = 10 * 60 * 1_000;
const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1_000;
const OTP_REQUEST_LIMIT = 20;
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export class OtpRejectedError extends Error {}
export class OtpRequestRateLimitedError extends Error {}
export class InvalidIdentitySessionError extends Error {}

export type VerifiedIdentitySession = {
  session: IdentitySession;
  token: string;
};

export class IdentityOtpService {
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
    const now = this.now();
    const challengeId = randomUUID() as OtpChallengeId;
    const expiresAt = new Date(now.getTime() + CHALLENGE_LIFETIME_MS);
    const code = this.createOtpCode();
    const canDeliver = !this.#allowedMobiles || this.#allowedMobiles.has(mobile);
    const verifiableCode = canDeliver ? code : randomBytes(32).toString("base64url");
    const accepted = await this.repository.saveChallengeIfAllowed(
      {
        id: challengeId,
        mobile,
        codeHash: hashChallengeCode(challengeId, verifiableCode),
        providerReference: "pending",
        expiresAt,
      },
      new Date(now.getTime() - OTP_REQUEST_WINDOW_MS),
      OTP_REQUEST_LIMIT,
    );
    if (!accepted) throw new OtpRequestRateLimitedError();

    const receipt = canDeliver
      ? await this.provider.deliverOtp({ mobile, code, expiresAt, correlationId })
      : { providerReference: "suppressed" };
    await this.repository.updateChallengeProviderReference(
      challengeId,
      receipt.providerReference,
    );

    return { challengeId, expiresAt: expiresAt.toISOString() };
  }

  async verifyOtp(
    challengeId: OtpChallengeId,
    code: OtpCode,
  ): Promise<VerifiedIdentitySession> {
    const mobile = await this.repository.consumeValidChallenge(
      challengeId,
      hashChallengeCode(challengeId, code),
      this.now(),
    );
    if (!mobile) {
      throw new OtpRejectedError();
    }

    const identity = await this.repository.findOrCreateIdentity(mobile);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + SESSION_LIFETIME_MS);
    await this.repository.saveSession({
      id: randomUUID(),
      tokenHash: hashToken(token),
      identityId: identity.id,
      audience: "PUBLIC",
      expiresAt,
    });

    return {
      token,
      session: {
        actor: { identityId: identity.id, audience: "PUBLIC" },
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  async readSession(token: string): Promise<IdentitySession> {
    const session = await this.readActiveIdentitySession(token);
    if (!session) throw new InvalidIdentitySessionError();
    return session;
  }

  async readActiveIdentitySession(token: string): Promise<IdentitySession | undefined> {
    const activeSession = await this.repository.findActiveSession(
      hashToken(token),
      this.now(),
    );
    if (!activeSession) return undefined;
    return {
      actor: { identityId: activeSession.identityId, audience: "PUBLIC" },
      expiresAt: activeSession.expiresAt.toISOString(),
    };
  }

  async readIdentitySession(token: string) {
    const result = await this.repository.findSession(hashToken(token), this.now());
    if (!result) return undefined;
    return {
      session: {
        actor: { identityId: result.identityId, audience: "PUBLIC" as const },
        expiresAt: result.expiresAt.toISOString(),
      },
      identityStatus: result.identityStatus,
    };
  }

  async revokeSession(token: string): Promise<boolean> {
    if (!token) return false;
    return this.repository.revokeSession(hashToken(token), this.now());
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
