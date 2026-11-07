import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

const args = process.argv.slice(2).filter((item) => item !== "--");
if (![4, 6].includes(args.length))
  throw new Error("Expected --first/--second or --renew, and --reason");
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (
    !["--first", "--second", "--renew", "--reason"].includes(args[i]) ||
    options.has(args[i])
  )
    throw new Error("Invalid option");
  options.set(args[i], args[i + 1]);
}
const renewal = options.get("--renew");
const first = options.get("--first");
const second = options.get("--second");
const reason = options.get("--reason")?.trim();
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!process.env.DATABASE_URL || !reason || reason.length < 5 || reason.length > 500)
  throw new Error("DATABASE_URL and a reason are required");
if (
  renewal
    ? !uuid.test(renewal) || first || second || args.length !== 4
    : !uuid.test(first ?? "") ||
      !uuid.test(second ?? "") ||
      first.toLowerCase() === second.toLowerCase() ||
      args.length !== 6
)
  throw new Error("Two distinct identities or one renewal identity are required");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('sevo-totp-bootstrap', 301))`;
    await tx`lock table identity_platform_permission_grants in share row exclusive mode`;
    await tx`lock table identity_totp_factors in share row exclusive mode`;
    const existing =
      await tx`select first_identity_id as "firstId", second_identity_id as "secondId" from identity_totp_bootstrap_run`;
    if (renewal) {
      const initial = existing[0];
      if (!initial || ![initial.firstId, initial.secondId].includes(renewal))
        throw new Error("Only an initial administrator can renew bootstrap");
      const identities =
        await tx`select i.id from identity_identities i join identity_platform_permission_grants g on g.identity_id = i.id and g.permission = 'ACCESS_ADMINISTRATION' and g.revoked_at is null where i.id = ${renewal} and i.status = 'ACTIVE' for share of i, g`;
      const activated =
        await tx`select id from identity_totp_audit where identity_id = ${renewal} and action = 'ENROLLMENT_CONFIRMED' and outcome = 'SUCCEEDED' limit 1`;
      const auth =
        await tx`select consumed_at as "consumedAt", expires_at as "expiresAt" from identity_totp_bootstrap_authorizations where identity_id = ${renewal} for update`;
      const factors =
        await tx`select status, expires_at as "expiresAt" from identity_totp_factors where identity_id = ${renewal} for update`;
      const now = Date.now();
      if (
        !identities.length ||
        activated.length ||
        !auth.length ||
        auth[0].expiresAt.getTime() > now ||
        (factors.length &&
          (factors[0].status !== "PENDING" || factors[0].expiresAt.getTime() > now))
      )
        throw new Error("Enrollment is active, still valid, or ineligible for renewal");
      await tx`delete from identity_totp_factors where identity_id = ${renewal} and status = 'PENDING'`;
      await tx`update identity_totp_bootstrap_authorizations set consumed_at = null, expires_at = clock_timestamp() + interval '1 hour' where identity_id = ${renewal}`;
      await tx`insert into identity_totp_audit (id, identity_id, action, outcome, reason, correlation_id) values (${randomUUID()}, ${renewal}, 'BOOTSTRAP_RENEWED', 'SUCCEEDED', ${reason}, ${randomUUID()})`;
      return;
    }
    if (existing.length)
      throw new Error("Initial TOTP bootstrap has already been used");
    const identities = await tx`select i.id from identity_identities i
      join identity_login_methods lm on lm.identity_id = i.id and lm.kind = 'MOBILE' and lm.verified_at is not null
      where i.id in (${first}, ${second}) and i.status = 'ACTIVE' for share of i, lm`;
    if (identities.length !== 2)
      throw new Error(
        "Both identities must be active and have verified mobile methods",
      );
    const otherAdmins =
      await tx`select identity_id from identity_platform_permission_grants
      where permission = 'ACCESS_ADMINISTRATION' and revoked_at is null and identity_id not in (${first}, ${second}) for share`;
    if (otherAdmins.length)
      throw new Error(
        "Existing administrators require a separate reviewed bootstrap process",
      );
    const factors = await tx`select identity_id from identity_totp_factors limit 1`;
    if (factors.length)
      throw new Error("Initial TOTP bootstrap requires no existing factors");
    const correlationId = randomUUID();
    const when = new Date();
    await tx`insert into identity_totp_bootstrap_run (first_identity_id, second_identity_id, reason, correlation_id, occurred_at)
      values (${first}, ${second}, ${reason}, ${correlationId}, ${when})`;
    for (const identityId of [first, second]) {
      const current =
        await tx`select id from identity_platform_permission_grants where identity_id = ${identityId}
        and permission = 'ACCESS_ADMINISTRATION' and revoked_at is null for share`;
      if (!current.length) {
        const grantId = randomUUID();
        const hash = createHash("sha256").update(randomUUID()).digest("hex");
        await tx`insert into identity_platform_permission_grants (id, identity_id, permission, granted_at)
          values (${grantId}, ${identityId}, 'ACCESS_ADMINISTRATION', ${when})`;
        await tx`insert into identity_platform_permission_audit (id, identity_id, permission, action, operation, actor_scope, actor_kind,
          reason, idempotency_key_hash, payload_hash, correlation_id, occurred_at)
          values (${randomUUID()}, ${identityId}, 'ACCESS_ADMINISTRATION', 'SYSTEM_BOOTSTRAP_GRANT', 'grant', 'SYSTEM', 'SYSTEM_BOOTSTRAP',
            ${reason}, ${hash}, ${hash}, ${correlationId}, ${when})`;
        await tx`insert into platform_outbox_events (event_id, envelope_version, event_type, aggregate_id, aggregate_version,
          occurred_at, correlation_id, actor_type, actor_id, payload)
          values (${randomUUID()}, 1, 'PlatformPermissionGranted.v1', ${grantId}, 1, ${when}, ${correlationId}, 'SYSTEM', null,
            ${tx.json({ permission: "ACCESS_ADMINISTRATION", actorKind: "SYSTEM_BOOTSTRAP" })})`;
      }
      await tx`insert into identity_totp_bootstrap_authorizations (identity_id, expires_at)
        values (${identityId}, clock_timestamp() + interval '1 hour')`;
      await tx`insert into identity_totp_audit (id, identity_id, action, outcome, reason, correlation_id)
        values (${randomUUID()}, ${identityId}, 'BOOTSTRAP_AUTHORIZED', 'SUCCEEDED', ${reason}, ${correlationId})`;
    }
  });
  process.stdout.write("Initial administrator enrollments authorized.\n");
} finally {
  await sql.end();
}
