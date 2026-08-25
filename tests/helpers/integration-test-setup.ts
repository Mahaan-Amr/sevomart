import postgres from "postgres";
import { beforeEach } from "vitest";

import { apiTestEnvironment } from "./api-test-environment";

beforeEach(async () => {
  const sql = postgres(apiTestEnvironment.DATABASE_URL, { max: 1 });
  try {
    await sql`delete from identity_otp_challenges`;
  } finally {
    await sql.end();
  }
});
