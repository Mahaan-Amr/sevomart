import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";

const args = process.argv.slice(2).filter((value) => value !== "--");
if (
  args.length !== 2 ||
  args[0] !== "--reason" ||
  !args[1] ||
  args[1].trim().length < 5 ||
  args[1].length > 500
)
  throw new Error("A reason of 5 to 500 characters is required");
const reason = args[1].trim();
const activeId = process.env.PLATFORM_TOTP_ACTIVE_KEY_ID;
let keys;
try {
  keys = JSON.parse(process.env.PLATFORM_TOTP_KEYRING ?? "{}");
} catch {
  throw new Error("Invalid TOTP keyring");
}
function key(id) {
  const value =
    keys && typeof keys === "object" && !Array.isArray(keys) ? keys[id] : undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new Error("Required TOTP key is unavailable");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32) throw new Error("Required TOTP key is unavailable");
  return bytes;
}
if (!process.env.DATABASE_URL || !activeId || activeId.length > 64)
  throw new Error("DATABASE_URL and active TOTP key ID are required");
const nextKey = key(activeId);
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const count = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('sevo-totp-key-rotation', 301))`;
    await tx`lock table identity_totp_factors in share row exclusive mode`;
    await tx`lock table identity_totp_recovery_enrollment in share row exclusive mode`;
    const factors =
      await tx`select identity_id as "identityId", key_id as "keyId", ciphertext, nonce, tag from identity_totp_factors order by identity_id for update`;
    const pending =
      await tx`select e.recovery_id as "recoveryId", r.requester_identity_id as "identityId", e.key_id as "keyId", e.ciphertext, e.nonce, e.tag from identity_totp_recovery_enrollment e join identity_totp_recoveries r on r.id = e.recovery_id order by e.recovery_id for update of e`;
    const correlationId = randomUUID();
    let rotated = 0;
    for (const row of [...factors, ...pending]) {
      let plain;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key(row.keyId), row.nonce);
        decipher.setAAD(Buffer.from(row.identityId));
        decipher.setAuthTag(row.tag);
        plain = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]);
      } catch {
        throw new Error("TOTP rotation could not authenticate an existing factor");
      }
      if (row.keyId === activeId) {
        plain.fill(0);
        continue;
      }
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", nextKey, nonce);
      cipher.setAAD(Buffer.from(row.identityId));
      const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
      const tag = cipher.getAuthTag();
      const verifier = createDecipheriv("aes-256-gcm", nextKey, nonce);
      verifier.setAAD(Buffer.from(row.identityId));
      verifier.setAuthTag(tag);
      const verified = Buffer.concat([verifier.update(ciphertext), verifier.final()]);
      if (!verified.equals(plain)) throw new Error("TOTP rotation verification failed");
      verified.fill(0);
      plain.fill(0);
      rotated++;
      if (row.recoveryId)
        await tx`update identity_totp_recovery_enrollment set key_id = ${activeId}, ciphertext = ${ciphertext}, nonce = ${nonce}, tag = ${tag} where recovery_id = ${row.recoveryId}`;
      else
        await tx`update identity_totp_factors set key_id = ${activeId}, ciphertext = ${ciphertext}, nonce = ${nonce}, tag = ${tag} where identity_id = ${row.identityId}`;
      await tx`insert into identity_totp_audit (id, identity_id, action, outcome, reason, correlation_id) values (${randomUUID()}, ${row.identityId}, 'KEY_ROTATED', 'SUCCEEDED', ${reason}, ${correlationId})`;
    }
    return rotated;
  });
  process.stdout.write(`Re-encrypted ${count} TOTP records.\n`);
} finally {
  await sql.end();
}
