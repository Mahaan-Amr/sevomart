import postgres from "postgres";

export async function databaseIsReady(databaseUrl) {
  const sql = postgres(databaseUrl, { connect_timeout: 2, max: 1 });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
