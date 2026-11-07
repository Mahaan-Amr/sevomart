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
export class TotpRateLimitedError extends Error {}

type Keyring = Record<string, string>;
type Session = { id: string; identityId: string; expiresAt: Date; createdAt: Date };
type Factor = {
  expiresAt: Date;
  generationId: string;
  enrollmentSuperadminGenerationId?: string | null;
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
  #cleanupTimer: ReturnType<typeof setInterval> | undefined;
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
    const role =
      await sql`select identity_id from identity_platform_superadmins where identity_id = ${session.identityId} and revoked_at is null for share`;
    const now = Date.now();
    if (
      (!grants.length && !role.length) ||
      session.status !== "ACTIVE" ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      session.createdAt.getTime() > now + 5000 ||
      session.createdAt.getTime() <= now - 300000
    )
      throw new TotpDeniedError();
    return session;
  }
  private async lockedSession(sql: Sql, token: string): Promise<Session> {
    if (!token) throw new TotpDeniedError();
    const rows = await sql<
      { identityId: string }[]
    >`select identity_id as "identityId" from identity_sessions where token_hash = ${createHash("sha256").update(token).digest("hex")} and audience = 'PLATFORM_AGENT'`;
    if (!rows[0]) throw new TotpDeniedError();
    await sql`select pg_advisory_xact_lock(hashtextextended(${rows[0].identityId}, 301))`;
    const session = await this.session(sql, token);
    if (session.identityId !== rows[0].identityId) throw new TotpDeniedError();
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
      const session = await this.lockedSession(sql, token);
      await sql`lock table identity_totp_factors in row exclusive mode`;
      const auth = await sql<
        { expiresAt: Date; consumedAt: Date | null; roleGenerationId: string | null }[]
      >`select expires_at as "expiresAt", consumed_at as "consumedAt", superadmin_generation_id as "roleGenerationId" from identity_totp_bootstrap_authorizations
        where identity_id = ${session.identityId} for update`;
      if (
        !this.fresh(session) ||
        !auth[0] ||
        auth[0].consumedAt ||
        auth[0].expiresAt.getTime() <= Date.now()
      )
        throw new TotpDeniedError();
      if (auth[0].roleGenerationId) {
        const role =
          await sql`select identity_id from identity_platform_superadmins where identity_id = ${session.identityId} and generation_id = ${auth[0].roleGenerationId} and revoked_at is null for share`;
        if (!role.length) throw new TotpDeniedError();
      } else {
        const grants =
          await sql`select id from identity_platform_permission_grants where identity_id = ${session.identityId} and revoked_at is null for share`;
        if (!grants.length) throw new TotpDeniedError();
      }
      const existing =
        await sql`select 1 from identity_totp_factors where identity_id = ${session.identityId}`;
      if (existing.length) throw new TotpDeniedError();
      const secret = randomBytes(20);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(session.identityId));
      const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
      await sql`insert into identity_totp_factors (identity_id, enrollment_session_id, key_id, ciphertext, nonce, tag, status, expires_at, enrollment_superadmin_generation_id)
        values (${session.identityId}, ${session.id}, ${keyId}, ${ciphertext}, ${nonce}, ${cipher.getAuthTag()}, 'PENDING', clock_timestamp() + interval '10 minutes', ${auth[0].roleGenerationId})`;
      await sql`update identity_totp_bootstrap_authorizations set consumed_at = clock_timestamp() where identity_id = ${session.identityId}`;
      await sql`insert into identity_totp_audit (id, identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${session.identityId}, 'ENROLLMENT_STARTED', 'SUCCEEDED', ${correlationId})`;
      if (!this.fresh(session) || auth[0].expiresAt.getTime() <= Date.now())
        throw new TotpDeniedError();
      return { secret: base32(secret) };
    });
  }
  async confirm(token: string, code: string, correlationId: string): Promise<void> {
    const result = await this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const session = await this.lockedSession(sql, token);
      await sql`lock table identity_totp_factors in row exclusive mode`;
      const rows = await sql<
        Factor[]
      >`select generation_id as "generationId", enrollment_superadmin_generation_id as "enrollmentSuperadminGenerationId", expires_at as "expiresAt", key_id as "keyId", ciphertext, nonce, tag, last_counter as "lastCounter", failed_attempts as "failedAttempts", blocked_until as "blockedUntil"
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
      if (factor.enrollmentSuperadminGenerationId) {
        const role =
          await sql`select identity_id from identity_platform_superadmins where identity_id = ${session.identityId} and generation_id = ${factor.enrollmentSuperadminGenerationId} and revoked_at is null for share`;
        if (!role.length) return false;
      }
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
      if (!this.fresh(session) || factor.expiresAt.getTime() <= Date.now())
        throw new TotpDeniedError();
      return true;
    });
    if (!result) throw new TotpDeniedError();
  }
  async recordProofAttempt(token: string, correlationId: string): Promise<void> {
    void this.cleanupExpired().catch(() => {});
    const allowed = await this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const session = await this.lockedSession(sql, token);
      const counts = await sql<
        { count: number }[]
      >`select count(*)::int as count from identity_totp_audit where identity_id = ${session.identityId} and action = 'PROOF_REQUESTED' and occurred_at > clock_timestamp() - interval '5 minutes'`;
      const allowed = (counts[0]?.count ?? 0) < 10;
      await sql`insert into identity_totp_audit (id, identity_id, action, outcome, correlation_id, occurred_at) values (${randomUUID()}, ${session.identityId}, 'PROOF_REQUESTED', ${allowed ? "ATTEMPT" : "RATE_LIMITED"}, ${correlationId}, clock_timestamp())`;
      return allowed;
    });
    if (!allowed) throw new TotpRateLimitedError();
  }
  async createProof(
    token: string,
    input: {
      code: string;
      action: "REVOKE_PUBLIC_SESSIONS" | "APPROVE_TOTP_RECOVERY";
      targetIdentityId: string;
      incidentId: string;
      reason: string;
    },
    correlationId: string,
  ) {
    const result = await this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const session = await this.lockedSession(sql, token);
      const requiredPermission =
        input.action === "APPROVE_TOTP_RECOVERY"
          ? "ACCESS_ADMINISTRATION"
          : "SESSION_SECURITY";
      const authority = await lockTotpAuthority(
        sql,
        session.identityId,
        requiredPermission,
      );
      if (!authority) return null;
      const target =
        await sql`select id from identity_identities where id = ${input.targetIdentityId} and status = 'ACTIVE' for share`;
      if (!target.length) return null;
      await sql`lock table identity_totp_factors in row exclusive mode`;
      await sql`lock table identity_totp_action_proofs in row exclusive mode`;
      const factors = await sql<
        Factor[]
      >`select generation_id as "generationId", expires_at as "expiresAt", key_id as "keyId", ciphertext, nonce, tag, last_counter as "lastCounter", failed_attempts as "failedAttempts", blocked_until as "blockedUntil"
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
      await sql`insert into identity_totp_action_proofs (id, token_hash, actor_identity_id, session_id, action, target_identity_id, payload_hash, created_at, expires_at, permission_grant_id, superadmin_generation_id, factor_generation_id)
        values (${randomUUID()}, ${createHash("sha256").update(proof).digest("hex")}, ${session.identityId}, ${session.id}, ${input.action}, ${input.targetIdentityId}, ${hashTotpAction(input)}, ${new Date(now)}, ${expiresAt}, ${authority.grantId}, ${authority.roleGenerationId}, ${factor.generationId})`;
      await sql`insert into identity_totp_audit (id, identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${session.identityId}, 'PROOF_CREATED', 'SUCCEEDED', ${correlationId})`;
      if (!this.fresh(session) || expiresAt.getTime() <= Date.now())
        throw new TotpDeniedError();
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
      const session = await this.lockedSession(sql, token);
      const authority = await lockTotpAuthority(
        sql,
        session.identityId,
        "SESSION_SECURITY",
      );
      const activeFactor = await sql<
        { generationId: string }[]
      >`select generation_id as "generationId" from identity_totp_factors where identity_id = ${session.identityId} and status = 'ACTIVE' for share`;
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
          roleGenerationId: string | null;
          factorGenerationId: string | null;
        }[]
      >`
        select id, actor_identity_id as "actorId", session_id as "sessionId", target_identity_id as "targetId", action, payload_hash as "payloadHash", expires_at as "expiresAt", consumed_at as "consumedAt", permission_grant_id as "grantId", superadmin_generation_id as "roleGenerationId", factor_generation_id as "factorGenerationId"
        from identity_totp_action_proofs where token_hash = ${createHash("sha256").update(input.proof).digest("hex")} for update`;
      const proof = proofs[0];
      // The identity lock excludes new PUBLIC sessions, but existing session reads
      // can hold row locks. Wait for them before sampling proof and session freshness.
      await sql`select id from identity_sessions where identity_id = ${input.targetIdentityId} and audience = 'PUBLIC' and revoked_at is null for update`;
      const now = new Date(Date.now());
      const valid =
        !!authority &&
        this.fresh(session) &&
        proof &&
        !proof.consumedAt &&
        proof.expiresAt > now &&
        proof.actorId === session.identityId &&
        proof.sessionId === session.id &&
        proof.grantId === authority.grantId &&
        proof.roleGenerationId === authority.roleGenerationId &&
        proof.factorGenerationId === activeFactor[0]?.generationId &&
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
      if (!this.fresh(session) || proof.expiresAt.getTime() <= Date.now())
        throw new TotpDeniedError();
      return true;
    });
    if (!result) throw new TotpDeniedError();
  }
  async requestRecovery(
    token: string,
    input: { incidentId: string; reason: string },
    correlationId: string,
  ) {
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const session = await this.lockedSession(sql, token);
      await sql`lock table identity_totp_recoveries in row exclusive mode`;
      await sql`select id from identity_totp_recoveries where requester_identity_id = ${session.identityId} and status in ('PENDING','APPROVED','ENROLLING') for update`;
      if (!this.fresh(session)) throw new TotpDeniedError();
      await sql`update identity_totp_recoveries set status = 'EXPIRED' where requester_identity_id = ${session.identityId} and status in ('PENDING','APPROVED','ENROLLING') and expires_at <= clock_timestamp()`;
      const open =
        await sql`select id from identity_totp_recoveries where requester_identity_id = ${session.identityId} and status in ('PENDING','APPROVED','ENROLLING')`;
      if (open.length) throw new TotpDeniedError();
      const id = randomUUID();
      await sql`insert into identity_totp_recoveries (id, requester_identity_id, incident_id, reason, status, expires_at) values (${id}, ${session.identityId}, ${input.incidentId}, ${input.reason}, 'PENDING', clock_timestamp() + interval '1 hour')`;
      await sql`insert into identity_totp_recovery_audit (id, recovery_id, actor_identity_id, requester_identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${id}, ${session.identityId}, ${session.identityId}, 'REQUESTED', 'SUCCEEDED', ${correlationId})`;
      if (!this.fresh(session)) throw new TotpDeniedError();
      return { recoveryId: id };
    });
  }
  async readRecovery(token: string, recoveryId: string) {
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const session = await this.lockedSession(sql, token);
      const rows = await sql<
        {
          requesterId: string;
          incidentId: string;
          reason: string;
          status: string;
          expiresAt: Date;
        }[]
      >`select requester_identity_id as "requesterId", incident_id as "incidentId", reason, status, expires_at as "expiresAt" from identity_totp_recoveries where id = ${recoveryId} for share`;
      const recovery = rows[0];
      if (!recovery) throw new TotpDeniedError();
      if (session.identityId !== recovery.requesterId) {
        const admin = await lockTotpAuthority(
          sql,
          session.identityId,
          "ACCESS_ADMINISTRATION",
        );
        if (!admin) throw new TotpDeniedError();
      }
      if (!this.fresh(session)) throw new TotpDeniedError();
      const counts = await sql<
        { count: number }[]
      >`select count(*)::int as count from identity_totp_recovery_approvals where recovery_id = ${recoveryId}`;
      return {
        recoveryId,
        targetIdentityId: recovery.requesterId,
        incidentId: recovery.incidentId,
        reason: recovery.reason,
        status: recovery.status,
        expiresAt: recovery.expiresAt.toISOString(),
        approvalCount: counts[0]?.count ?? 0,
      };
    });
  }
  async approveRecovery(
    token: string,
    recoveryId: string,
    proofToken: string,
    correlationId: string,
  ): Promise<void> {
    const result = await this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const session = await this.lockedSession(sql, token);
      const authority = await lockTotpAuthority(
        sql,
        session.identityId,
        "ACCESS_ADMINISTRATION",
      );
      const recoveries = await sql<
        { requesterId: string; reason: string; status: string; expiresAt: Date }[]
      >`select requester_identity_id as "requesterId", reason, status, expires_at as "expiresAt" from identity_totp_recoveries where id = ${recoveryId} for update`;
      const recovery = recoveries[0];
      const deny = async () => {
        if (recovery)
          await sql`insert into identity_totp_recovery_audit (id, recovery_id, actor_identity_id, requester_identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${recoveryId}, ${session.identityId}, ${recovery.requesterId}, 'APPROVED', 'REJECTED', ${correlationId})`;
        return false;
      };
      const activeFactor = await sql<
        { generationId: string }[]
      >`select generation_id as "generationId" from identity_totp_factors where identity_id = ${session.identityId} and status = 'ACTIVE' for share`;
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
          roleGenerationId: string | null;
          factorGenerationId: string | null;
        }[]
      >`select id, actor_identity_id as "actorId", session_id as "sessionId", target_identity_id as "targetId", action, payload_hash as "payloadHash", expires_at as "expiresAt", consumed_at as "consumedAt", permission_grant_id as "grantId", superadmin_generation_id as "roleGenerationId", factor_generation_id as "factorGenerationId" from identity_totp_action_proofs where token_hash = ${createHash("sha256").update(proofToken).digest("hex")} for update`;
      const proof = proofs[0];
      const now = Date.now();
      if (
        !authority ||
        !recovery ||
        recovery.requesterId === session.identityId ||
        recovery.status !== "PENDING" ||
        recovery.expiresAt.getTime() <= now ||
        !this.fresh(session) ||
        !proof ||
        proof.consumedAt ||
        proof.expiresAt.getTime() <= now ||
        proof.actorId !== session.identityId ||
        proof.sessionId !== session.id ||
        proof.targetId !== recovery.requesterId ||
        proof.action !== "APPROVE_TOTP_RECOVERY" ||
        proof.grantId !== authority.grantId ||
        proof.roleGenerationId !== authority.roleGenerationId ||
        !activeFactor.length ||
        proof.factorGenerationId !== activeFactor[0]!.generationId ||
        proof.payloadHash !==
          hashTotpAction({
            action: "APPROVE_TOTP_RECOVERY",
            targetIdentityId: recovery.requesterId,
            incidentId: recoveryId,
            reason: recovery.reason,
          })
      )
        return deny();
      await sql`lock table identity_totp_recovery_approvals in row exclusive mode`;
      const prior = await sql<
        {
          approverId: string;
          grantId: string | null;
          roleGenerationId: string | null;
          generationId: string | null;
        }[]
      >`select approver_identity_id as "approverId", permission_grant_id as "grantId", superadmin_generation_id as "roleGenerationId", factor_generation_id as "generationId" from identity_totp_recovery_approvals where recovery_id = ${recoveryId} for update`;
      if (prior.some((item) => item.approverId === session.identityId)) return deny();
      if (prior.length) {
        const valid = await validTotpApproval(sql, prior[0]!);
        if (
          !valid ||
          !this.fresh(session) ||
          proof.expiresAt.getTime() <= Date.now() ||
          recovery.expiresAt.getTime() <= Date.now()
        )
          return deny();
      }
      if (
        !this.fresh(session) ||
        proof.expiresAt.getTime() <= Date.now() ||
        recovery.expiresAt.getTime() <= Date.now()
      )
        return deny();
      await sql`insert into identity_totp_recovery_approvals (recovery_id, approver_identity_id, permission_grant_id, superadmin_generation_id, factor_generation_id, approved_at) values (${recoveryId}, ${session.identityId}, ${authority.grantId}, ${authority.roleGenerationId}, ${activeFactor[0]!.generationId}, clock_timestamp())`;
      await sql`update identity_totp_action_proofs set consumed_at = clock_timestamp() where id = ${proof.id}`;
      if (prior.length === 1)
        await sql`update identity_totp_recoveries set status = 'APPROVED' where id = ${recoveryId}`;
      await sql`insert into identity_totp_recovery_audit (id, recovery_id, actor_identity_id, requester_identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${recoveryId}, ${session.identityId}, ${recovery.requesterId}, 'APPROVED', 'SUCCEEDED', ${correlationId})`;
      if (
        !this.fresh(session) ||
        proof.expiresAt.getTime() <= Date.now() ||
        recovery.expiresAt.getTime() <= Date.now()
      )
        throw new TotpDeniedError();
      return true;
    });
    if (!result) throw new TotpDeniedError();
  }
  private async validRecoveryApprovals(
    sql: Sql,
    recoveryId: string,
    requesterId: string,
  ): Promise<boolean> {
    const rows = await sql<
      Array<{
        approverId: string;
        grantId: string | null;
        roleGenerationId: string | null;
        generationId: string | null;
      }>
    >`select approver_identity_id as "approverId", permission_grant_id as "grantId", superadmin_generation_id as "roleGenerationId", factor_generation_id as "generationId" from identity_totp_recovery_approvals where recovery_id = ${recoveryId} and approver_identity_id <> ${requesterId} for share`;
    if (rows.length !== 2 || rows[0]!.approverId === rows[1]!.approverId) return false;
    for (const row of rows) if (!(await validTotpApproval(sql, row))) return false;
    return true;
  }
  async beginRecovery(token: string, recoveryId: string, correlationId: string) {
    if (!this.activeKeyId) throw new TotpUnavailableError();
    const keyId = this.activeKeyId;
    const key = this.key(keyId);
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const session = await this.lockedSession(sql, token);
      await sql`lock table identity_totp_factors in row exclusive mode`;
      await sql`lock table identity_totp_recovery_enrollment in row exclusive mode`;
      const rows = await sql<
        { requesterId: string; status: string; expiresAt: Date }[]
      >`select requester_identity_id as "requesterId", status, expires_at as "expiresAt" from identity_totp_recoveries where id = ${recoveryId} for update`;
      const recovery = rows[0];
      await sql`select recovery_id from identity_totp_recovery_enrollment where recovery_id = ${recoveryId} for update`;
      if (
        !recovery ||
        recovery.requesterId !== session.identityId ||
        !["APPROVED", "ENROLLING"].includes(recovery.status) ||
        recovery.expiresAt.getTime() <= Date.now() ||
        !(await this.validRecoveryApprovals(sql, recoveryId, session.identityId)) ||
        !this.fresh(session) ||
        recovery.expiresAt.getTime() <= Date.now()
      )
        throw new TotpDeniedError();
      const secret = randomBytes(20);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(session.identityId));
      const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
      await sql`insert into identity_totp_recovery_enrollment (recovery_id, session_id, key_id, ciphertext, nonce, tag, expires_at) values (${recoveryId}, ${session.id}, ${keyId}, ${ciphertext}, ${nonce}, ${cipher.getAuthTag()}, clock_timestamp() + interval '10 minutes') on conflict (recovery_id) do update set session_id = excluded.session_id, key_id = excluded.key_id, ciphertext = excluded.ciphertext, nonce = excluded.nonce, tag = excluded.tag, expires_at = excluded.expires_at`;
      await sql`update identity_totp_recoveries set status = 'ENROLLING' where id = ${recoveryId}`;
      await sql`insert into identity_totp_recovery_audit (id, recovery_id, actor_identity_id, requester_identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${recoveryId}, ${session.identityId}, ${session.identityId}, 'ENROLLMENT_STARTED', 'SUCCEEDED', ${correlationId})`;
      if (!this.fresh(session) || recovery.expiresAt.getTime() <= Date.now())
        throw new TotpDeniedError();
      return { secret: base32(secret) };
    });
  }
  async confirmRecovery(
    token: string,
    recoveryId: string,
    code: string,
    correlationId: string,
  ): Promise<void> {
    const result = await this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const session = await this.lockedSession(sql, token);
      await sql`lock table identity_totp_factors in row exclusive mode`;
      await sql`lock table identity_totp_recovery_enrollment in row exclusive mode`;
      const recoveries = await sql<
        { requesterId: string; status: string; expiresAt: Date }[]
      >`select requester_identity_id as "requesterId", status, expires_at as "expiresAt" from identity_totp_recoveries where id = ${recoveryId} for update`;
      const recovery = recoveries[0];
      const pending = await sql<
        (Factor & { sessionId: string })[]
      >`select session_id as "sessionId", key_id as "keyId", ciphertext, nonce, tag, expires_at as "expiresAt", failed_attempts as "failedAttempts", blocked_until as "blockedUntil" from identity_totp_recovery_enrollment where recovery_id = ${recoveryId} for update`;
      const factor = pending[0];
      await sql`select identity_id from identity_totp_factors where identity_id = ${session.identityId} for update`;
      if (
        !recovery ||
        recovery.requesterId !== session.identityId ||
        recovery.status !== "ENROLLING" ||
        recovery.expiresAt.getTime() <= Date.now() ||
        !factor ||
        factor.sessionId !== session.id ||
        factor.expiresAt.getTime() <= Date.now() ||
        (factor.blockedUntil && factor.blockedUntil > new Date()) ||
        !(await this.validRecoveryApprovals(sql, recoveryId, session.identityId)) ||
        !this.fresh(session) ||
        recovery.expiresAt.getTime() <= Date.now() ||
        factor.expiresAt.getTime() <= Date.now()
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
      const counter = matchCounter(secret, code, -1);
      if (counter === null) {
        await sql`update identity_totp_recovery_enrollment set failed_attempts = failed_attempts + 1, blocked_until = case when failed_attempts + 1 >= 5 then clock_timestamp() + interval '10 minutes' else blocked_until end where recovery_id = ${recoveryId}`;
        await sql`insert into identity_totp_recovery_audit (id, recovery_id, actor_identity_id, requester_identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${recoveryId}, ${session.identityId}, ${session.identityId}, 'CONFIRMED', 'REJECTED', ${correlationId})`;
        return false;
      }
      await sql`insert into identity_totp_factors (identity_id, enrollment_session_id, key_id, ciphertext, nonce, tag, status, expires_at, last_counter, activated_at) values (${session.identityId}, ${session.id}, ${factor.keyId}, ${factor.ciphertext}, ${factor.nonce}, ${factor.tag}, 'ACTIVE', ${factor.expiresAt}, ${counter}, clock_timestamp()) on conflict (identity_id) do update set generation_id = gen_random_uuid(), enrollment_session_id = excluded.enrollment_session_id, key_id = excluded.key_id, ciphertext = excluded.ciphertext, nonce = excluded.nonce, tag = excluded.tag, status = 'ACTIVE', expires_at = excluded.expires_at, last_counter = excluded.last_counter, failed_attempts = 0, blocked_until = null, activated_at = excluded.activated_at`;
      await sql`update identity_totp_action_proofs set consumed_at = clock_timestamp() where actor_identity_id = ${session.identityId} and consumed_at is null`;
      await sql`update identity_otp_challenges set consumed_at = clock_timestamp() where audience = 'PLATFORM_AGENT' and consumed_at is null and mobile in (select mobile from identity_login_methods where identity_id = ${session.identityId} and kind = 'MOBILE')`;
      await sql`update identity_sessions set revoked_at = clock_timestamp() where identity_id = ${session.identityId} and audience = 'PLATFORM_AGENT' and id <> ${session.id} and revoked_at is null`;
      await sql`delete from identity_totp_recovery_enrollment where recovery_id = ${recoveryId}`;
      await sql`update identity_totp_recoveries set status = 'COMPLETED' where id = ${recoveryId}`;
      await sql`insert into identity_totp_recovery_audit (id, recovery_id, actor_identity_id, requester_identity_id, action, outcome, correlation_id) values (${randomUUID()}, ${recoveryId}, ${session.identityId}, ${session.identityId}, 'CONFIRMED', 'SUCCEEDED', ${correlationId})`;
      if (
        !this.fresh(session) ||
        recovery.expiresAt.getTime() <= Date.now() ||
        factor.expiresAt.getTime() <= Date.now()
      )
        throw new TotpDeniedError();
      return true;
    });
    if (!result) throw new TotpDeniedError();
  }
  onModuleInit() {
    const clean = () => {
      void this.cleanupExpired().catch(() => {
        /* Retry at the next interval without logging secret material. */
      });
    };
    this.#cleanupTimer = setInterval(clean, 5 * 60 * 1000);
    this.#cleanupTimer.unref();
  }
  private async cleanupExpired(): Promise<void> {
    await this
      .#sql`delete from identity_totp_action_proofs where id in (select id from identity_totp_action_proofs where expires_at <= clock_timestamp() for update skip locked)`;
    await this
      .#sql`delete from identity_totp_recovery_enrollment where recovery_id in (select recovery_id from identity_totp_recovery_enrollment where expires_at <= clock_timestamp() and (blocked_until is null or blocked_until <= clock_timestamp()) for update skip locked)`;
    await this
      .#sql`delete from identity_totp_factors where identity_id in (select identity_id from identity_totp_factors where status = 'PENDING' and expires_at <= clock_timestamp() and (blocked_until is null or blocked_until <= clock_timestamp()) for update skip locked)`;
    await this
      .#sql`update identity_totp_recoveries set status = 'EXPIRED' where id in (select id from identity_totp_recoveries where status in ('PENDING','APPROVED','ENROLLING') and expires_at <= clock_timestamp() for update skip locked)`;
  }
  async onModuleDestroy() {
    if (this.#cleanupTimer) clearInterval(this.#cleanupTimer);
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

async function lockTotpAuthority(
  sql: Sql,
  identityId: string,
  permission: string,
): Promise<{ grantId: string | null; roleGenerationId: string | null } | undefined> {
  const grants = await sql<
    Array<{ id: string }>
  >`select id from identity_platform_permission_grants where identity_id = ${identityId} and permission = ${permission} and revoked_at is null for share`;
  if (grants[0]) return { grantId: grants[0].id, roleGenerationId: null };
  const roles = await sql<
    Array<{ generationId: string }>
  >`select generation_id as "generationId" from identity_platform_superadmins where identity_id = ${identityId} and revoked_at is null for share`;
  if (roles[0]) return { grantId: null, roleGenerationId: roles[0].generationId };
  return undefined;
}

async function validTotpApproval(
  sql: Sql,
  input: {
    approverId: string;
    grantId: string | null;
    roleGenerationId: string | null;
    generationId: string | null;
  },
): Promise<boolean> {
  const identity =
    await sql`select i.id from identity_identities i join identity_totp_factors f on f.identity_id = i.id and f.status = 'ACTIVE' and f.generation_id = ${input.generationId} where i.id = ${input.approverId} and i.status = 'ACTIVE' for share of i, f`;
  if (!identity.length) return false;
  const authority = await lockTotpAuthority(
    sql,
    input.approverId,
    "ACCESS_ADMINISTRATION",
  );
  return (
    !!authority &&
    authority.grantId === input.grantId &&
    authority.roleGenerationId === input.roleGenerationId
  );
}
