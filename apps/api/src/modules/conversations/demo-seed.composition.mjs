export async function convergeConversationsDemoState({ sql, manifest, baseline }) {
  const { id, storeOwnerId } = baseline.ids;
  for (const conversation of manifest.resources.filter(
    ({ kind }) => kind === "conversation",
  )) {
    await sql`
      insert into conversation_threads
        (id, buyer_identity_id, seller_identity_id, store_id, context_kind,
         context_reference_id, context, version, created_at, updated_at)
      values (${id(conversation.key)}, ${id(conversation.buyer)},
        ${storeOwnerId(conversation.store)}, ${id(conversation.store)},
        ${conversation.contextKind}, ${id(conversation.context)},
        ${sql.json({ title: conversation.message })}, 1, ${baseline.atDaysAgo(2)},
        ${baseline.atDaysAgo(1)})
      on conflict (id) do update set context = excluded.context,
        version = conversation_threads.version + 1, updated_at = excluded.updated_at
      where conversation_threads.context is distinct from excluded.context
    `;
    await sql`
      insert into conversation_messages
        (id, conversation_id, sender_role, content, created_at)
      values (${id(`${conversation.key}.message`)}, ${id(conversation.key)}, 'BUYER',
        ${sql.json({ text: conversation.message, attachments: [] })},
        ${baseline.atDaysAgo(1)})
      on conflict (id) do nothing
    `;
  }
}

export async function retireConversationsDemoState({ sql, retired }) {
  for (const resource of retired.filter(({ key }) => key.startsWith("conversation."))) {
    await sql`delete from conversation_threads where id = ${resource.id}`;
  }
}
