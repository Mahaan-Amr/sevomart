import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import postgres, { type Sql } from "postgres";

export class TotpDeniedError extends Error {}
export class TotpUnavailableError extends Error {}

type Keyring = Record<string, string>;
type Session = { id: string; identityId: string; expiresAt: Date; createdAt: Date };
type Factor = {
  expiresAt: Date;
  keyId: string;
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
  lastCounter: string;
  failedAttempts: number;
  blockedUntil: Date | null;
};

export class PlatformAgentTotpService {
  readonly #sql: Sql;
  constructor(
    databaseUrl: string,
    private readonly activeKeyId: string | undefined,
    private readonly keys: Keyring,
  ) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }
  private key(id: string): Buffer {
    const value = this.keys[id];
    if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new TotpUnavailableError();
    const key = Buffer.from(value, "base64");
    if (key.length !== 32) throw new TotpUnavailableError();
    return key;
  }
  private async session(sql: Sql, token: string): Promise<Session> {
    if (!token) throw new TotpDeniedError();
    const rows = await sql<
      (Session & {
        expiresAt: Date;
        createdAt: Date;
        revokedAt: Date | null;
        status: string;
      })[]
    >`
      select s.id, s.identity_id as "identityId", s.expires_at as "expiresAt", s.created_at as "createdAt", s.revoked_at as "revokedAt", i.status
      from identity_sessions s join identity_identities i on i.id = s.identity_id
      where s.token_hash = ${createHash("sha256").update(token).digest("hex")} and s.audience = 'PLATFORM_AGENT'
      for update of s for share of i`;
    const session = rows[0];
    if (!session) throw new TotpDeniedError();
    const grants =
      await sql`select id from identity_platform_permission_grants where identity_id = ${session.identityId} and revoked_at is null for share`;
    const now = Date.now();
    if (
      !grants.length ||
      session.status !== "ACTIVE" ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      session.createdAt.getTime() > now + 5000 ||
      session.createdAt.getTime() <= now - 300000
    )
      throw new TotpDeniedError();
    return session;
  }
  private fresh(session: Session): boolean {
    const now = Date.now();
    return (
      session.expiresAt.getTime() > now &&
      session.createdAt.getTime() <= now + 5000 &&
      session.createdAt.getTime() > now - 300000
    );
  }
  async begin(token: string, correlationId: string) {
    if (!this.activeKeyId) throw new TotpUnavailableError();
    const key = this.key(this.activeKeyId);
    const keyId = this.activeKeyId;
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const session = await this.session(sql, token);
      const auth = await sql<
        { expiresAt: Date; consumedAt: Date | null }[]
      >`select expires_at as "expiresAt", consumed_at as "consumedAt" from identity_totp_bootstrap_authorizations
        where identity_id = ${session.identityId} for update`;
      if (
        !this.fresh(session) ||
        !auth[0] ||
        auth[0].consumedAt ||
        auth[0].expiresAt.getTime() <= Date.now()
      )
        throw new TotpDeniedError();
      const existing =
        await sql`select 1 from identity_totp_factors where identity_id = ${session.identityId}`;
      if (existing.length) throw new TotpDeniedError();
      const secret = randomBytes(20);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(session.identityId));
      const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
      await sql`insert into identity_totp_factors (identity_id, enrollment_session_id, key_id, ciphertext, nonce, tag, status, expires_at)
        values (${session.identityId}, ${session.id}, ${keyId}, ${ciphertext}, ${nonce}, ${cipher.getAuthTag()}, 'PENDING', clock_timestamp() + interval '10 minutes')`;
      await sql`update identity_totp_bootstrap_authorizations set consumed_at = clock_timestamp() where identity_id = ${session.identityId}`;
      await sql`insert into identity_totp_audit (id, identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${session.identityId}, 'ENROLLMENT_STARTED', 'SUCCEEDED', ${correlationId})`;
      return { secret: base32(secret) };
    });
  }
  async confirm(token: string, code: string, correlationId: string): Promise<void> {
    const result = await this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const session = await this.session(sql, token);
      const rows = await sql<
        Factor[]
      >`select expires_at as "expiresAt", key_id as "keyId", ciphertext, nonce, tag, last_counter as "lastCounter", failed_attempts as "failedAttempts", blocked_until as "blockedUntil"
        from identity_totp_factors where identity_id = ${session.identityId} and enrollment_session_id = ${session.id}
          and status = 'PENDING' for update`;
      const factor = rows[0];
      if (
        !this.fresh(session) ||
        !factor ||
        factor.expiresAt.getTime() <= Date.now() ||
        (factor.blockedUntil && factor.blockedUntil > new Date())
      )
        return false;
      let secret: Buffer;
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          this.key(factor.keyId),
          factor.nonce,
        );
        decipher.setAAD(Buffer.from(session.identityId));
        decipher.setAuthTag(factor.tag);
        secret = Buffer.concat([decipher.update(factor.ciphertext), decipher.final()]);
      } catch {
        throw new TotpUnavailableError();
      }
      const counter = matchCounter(secret, code, Number(factor.lastCounter));
      if (counter === null) {
        await sql`update identity_totp_factors set failed_attempts = failed_attempts + 1,
          blocked_until = case when failed_attempts + 1 >= 5 then clock_timestamp() + interval '10 minutes' else blocked_until end where identity_id = ${session.identityId}`;
        await sql`insert into identity_totp_audit (id, identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${session.identityId}, 'ENROLLMENT_CONFIRMED', 'REJECTED', ${correlationId})`;
        return false;
      }
      await sql`update identity_totp_factors set status = 'ACTIVE', activated_at = clock_timestamp(), last_counter = ${counter}, failed_attempts = 0 where identity_id = ${session.identityId}`;
      await sql`insert into identity_totp_audit (id, identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${session.identityId}, 'ENROLLMENT_CONFIRMED', 'SUCCEEDED', ${correlationId})`;
      return true;
    });
    if (!result) throw new TotpDeniedError();
  }
  async createProof(
    token: string,
    input: {
      code: string;
      action: "REVOKE_PUBLIC_SESSIONS";
      targetIdentityId: string;
      incidentId: string;
      reason: string;
    },
    correlationId: string,
  ) {
    const result = await this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const session = await this.session(sql, token);
      const permission = await sql<
        { id: string }[]
      >`select id from identity_platform_permission_grants where identity_id = ${session.identityId} and permission = 'SESSION_SECURITY' and revoked_at is null for share`;
      if (!permission.length) return null;
      const target =
        await sql`select id from identity_identities where id = ${input.targetIdentityId} and status = 'ACTIVE' for share`;
      if (!target.length) return null;
      const factors = await sql<
        Factor[]
      >`select expires_at as "expiresAt", key_id as "keyId", ciphertext, nonce, tag, last_counter as "lastCounter", failed_attempts as "failedAttempts", blocked_until as "blockedUntil"
        from identity_totp_factors where identity_id = ${session.identityId} and status = 'ACTIVE' for update`;
      const factor = factors[0];
      if (
        !this.fresh(session) ||
        !factor ||
        (factor.blockedUntil && factor.blockedUntil > new Date())
      )
        return null;
      let secret: Buffer;
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          this.key(factor.keyId),
          factor.nonce,
        );
        decipher.setAAD(Buffer.from(session.identityId));
        decipher.setAuthTag(factor.tag);
        secret = Buffer.concat([decipher.update(factor.ciphertext), decipher.final()]);
      } catch {
        throw new TotpUnavailableError();
      }
      const counter = matchCounter(secret, input.code, Number(factor.lastCounter));
      if (counter === null) {
        await sql`update identity_totp_factors set failed_attempts = failed_attempts + 1,
          blocked_until = case when failed_attempts + 1 >= 5 then clock_timestamp() + interval '10 minutes' else blocked_until end where identity_id = ${session.identityId}`;
        await sql`insert into identity_totp_audit (id, identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${session.identityId}, 'PROOF_CREATED', 'REJECTED', ${correlationId})`;
        return null;
      }
      const now = Date.now();
      if (!this.fresh(session)) return null;
      const expiresAt = new Date(
        Math.min(now + 300000, session.createdAt.getTime() + 300000),
      );
      const proof = randomBytes(32).toString("base64url");
      await sql`update identity_totp_factors set last_counter = ${counter}, failed_attempts = 0, blocked_until = null where identity_id = ${session.identityId}`;
      await sql`delete from identity_totp_action_proofs where actor_identity_id = ${session.identityId} and expires_at <= clock_timestamp()`;
      await sql`insert into identity_totp_action_proofs (id, token_hash, actor_identity_id, session_id, action, target_identity_id, payload_hash, created_at, expires_at, permission_grant_id)
        values (${randomUUID()}, ${createHash("sha256").update(proof).digest("hex")}, ${session.identityId}, ${session.id}, ${input.action}, ${input.targetIdentityId}, ${hashTotpAction(input)}, ${new Date(now)}, ${expiresAt}, ${permission[0]!.id})`;
      await sql`insert into identity_totp_audit (id, identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${session.identityId}, 'PROOF_CREATED', 'SUCCEEDED', ${correlationId})`;
      return { proof, expiresAt: expiresAt.toISOString() };
    });
    if (!result) throw new TotpDeniedError();
    return result;
  }
  async revokePublicSessions(
    token: string,
    input: {
      proof: string;
      targetIdentityId: string;
      incidentId: string;
      reason: string;
    },
    correlationId: string,
  ): Promise<void> {
    const result = await this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      await sql`select pg_advisory_xact_lock(hashtextextended(${input.targetIdentityId}, 273))`;
      const session = await this.session(sql, token);
      const permission = await sql<
        { id: string }[]
      >`select id from identity_platform_permission_grants where identity_id = ${session.identityId} and permission = 'SESSION_SECURITY' and revoked_at is null for share`;
      const proofs = await sql<
        {
          id: string;
          actorId: string;
          sessionId: string;
          targetId: string;
          action: string;
          payloadHash: string;
          expiresAt: Date;
          consumedAt: Date | null;
          grantId: string | null;
        }[]
      >`
        select id, actor_identity_id as "actorId", session_id as "sessionId", target_identity_id as "targetId", action, payload_hash as "payloadHash", expires_at as "expiresAt", consumed_at as "consumedAt", permission_grant_id as "grantId"
        from identity_totp_action_proofs where token_hash = ${createHash("sha256").update(input.proof).digest("hex")} for update`;
      const proof = proofs[0];
      const now = new Date();
      const valid =
        permission.length > 0 &&
        this.fresh(session) &&
        proof &&
        !proof.consumedAt &&
        proof.expiresAt > now &&
        proof.actorId === session.identityId &&
        proof.sessionId === session.id &&
        proof.grantId === permission[0]?.id &&
        proof.targetId === input.targetIdentityId &&
        proof.action === "REVOKE_PUBLIC_SESSIONS" &&
        proof.payloadHash ===
          hashTotpAction({ ...input, action: "REVOKE_PUBLIC_SESSIONS" });
      if (!valid) {
        await sql`insert into identity_session_security_audit (id, actor_identity_id, target_identity_id, action, incident_id, reason, revoked_count, outcome, correlation_id, occurred_at)
          values (${randomUUID()}, ${session.identityId}, ${input.targetIdentityId}, 'REVOKE_PUBLIC_SESSIONS', ${input.incidentId}, ${input.reason}, 0, 'REJECTED', ${correlationId}, ${now})`;
        return false;
      }
      const revoked = await sql<
        { id: string }[]
      >`update identity_sessions set revoked_at = ${now} where identity_id = ${input.targetIdentityId} and audience = 'PUBLIC' and revoked_at is null returning id`;
      await sql`update identity_totp_action_proofs set consumed_at = ${now} where id = ${proof.id}`;
      await sql`insert into identity_session_security_audit (id, actor_identity_id, target_identity_id, action, incident_id, reason, revoked_count, outcome, correlation_id, occurred_at)
        values (${randomUUID()}, ${session.identityId}, ${input.targetIdentityId}, 'REVOKE_PUBLIC_SESSIONS', ${input.incidentId}, ${input.reason}, ${revoked.length}, 'SUCCEEDED', ${correlationId}, ${now})`;
      return true;
    });
    if (!result) throw new TotpDeniedError();
  }
  async onModuleDestroy() {
    await this.#sql.end();
  }
}
function base32(bytes: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...bytes].map((byte) => byte.toString(2).padStart(8, "0")).join("");
  return (bits.match(/.{1,5}/g) ?? [])
    .map((part) => alphabet[parseInt(part.padEnd(5, "0"), 2)])
    .join("");
}
function matchCounter(
  secret: Buffer,
  code: string,
  lastCounter: number,
): number | null {
  const nowCounter = Math.floor(Date.now() / 30000);
  for (const counter of [nowCounter - 1, nowCounter, nowCounter + 1]) {
    if (counter <= lastCounter) continue;
    const input = Buffer.alloc(8);
    input.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac("sha1", secret).update(input).digest();
    const offset = digest[19]! & 15;
    const expected = String(
      (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000,
    ).padStart(6, "0");
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return counter;
  }
  return null;
}

export function hashTotpAction(input: {
  action: string;
  targetIdentityId: string;
  incidentId: string;
  reason: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.action,
        input.targetIdentityId,
        input.incidentId,
        input.reason,
      ]),
    )
    .digest("hex");
}
