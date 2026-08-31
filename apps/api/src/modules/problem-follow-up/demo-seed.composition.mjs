export async function convergeProblemFollowUpDemoState({ sql, manifest, baseline }) {
  const dispute = manifest.resources.find(({ kind }) => kind === "dispute");
  if (!dispute) return;
  const { id } = baseline.ids;
  await sql`
    insert into problem_disputes
      (id, order_id, buyer_identity_id, store_id, status, category, opened_at,
       deadline_kind, deadline_at, contributions, outcome, version, updated_at)
    values (${id(dispute.key)}, ${id(dispute.order)}, ${id("identity.buyer")},
      ${id("store.aban")}, ${dispute.status}, ${dispute.category},
      ${baseline.atDaysAgo(2)}, 'PLATFORM_REVIEW',
      ${new Date(baseline.now.getTime() + 2 * 86_400_000)},
      ${sql.json([
        {
          actor: "BUYER",
          text: "رنگ کالا با توضیح سفارش یکسان نبود.",
          evidence: ["demo-evidence-buyer"],
        },
        {
          actor: "SELLER",
          text: "تصویر بسته‌بندی و گونه ارسال‌شده پیوست شد.",
          evidence: ["demo-evidence-seller"],
        },
      ])}, null, 2, ${baseline.now})
    on conflict (id) do update set status = excluded.status,
      contributions = excluded.contributions, version = excluded.version,
      updated_at = excluded.updated_at
  `;
  await sql`
    insert into problem_dispute_audits
      (id, dispute_id, action, actor_kind, actor_identity_id, from_status,
       to_status, reason_code, evidence_count, correlation_id, occurred_at)
    values (${id(`${dispute.key}.audit`)}, ${id(dispute.key)}, 'REVIEW',
      'PLATFORM_AGENT', ${id("identity.reviewer")}, 'AWAITING_SELLER_RESPONSE',
      'UNDER_REVIEW', 'EVIDENCE_RECEIVED', 2, ${id(`${dispute.key}.correlation`)},
      ${baseline.atDaysAgo(1)})
    on conflict (id) do nothing
  `;
}

export async function retireProblemFollowUpDemoState({ sql, retired, now }) {
  for (const resource of retired.filter(({ key }) => key.startsWith("dispute."))) {
    await sql`
      update problem_disputes set status = 'CLOSED', version = version + 1,
        updated_at = ${now} where id = ${resource.id}
    `;
  }
}
