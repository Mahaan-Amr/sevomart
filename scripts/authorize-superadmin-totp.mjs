import { readFileSync } from "node:fs";
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
  command = {
    ...superadminGrantInputContract.parse({
      identityId: raw.identityId,
      reason: raw.reason,
    }),
    idempotencyKey: idempotencyKeyContract.parse(raw.idempotencyKey),
  };
} catch {
  process.stderr.write("Invalid authorization input.\n");
  process.exit(1);
}
const sql = postgres(databaseUrl, { max: 1 });
try {
  await sql`select public.identity_authorize_superadmin_totp(${command.identityId}::uuid, ${command.reason}, ${command.idempotencyKey}::uuid)`;
  process.stdout.write("Enrollment authorization recorded.\n");
} catch {
  process.stderr.write("Enrollment authorization could not be completed.\n");
  process.exitCode = 1;
} finally {
  await sql.end();
}
