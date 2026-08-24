import { createHash, randomUUID } from "node:crypto";

import postgres from "postgres";

const options = new Map();
const argumentsList = process.argv.slice(2).filter((argument) => argument !== "--");
for (let index = 0; index < argumentsList.length; index += 2) {
  options.set(argumentsList[index], argumentsList[index + 1]);
}

const identityId = options.get("--identity-id");
const reason = options.get("--reason");
const idempotencyKey = options.get("--idempotency-key");
const action = options.get("--action") ?? "grant";
const databaseUrl = process.env.DATABASE_URL;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!databaseUrl || !uuid.test(identityId ?? "") || !uuid.test(idempotencyKey ?? "")) {
  throw new Error(
    "DATABASE_URL, --identity-id <uuid>, --reason <text>, and --idempotency-key <uuid> are required",
  );
}
if (!reason || reason.trim().length < 5 || reason.length > 500) {
  throw new Error("--reason must contain 5 to 500 characters");
}
if (action !== "grant" && action !== "revoke") {
  throw new Error("--action must be grant or revoke");
}

const sql = postgres(databaseUrl, { max: 1 });
try {
  const outcome = await sql.begin(async (transaction) => {
    const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
    const payloadHash = createHash("sha256")
      .update(
        JSON.stringify({
          action,
          identityId,
          permission: "SELLER_APPLICATION_REVIEW",
          reason: reason.trim(),
        }),
      )
      .digest("hex");
    await transaction`select pg_advisory_xact_lock(hashtext(${keyHash}))`;
    const replay = await transaction`
      select payload_hash as "payloadHash" from identity_platform_permission_audit
      where operation = ${action} and actor_scope = 'SYSTEM'
        and idempotency_key_hash = ${keyHash}
    `;
    if (replay[0]) {
      if (replay[0].payloadHash !== payloadHash) {
        throw new Error("Idempotency key was already used for another payload");
      }
      return "already-applied";
    }

    const identities = await transaction`
      select i.id from identity_identities i
      join identity_login_methods lm on lm.identity_id = i.id
        and lm.kind = 'MOBILE' and lm.verified_at is not null
      where i.id = ${identityId} and i.status = 'ACTIVE'
      limit 1
    `;
    if (!identities[0])
      throw new Error("Active identity with verified mobile not found");
    const active = await transaction`
      select id from identity_platform_permission_grants
      where identity_id = ${identityId}
        and permission = 'SELLER_APPLICATION_REVIEW' and revoked_at is null
    `;
    const historical = await transaction`
      select id from identity_platform_permission_grants
      where identity_id = ${identityId}
        and permission = 'SELLER_APPLICATION_REVIEW'
      limit 1
    `;
    const correlationId = randomUUID();
    const occurredAt = new Date();
    const isNoop = action === "grant" ? Boolean(active[0]) : !active[0];
    const auditAction =
      action === "grant"
        ? isNoop
          ? "SYSTEM_BOOTSTRAP_GRANT_NOOP"
          : "SYSTEM_BOOTSTRAP_GRANT"
        : isNoop
          ? "SYSTEM_OPERATION_REVOKE_NOOP"
          : "SYSTEM_OPERATION_REVOKE";
    const actorKind =
      action === "grant" && !historical[0] ? "SYSTEM_BOOTSTRAP" : "SYSTEM_OPERATION";
    const grantId = active[0]?.id ?? randomUUID();
    if (!isNoop && action === "grant") {
      await transaction`
        insert into identity_platform_permission_grants
          (id, identity_id, permission, granted_at)
        values (${grantId}, ${identityId}, 'SELLER_APPLICATION_REVIEW', ${occurredAt})
      `;
    }
    if (!isNoop && action === "revoke") {
      await transaction`
        update identity_platform_permission_grants set revoked_at = ${occurredAt}
        where id = ${grantId} and revoked_at is null
      `;
    }
    await transaction`
      insert into identity_platform_permission_audit
        (id, identity_id, permission, action, operation, actor_scope, actor_kind,
         reason, idempotency_key_hash, payload_hash, correlation_id, occurred_at)
      values (${randomUUID()}, ${identityId}, 'SELLER_APPLICATION_REVIEW',
        ${auditAction}, ${action}, 'SYSTEM', ${actorKind}, ${reason.trim()},
        ${keyHash}, ${payloadHash}, ${correlationId}, ${occurredAt})
    `;
    if (!isNoop) {
      await transaction`
        insert into platform_outbox_events
          (event_id, envelope_version, event_type, aggregate_id, aggregate_version,
           occurred_at, correlation_id, actor_type, actor_id, payload)
        values (${randomUUID()}, 1,
          ${action === "grant" ? "PlatformPermissionGranted.v1" : "PlatformPermissionRevoked.v1"},
          ${grantId}, ${action === "grant" ? 1 : 2}, ${occurredAt}, ${correlationId},
          'SYSTEM', null, ${transaction.json({
            permission: "SELLER_APPLICATION_REVIEW",
            actorKind,
          })})
      `;
    }
    return isNoop ? `${action}-no-op` : action === "grant" ? "granted" : "revoked";
  });
  process.stdout.write(`${outcome}\n`);
} finally {
  await sql.end();
}
