import { readFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import postgres from "postgres";
import {
  idempotencyKeyContract,
  superadminGrantInputContract,
} from "@sevo/contracts/identity-access/v1";

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
  if (
    typeof raw.username !== "string" ||
    !/^[a-z][a-z0-9._-]{2,99}$/.test(raw.username) ||
    (raw.email != null && (typeof raw.email !== "string" || raw.email.length > 254)) ||
    typeof raw.password !== "string" ||
    raw.password.length < 12 ||
    raw.password.length > 128
  )
    throw new Error("Invalid input");
  const salt = randomBytes(16).toString("base64url");
  const key = scryptSync(raw.password, salt, 64, {
    N: 16384,
    r: 8,
    p: 5,
    maxmem: 64 * 1024 * 1024,
  }).toString("base64url");
  command = {
    ...grant,
    username: raw.username,
    email: raw.email ?? null,
    encoded: `scrypt$${salt}$${key}`,
    idempotencyKey: idempotencyKeyContract.parse(raw.idempotencyKey),
  };
} catch {
  process.stderr.write("Invalid recovery input.\n");
  process.exit(1);
}
const sql = postgres(databaseUrl, { max: 1 });
try {
  await sql`select public.identity_owner_recover_platform_password(${command.identityId}::uuid, ${command.username}, ${command.email}, ${command.encoded}, ${command.reason}, ${command.idempotencyKey}::uuid)`;
  process.stdout.write("Password recovery recorded.\n");
} catch {
  process.stderr.write("Password recovery could not be completed.\n");
  process.exitCode = 1;
} finally {
  await sql.end();
}
