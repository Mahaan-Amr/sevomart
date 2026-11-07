import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import {
  idempotencyKeyContract,
  superadminGrantInputContract,
} from "@sevo/contracts/identity-access/v1";

// This executable must be run only with the owner's separately provisioned, restricted
// recovery credential. It does not authenticate an operating-system user by itself.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write("Recovery database access is not configured.\n");
  process.exit(1);
}
let command;
try {
  const raw = JSON.parse(readFileSync(0, "utf8"));
  const grant = superadminGrantInputContract.parse({
    identityId: raw.identityId,
    reason: raw.reason,
  });
  command = {
    ...grant,
    idempotencyKey: idempotencyKeyContract.parse(raw.idempotencyKey),
  };
} catch {
  process.stderr.write("Invalid recovery input.\n");
  process.exit(1);
}
const sql = postgres(databaseUrl, { max: 1 });
try {
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ identityId: command.identityId, reason: command.reason }))
    .digest("hex");
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('identity_platform_superadmins'))`;
    const previous =
      await tx`select payload_hash from identity_platform_superadmin_recovery_idempotency where key = ${command.idempotencyKey}`;
    if (previous[0]) {
      if (previous[0].payload_hash !== payloadHash) throw new Error("conflict");
      return;
    }
    const active =
      await tx`select 1 from identity_platform_superadmins a join identity_identities i on i.id = a.identity_id and i.status = 'ACTIVE' where a.revoked_at is null limit 1`;
    if (active.length) throw new Error("active superadmin exists");
    const target =
      await tx`select id from identity_identities where id = ${command.identityId} and status = 'ACTIVE' for share`;
    if (!target.length) throw new Error("target unavailable");
    await tx`insert into identity_platform_superadmins (identity_id, granted_at, revoked_at) values (${command.identityId}, now(), null) on conflict (identity_id) do update set granted_at = now(), revoked_at = null`;
    await tx`insert into identity_platform_superadmin_audit (id, actor_identity_id, actor_kind, subject_identity_id, action, reason, correlation_id) values (${randomUUID()}, null, 'OWNER_RECOVERY', ${command.identityId}, 'RECOVERED', ${command.reason}, ${randomUUID()})`;
    await tx`insert into identity_platform_superadmin_recovery_idempotency (key, payload_hash, response) values (${command.idempotencyKey}, ${payloadHash}, ${tx.json({ status: "RECOVERED" })})`;
  });
  process.stdout.write("Recovery recorded.\n");
} catch {
  process.stderr.write(
    "Recovery could not be completed. Check the active role and operational record.\n",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
