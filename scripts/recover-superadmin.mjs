import { readFileSync } from "node:fs";
import postgres from "postgres";
import {
  idempotencyKeyContract,
  superadminGrantInputContract,
} from "@sevo/contracts/identity-access/v1";

// Provision a separate, owner-only recovery login before using this command.
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
  await sql`select public.identity_recover_superadmin(${command.identityId}::uuid, ${command.reason}, ${command.idempotencyKey}::uuid)`;
  process.stdout.write("Recovery recorded.\n");
} catch {
  process.stderr.write(
    "Recovery could not be completed. Check the active role and operational record.\n",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
