import postgres, { type Sql } from "postgres";

// This seam is deliberately not scheduled in production. It accepts only simulated
// outcomes; a real provider and its operational policy require a separate decision.
export async function dispatchSellerApprovalNotification(
  databaseUrl: string,
  eventId: string,
  resolve: (sql: Sql, applicationId: string) => Promise<string | null>,
  sender: {
    send(
      mobile: string,
    ): Promise<"SIMULATED_ACCEPTED" | "SIMULATED_FAILED" | "UNKNOWN">;
  },
): Promise<void> {
  // Own connection guarantees the claim commits independently of any caller.
  // Explicit event ID deliberately prevents an automatic historical backlog drain.
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await sql<{ event_id: string; application_id: string }[]>`
      update notifications_seller_approval set state = 'UNKNOWN', updated_at = now()
      where event_id = ${eventId} and state = 'READY'
      returning event_id, application_id
    `;
    const row = rows[0];
    if (!row) return;
    try {
      const mobile = await resolve(sql, row.application_id);
      const state = mobile ? await sender.send(mobile) : "NO_RECIPIENT";
      await sql`update notifications_seller_approval set state = ${state}, updated_at = now()
        where event_id = ${row.event_id} and state = 'UNKNOWN'`;
    } catch {
      // Unknown is terminal for automatic dispatch, including crashes and timeouts.
    }
  } finally {
    await sql.end();
  }
}
