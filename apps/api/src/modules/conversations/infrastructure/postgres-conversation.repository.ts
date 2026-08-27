import { randomUUID } from "node:crypto";
import postgres, { type JSONValue, type Sql } from "postgres";
import { enqueueOutboxEvent } from "@sevo/outbox";
import {
  conversationMessageV1Contract,
  messageSentV1Contract,
  conversationThreadV1Contract,
} from "@sevo/contracts/conversations/v1";
import {
  ConversationFault,
  type ConversationMutation,
  type ConversationRepository,
  type ConversationSnapshot,
  type ConversationSnapshotEntry,
  type StoredConversation,
} from "../public";

export class PostgresConversationRepository implements ConversationRepository {
  readonly #sql: Sql;
  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }
  async onModuleDestroy() {
    await this.#sql.end();
  }
  async read(conversationId: string) {
    return this.readThread(this.#sql, conversationId);
  }
  private async readThread(sql: Sql, conversationId: string) {
    const rows = await sql<StoredConversation[]>`
      select id as "conversationId", buyer_identity_id as "buyerIdentityId", seller_identity_id as "sellerIdentityId", context, created_at as "createdAt", updated_at as "updatedAt", version
      from conversation_threads where id = ${conversationId}
    `;
    return rows[0];
  }
  async hasAttachment(conversationId: string, mediaId: string) {
    const rows = await this
      .#sql`select 1 from conversation_messages where conversation_id = ${conversationId} and content->>'type' = 'MEDIA' and content->>'mediaId' = ${mediaId} limit 1`;
    return rows.length > 0;
  }
  async audit(
    identityId: string | undefined,
    operation: string,
    outcome: string,
    correlationId: string,
    conversationId?: string,
  ) {
    await this
      .#sql`insert into conversation_audits (id, identity_id, conversation_id, operation, outcome, correlation_id) values (${randomUUID()}, ${identityId ?? null}, ${conversationId ?? null}, ${operation}, ${outcome}, ${correlationId})`;
  }
  async readMessage(conversationId: string, messageId: string) {
    const [row] = await this.#sql<
      {
        messageId: string;
        conversationId: string;
        senderRole: string;
        content: unknown;
        createdAt: Date;
      }[]
    >`select id as "messageId", conversation_id as "conversationId", sender_role as "senderRole", content, created_at as "createdAt" from conversation_messages where id = ${messageId} and conversation_id = ${conversationId}`;
    return row
      ? conversationMessageV1Contract.parse({
          ...row,
          version: 1,
          status: "SENT",
          createdAt: row.createdAt.toISOString(),
        })
      : undefined;
  }
  async snapshot(
    identityId: string,
    operation: "THREADS" | "MESSAGES",
    conversationId?: string,
  ): Promise<ConversationSnapshot> {
    const snapshotId = randomUUID(),
      expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
    await this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      await sql`delete from conversation_snapshots where expires_at <= now()`;
      await sql`insert into conversation_snapshots (id, identity_id, operation, conversation_id, expires_at) values (${snapshotId}, ${identityId}, ${operation}, ${conversationId ?? null}, ${expiresAt})`;
      if (operation === "THREADS") {
        await sql`insert into conversation_snapshot_entries (snapshot_id, item_id, sort_at) select ${snapshotId}, id, updated_at from conversation_threads where buyer_identity_id = ${identityId} or seller_identity_id = ${identityId}`;
      } else {
        await sql`insert into conversation_snapshot_entries (snapshot_id, item_id, sort_at) select ${snapshotId}, id, created_at from conversation_messages where conversation_id = ${conversationId ?? null}`;
      }
    });
    return { snapshotId, identityId, operation, conversationId, expiresAt };
  }
  async readSnapshot(snapshotId: string) {
    const [row] = await this.#sql<
      (Omit<ConversationSnapshot, "conversationId"> & {
        conversationId: string | null;
      })[]
    >`select id as "snapshotId", identity_id as "identityId", operation, conversation_id as "conversationId", expires_at as "expiresAt" from conversation_snapshots where id = ${snapshotId}`;
    return row
      ? { ...row, conversationId: row.conversationId ?? undefined }
      : undefined;
  }
  async entries(
    snapshotId: string,
    limit: number,
    after?: { lastAt: string; lastId: string },
  ) {
    return this.#sql<
      ConversationSnapshotEntry[]
    >`select item_id as "itemId", sort_at as "sortAt" from conversation_snapshot_entries where snapshot_id = ${snapshotId} ${after ? this.#sql`and (sort_at, item_id) < (${new Date(after.lastAt)}, ${after.lastId}::uuid)` : this.#sql``} order by sort_at desc, item_id desc limit ${limit}`;
  }
  async send(
    command: Parameters<ConversationRepository["send"]>[0],
    authorize: Parameters<ConversationRepository["send"]>[1],
    validateContent: () => Promise<void>,
  ) {
    const scope = `send:${command.identityId}:${command.conversationId}`;
    // External storage I/O must not hold a database transaction or thread lock.
    // Committed replays need live access, but do not depend on storage availability.
    if (!(await this.readIdempotency(this.#sql, scope, command.key))) {
      const thread = await this.read(command.conversationId);
      if (!thread) throw new ConversationFault("CONVERSATION_NOT_FOUND");
      await authorize(thread);
      await validateContent();
    }
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      await this.lockIdempotency(sql, scope, command.key);
      const [thread] = await sql<
        StoredConversation[]
      >`select id as "conversationId", buyer_identity_id as "buyerIdentityId", seller_identity_id as "sellerIdentityId", context, created_at as "createdAt", updated_at as "updatedAt", version from conversation_threads where id = ${command.conversationId} for update`;
      if (!thread) throw new ConversationFault("CONVERSATION_NOT_FOUND");
      const senderRole = await authorize(thread);
      const previous = await this.readIdempotency(sql, scope, command.key);
      if (previous)
        return conversationMessageV1Contract.parse(
          replayResponse(previous, command.requestHash),
        );
      const [updated] = await sql<
        { version: number; updatedAt: Date }[]
      >`update conversation_threads set version = version + 1, updated_at = greatest(clock_timestamp(), updated_at + interval '1 millisecond') where id = ${command.conversationId} returning version, updated_at as "updatedAt"`;
      if (!updated) throw new Error("Conversation update did not return a row");
      const response = conversationMessageV1Contract.parse({
        version: 1,
        messageId: randomUUID(),
        conversationId: command.conversationId,
        senderRole,
        content: command.content,
        status: "SENT",
        createdAt: updated.updatedAt.toISOString(),
      });
      await sql`insert into conversation_messages (id, conversation_id, sender_role, content, created_at) values (${response.messageId}, ${command.conversationId}, ${senderRole}, ${sql.json(command.content)}, ${updated.updatedAt})`;
      await this.storeIdempotency(sql, scope, command, response);
      await sql`insert into conversation_audits (id, identity_id, conversation_id, operation, outcome, correlation_id) values (${randomUUID()}, ${command.identityId}, ${command.conversationId}, 'SendMessage.v1', 'SUCCESS', ${command.correlationId})`;
      await enqueueOutboxEvent(
        sql,
        messageSentV1Contract.parse({
          version: 1,
          eventId: randomUUID(),
          eventType: "MessageSent.v1",
          aggregateId: command.conversationId,
          aggregateVersion: updated.version,
          occurredAt: response.createdAt,
          correlationId: command.correlationId,
          causationId: command.correlationId,
          actor: { type: "IDENTITY", id: command.identityId },
          payload: {
            conversationId: command.conversationId,
            messageId: response.messageId,
            contextKind: thread.context.kind,
            senderRole,
          },
        }),
      );
      return response;
    });
  }
  async open(
    command: Parameters<ConversationRepository["open"]>[0],
    resolveSeller: Parameters<ConversationRepository["open"]>[1],
  ) {
    const scope = `open:${command.identityId}`;
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      await this.lockIdempotency(sql, scope, command.key);
      const previous = await this.readIdempotency(sql, scope, command.key);
      if (previous) {
        const response = conversationThreadV1Contract.parse(previous.response);
        const thread = await this.readThread(sql, response.conversationId);
        if (!thread) throw new ConversationFault("CONVERSATION_NOT_FOUND");
        await resolveSeller(thread);
        return conversationThreadV1Contract.parse(
          replayResponse(previous, command.requestHash),
        );
      }
      const sellerIdentityId = await resolveSeller();
      const context = command.context;
      const referenceId =
        context.kind === "PRODUCT"
          ? context.productId
          : context.kind === "ORDER"
            ? context.orderId
            : context.storeId;
      const [row] = await sql<StoredConversation[]>`
        insert into conversation_threads (id, buyer_identity_id, seller_identity_id, store_id, context_kind, context_reference_id, context)
        values (${randomUUID()}, ${command.identityId}, ${sellerIdentityId}, ${context.storeId}, ${context.kind}, ${referenceId}, ${sql.json(context)})
        on conflict (buyer_identity_id, seller_identity_id, store_id, context_kind, context_reference_id) do update set id = conversation_threads.id
        returning id as "conversationId", context, created_at as "createdAt", updated_at as "updatedAt"
      `;
      if (!row) throw new Error("Conversation write did not return a row");
      const response = conversationThreadV1Contract.parse({
        version: 1,
        conversationId: row.conversationId,
        context: row.context,
        viewerRole: "BUYER",
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
      await this.storeIdempotency(sql, scope, command, response);
      await sql`insert into conversation_audits (id, identity_id, conversation_id, operation, outcome, correlation_id) values (${randomUUID()}, ${command.identityId}, ${row.conversationId}, 'OpenConversation.v1', 'SUCCESS', ${command.correlationId})`;
      return response;
    });
  }
  private async lockIdempotency(sql: Sql, scope: string, key: string) {
    const [lock] =
      await sql`select pg_try_advisory_xact_lock(hashtextextended(${scope + ":" + key}, 0)) as acquired`;
    if (!lock?.acquired) throw new ConversationFault("IDEMPOTENCY_IN_PROGRESS");
  }
  private async readIdempotency(sql: Sql, scope: string, key: string) {
    const [record] = await sql<
      IdempotencyRecord[]
    >`select request_hash as "requestHash", response from conversation_idempotency where scope = ${scope} and key = ${key}`;
    return record;
  }
  private async storeIdempotency(
    sql: Sql,
    scope: string,
    command: ConversationMutation,
    response: JSONValue,
  ) {
    await sql`insert into conversation_idempotency (scope, key, request_hash, response) values (${scope}, ${command.key}, ${command.requestHash}, ${sql.json(response)})`;
  }
}

type IdempotencyRecord = { requestHash: string; response: JSONValue };
function replayResponse(record: IdempotencyRecord, requestHash: string) {
  if (record.requestHash !== requestHash)
    throw new ConversationFault("IDEMPOTENCY_CONFLICT");
  return record.response;
}
