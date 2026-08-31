import { randomUUID } from "node:crypto";

import {
  DISPUTE_REOPEN_WINDOW_DAYS,
  buyerDisputeViewContract,
  disputeOpenedV1Contract,
  disputeReopenedV1Contract,
  disputeResolvedV1Contract,
  disputeRespondedV1Contract,
  platformDisputeQueueContract,
  platformDisputeViewContract,
  platformViolationCaseViewContract,
  platformViolationQueueContract,
  sellerDisputePageContract,
  sellerDisputeViewContract,
  violationRecordedV1Contract,
} from "@sevo/contracts/problem-follow-up/v1";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type JSONValue, type Sql } from "postgres";

import {
  ProblemFollowUpFault,
  type DisputeMutationCommand,
  type OpenDisputeCommand,
  type PageQuery,
  type ProblemFollowUpRepository,
  type ProblemFollowUpSensitiveAccess,
  type ReopenDisputeInput,
  type ResolveDisputeInput,
  type RespondToDisputeInput,
  type SensitiveCaseRead,
  type SensitiveDisputeMutation,
} from "../public";
import type { OpaquePlatformAccessTransactionContext } from "../../identity-access/public";

const REOPEN_WINDOW_MS = DISPUTE_REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1_000;

type DisputeStatus =
  "AWAITING_SELLER_RESPONSE" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";

type DisputeRow = {
  disputeId: string;
  orderId: string;
  buyerIdentityId: string;
  storeId: string;
  status: DisputeStatus;
  category: string;
  openedAt: Date;
  deadlineKind: "SELLER_FIRST_RESPONSE" | "PLATFORM_REVIEW" | "REOPEN_WINDOW" | null;
  deadlineAt: Date | null;
  contributions: JSONValue;
  outcome: JSONValue | null;
  version: number;
};

type IdempotencyRow = { requestHash: string; response: JSONValue };

export class PostgresProblemFollowUpRepository implements ProblemFollowUpRepository {
  readonly #sql: Sql;

  constructor(
    databaseUrl: string,
    private readonly sensitiveAccess: ProblemFollowUpSensitiveAccess,
    private readonly createAccessTransactionContext: (
      transaction: Sql,
    ) => OpaquePlatformAccessTransactionContext,
  ) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async onModuleDestroy() {
    await this.#sql.end();
  }

  async open(command: OpenDisputeCommand) {
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const replay = await claim(sql, "OPEN", command);
      if (replay) return buyerDisputeViewContract.parse(replay);
      const disputeId = randomUUID();
      const occurredAt = command.openedAt.toISOString();
      const contributions = contribution(
        "BUYER",
        command.input.description,
        command.input.evidenceIds,
        occurredAt,
      );
      try {
        await sql`
          insert into problem_disputes
            (id, order_id, buyer_identity_id, store_id, status, category,
             opened_at, deadline_kind, deadline_at, contributions, outcome,
             version, updated_at)
          values
            (${disputeId}, ${command.input.orderId}, ${command.actorId},
             ${command.storeId}, 'AWAITING_SELLER_RESPONSE',
             ${command.input.category}, ${command.openedAt}, 'SELLER_FIRST_RESPONSE',
             ${command.sellerResponseDeadline}, ${sql.json([contributions])}, null,
             1, ${command.openedAt})
        `;
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ProblemFollowUpFault("INVALID_TRANSITION");
        throw error;
      }
      await auditDispute(sql, {
        disputeId,
        action: "OPEN",
        actorKind: "BUYER",
        actorIdentityId: command.actorId,
        fromStatus: null,
        toStatus: "AWAITING_SELLER_RESPONSE",
        reasonCode: "BUYER_OPENED_CASE",
        evidenceCount: command.input.evidenceIds.length,
        occurredAt: command.openedAt,
        correlationId: command.correlationId,
      });
      await enqueueOutboxEvent(
        sql,
        requireEventActor(
          disputeOpenedV1Contract.parse({
            version: 1,
            eventId: randomUUID(),
            eventType: "DisputeOpened.v1",
            aggregateId: disputeId,
            aggregateVersion: 1,
            occurredAt,
            correlationId: command.correlationId,
            actor: { type: "IDENTITY", id: command.actorId },
            payload: {
              disputeId,
              orderId: command.input.orderId,
              storeId: command.storeId,
              category: command.input.category,
              status: "AWAITING_SELLER_RESPONSE",
              deadlineAt: command.sellerResponseDeadline.toISOString(),
            },
          }),
        ),
      );
      const view = relatedView({
        disputeId,
        orderId: command.input.orderId,
        buyerIdentityId: command.actorId,
        storeId: command.storeId,
        status: "AWAITING_SELLER_RESPONSE",
        category: command.input.category,
        openedAt: command.openedAt,
        deadlineKind: "SELLER_FIRST_RESPONSE",
        deadlineAt: command.sellerResponseDeadline,
        contributions: [contributions],
        outcome: null,
        version: 1,
      });
      await remember(sql, "OPEN", command, view);
      return buyerDisputeViewContract.parse(view);
    });
  }

  async readBuyer(actorId: string, disputeId: string) {
    const row = await readDispute(this.#sql, disputeId, { buyerIdentityId: actorId });
    if (!row) throw new ProblemFollowUpFault("NOT_FOUND");
    return buyerDisputeViewContract.parse(relatedView(row));
  }

  async listSeller(storeId: string, query: PageQuery) {
    const rows = await listDisputes(this.#sql, query, { storeId });
    return sellerDisputePageContract.parse(page(rows, query.limit, relatedView));
  }

  async readSeller(storeId: string, disputeId: string) {
    const row = await readDispute(this.#sql, disputeId, { storeId });
    if (!row) throw new ProblemFollowUpFault("NOT_FOUND");
    return sellerDisputeViewContract.parse(relatedView(row));
  }

  async respond(command: DisputeMutationCommand<RespondToDisputeInput>) {
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const replay = await claim(sql, "RESPOND", command);
      if (replay) return sellerDisputeViewContract.parse(replay);
      const row = await lockDispute(sql, command.disputeId);
      if (!row || row.storeId !== command.storeId) {
        throw new ProblemFollowUpFault("NOT_FOUND");
      }
      if (row.status !== "AWAITING_SELLER_RESPONSE") {
        throw new ProblemFollowUpFault("INVALID_TRANSITION");
      }
      if (!row.deadlineAt || command.occurredAt > row.deadlineAt) {
        throw new ProblemFollowUpFault("DEADLINE_PASSED");
      }
      const contributions = appendContribution(
        row,
        "SELLER",
        command.input.response,
        command.input.evidenceIds,
        command.occurredAt,
      );
      await updateDispute(sql, row, {
        status: "UNDER_REVIEW",
        deadlineKind: null,
        deadlineAt: null,
        contributions,
        outcome: row.outcome,
        occurredAt: command.occurredAt,
      });
      await auditDispute(sql, {
        disputeId: row.disputeId,
        action: "RESPOND",
        actorKind: "SELLER",
        actorIdentityId: command.actorId,
        fromStatus: row.status,
        toStatus: "UNDER_REVIEW",
        reasonCode: "SELLER_SUBMITTED_RESPONSE",
        evidenceCount: command.input.evidenceIds.length,
        occurredAt: command.occurredAt,
        correlationId: command.correlationId,
      });
      await enqueueOutboxEvent(
        sql,
        requireEventActor(
          disputeRespondedV1Contract.parse({
            ...eventEnvelope(row, command, "DisputeResponded.v1"),
            payload: {
              disputeId: row.disputeId,
              fromStatus: "AWAITING_SELLER_RESPONSE",
              toStatus: "UNDER_REVIEW",
              nextDeadlineAt: null,
              reasonCode: "SELLER_SUBMITTED_RESPONSE",
            },
          }),
        ),
      );
      const view = relatedView({
        ...row,
        status: "UNDER_REVIEW",
        deadlineKind: null,
        deadlineAt: null,
        contributions,
        version: row.version + 1,
      });
      await remember(sql, "RESPOND", command, view);
      return sellerDisputeViewContract.parse(view);
    });
  }

  async listPlatformDisputes(query: PageQuery) {
    const rows = await listDisputes(this.#sql, query);
    return platformDisputeQueueContract.parse(
      page(rows, query.limit, platformQueueItem),
    );
  }

  async readPlatformDispute(command: SensitiveCaseRead) {
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const access = await authorize(
        this.sensitiveAccess,
        this.createAccessTransactionContext(sql),
        command,
      );
      const row = await readDispute(sql, command.caseId);
      if (!row) throw new ProblemFollowUpFault("NOT_FOUND");
      return platformDisputeViewContract.parse({
        ...relatedView(row),
        access: { ...access, mode: "REVEALED_MINIMUM" },
      });
    });
  }

  async resolve(command: SensitiveDisputeMutation<ResolveDisputeInput>) {
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const access = await authorizeMutation(
        this.sensitiveAccess,
        this.createAccessTransactionContext(sql),
        command,
      );
      const replay = await claim(sql, "RESOLVE", command);
      if (replay) {
        return platformDisputeViewContract.parse({
          ...(replay as object),
          access: { ...access, mode: "REVEALED_MINIMUM" },
        });
      }
      const row = await lockDispute(sql, command.disputeId);
      if (!row) throw new ProblemFollowUpFault("NOT_FOUND");
      if (row.status !== "UNDER_REVIEW") {
        throw new ProblemFollowUpFault("INVALID_TRANSITION");
      }
      const deadlineAt = new Date(command.occurredAt.getTime() + REOPEN_WINDOW_MS);
      const contributions = appendContribution(
        row,
        "PLATFORM_AGENT",
        command.input.explanation,
        command.input.evidenceIds,
        command.occurredAt,
      );
      const outcome = {
        code: command.input.outcomeCode,
        explanation: command.input.explanation,
        decidedAt: command.occurredAt.toISOString(),
      };
      await updateDispute(sql, row, {
        status: command.input.status,
        deadlineKind: "REOPEN_WINDOW",
        deadlineAt,
        contributions,
        outcome,
        occurredAt: command.occurredAt,
      });
      const reasonCode =
        command.input.status === "RESOLVED"
          ? "PLATFORM_RESOLVED_CASE"
          : "PLATFORM_CLOSED_CASE";
      await auditDispute(sql, {
        disputeId: row.disputeId,
        action: "RESOLVE",
        actorKind: "PLATFORM_AGENT",
        actorIdentityId: command.actorId,
        fromStatus: row.status,
        toStatus: command.input.status,
        reasonCode,
        evidenceCount: command.input.evidenceIds.length,
        occurredAt: command.occurredAt,
        correlationId: command.correlationId,
      });
      await enqueueOutboxEvent(
        sql,
        requireEventActor(
          disputeResolvedV1Contract.parse({
            ...eventEnvelope(row, command, "DisputeResolved.v1"),
            payload: {
              disputeId: row.disputeId,
              fromStatus: "UNDER_REVIEW",
              toStatus: command.input.status,
              nextDeadlineAt: deadlineAt.toISOString(),
              reasonCode,
            },
          }),
        ),
      );
      if (command.input.outcomeCode === "VIOLATION_RECORDED") {
        await recordViolation(sql, row, command, contributions.at(-1)?.evidence ?? []);
      }
      const baseView = relatedView({
        ...row,
        status: command.input.status,
        deadlineKind: "REOPEN_WINDOW",
        deadlineAt,
        contributions,
        outcome,
        version: row.version + 1,
      });
      await remember(sql, "RESOLVE", command, baseView);
      return platformDisputeViewContract.parse({
        ...baseView,
        access: { ...access, mode: "REVEALED_MINIMUM" },
      });
    });
  }

  async reopen(command: SensitiveDisputeMutation<ReopenDisputeInput>) {
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const access = await authorizeMutation(
        this.sensitiveAccess,
        this.createAccessTransactionContext(sql),
        command,
      );
      const replay = await claim(sql, "REOPEN", command);
      if (replay) {
        return platformDisputeViewContract.parse({
          ...(replay as object),
          access: { ...access, mode: "REVEALED_MINIMUM" },
        });
      }
      const row = await lockDispute(sql, command.disputeId);
      if (!row) throw new ProblemFollowUpFault("NOT_FOUND");
      if (row.status !== "RESOLVED" && row.status !== "CLOSED") {
        throw new ProblemFollowUpFault("INVALID_TRANSITION");
      }
      if (!row.deadlineAt || command.occurredAt > row.deadlineAt) {
        throw new ProblemFollowUpFault("DEADLINE_PASSED");
      }
      const contributions = appendContribution(
        row,
        "PLATFORM_AGENT",
        command.input.reason,
        command.input.evidenceIds,
        command.occurredAt,
      );
      await updateDispute(sql, row, {
        status: "UNDER_REVIEW",
        deadlineKind: null,
        deadlineAt: null,
        contributions,
        outcome: null,
        occurredAt: command.occurredAt,
      });
      await auditDispute(sql, {
        disputeId: row.disputeId,
        action: "REOPEN",
        actorKind: "PLATFORM_AGENT",
        actorIdentityId: command.actorId,
        fromStatus: row.status,
        toStatus: "UNDER_REVIEW",
        reasonCode: "NEW_EVIDENCE_RECEIVED",
        evidenceCount: command.input.evidenceIds.length,
        occurredAt: command.occurredAt,
        correlationId: command.correlationId,
      });
      await enqueueOutboxEvent(
        sql,
        requireEventActor(
          disputeReopenedV1Contract.parse({
            ...eventEnvelope(row, command, "DisputeReopened.v1"),
            payload: {
              disputeId: row.disputeId,
              fromStatus: row.status,
              toStatus: "UNDER_REVIEW",
              nextDeadlineAt: null,
              reasonCode: "NEW_EVIDENCE_RECEIVED",
            },
          }),
        ),
      );
      const baseView = relatedView({
        ...row,
        status: "UNDER_REVIEW",
        deadlineKind: null,
        deadlineAt: null,
        contributions,
        outcome: null,
        version: row.version + 1,
      });
      await remember(sql, "REOPEN", command, baseView);
      return platformDisputeViewContract.parse({
        ...baseView,
        access: { ...access, mode: "REVEALED_MINIMUM" },
      });
    });
  }

  async listPlatformViolations(query: PageQuery) {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.#sql<Array<ViolationRow>>`
      select id as "violationCaseId", type, source_kind as "sourceKind",
        source_reference_id as "sourceReferenceId", status,
        opened_at as "openedAt", deadline_at as "deadlineAt",
        next_action_code as "nextActionCode", evidence,
        action_reason_codes as "actionReasonCodes"
      from problem_violation_cases
      where (${cursor?.occurredAt ?? null}::timestamptz is null or
        (opened_at, id) < (${cursor?.occurredAt ?? null}::timestamptz,
                           ${cursor?.id ?? null}::uuid))
      order by opened_at desc, id desc
      limit ${query.limit + 1}
    `;
    return platformViolationQueueContract.parse(
      page(rows, query.limit, violationQueueItem),
    );
  }

  async readPlatformViolation(command: SensitiveCaseRead) {
    return this.#sql.begin(async (transaction) => {
      const sql = transaction as unknown as Sql;
      const access = await authorize(
        this.sensitiveAccess,
        this.createAccessTransactionContext(sql),
        command,
      );
      const [row] = await sql<Array<ViolationRow>>`
        select id as "violationCaseId", type, source_kind as "sourceKind",
          source_reference_id as "sourceReferenceId", status,
          opened_at as "openedAt", deadline_at as "deadlineAt",
          next_action_code as "nextActionCode", evidence,
          action_reason_codes as "actionReasonCodes"
        from problem_violation_cases where id = ${command.caseId}
      `;
      if (!row) throw new ProblemFollowUpFault("NOT_FOUND");
      return platformViolationCaseViewContract.parse({
        ...violationQueueItem(row),
        evidence: row.evidence,
        actionReasonCodes: row.actionReasonCodes,
        access: { ...access, mode: "REVEALED_MINIMUM" },
      });
    });
  }
}

type ViolationRow = {
  violationCaseId: string;
  type: string;
  sourceKind: "DISPUTE" | "ORDER" | "OPERATIONAL_REPORT";
  sourceReferenceId: string;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";
  openedAt: Date;
  deadlineAt: Date | null;
  nextActionCode: string;
  evidence: JSONValue;
  actionReasonCodes: string[];
};

function contribution(
  authorKind: "BUYER" | "SELLER" | "PLATFORM_AGENT",
  text: string,
  evidenceIds: readonly string[],
  submittedAt: string,
) {
  return {
    authorKind,
    text,
    evidence: evidenceIds.map((evidenceId) => ({
      evidenceId,
      kind: "IMAGE" as const,
      submittedAt,
    })),
    submittedAt,
  };
}

function appendContribution(
  row: DisputeRow,
  authorKind: "SELLER" | "PLATFORM_AGENT",
  text: string,
  evidenceIds: readonly string[],
  occurredAt: Date,
) {
  return [
    ...(row.contributions as unknown as ReturnType<typeof contribution>[]),
    contribution(authorKind, text, evidenceIds, occurredAt.toISOString()),
  ];
}

function relatedView(row: DisputeRow) {
  return {
    disputeId: row.disputeId,
    orderId: row.orderId,
    storeId: row.storeId,
    status: row.status,
    category: row.category,
    openedAt: row.openedAt.toISOString(),
    deadline:
      row.deadlineKind && row.deadlineAt
        ? { kind: row.deadlineKind, dueAt: row.deadlineAt.toISOString() }
        : null,
    nextAction: nextAction(row.status),
    contributions: row.contributions,
    outcome: row.outcome,
  };
}

function platformQueueItem(row: DisputeRow) {
  const view = relatedView(row);
  return {
    disputeId: view.disputeId,
    status: view.status,
    category: view.category,
    openedAt: view.openedAt,
    deadline: view.deadline,
    nextAction: view.nextAction,
  };
}

function nextAction(status: DisputeStatus) {
  if (status === "AWAITING_SELLER_RESPONSE") {
    return { actorKind: "SELLER" as const, code: "SUBMIT_FIRST_RESPONSE" as const };
  }
  if (status === "UNDER_REVIEW") {
    return { actorKind: "PLATFORM_AGENT" as const, code: "REVIEW_CASE" as const };
  }
  return { actorKind: null, code: "NO_ACTION" as const };
}

async function readDispute(
  sql: Sql,
  disputeId: string,
  scope: { buyerIdentityId?: string; storeId?: string } = {},
) {
  const [row] = await sql<Array<DisputeRow>>`
    select id as "disputeId", order_id as "orderId",
      buyer_identity_id as "buyerIdentityId", store_id as "storeId",
      status, category, opened_at as "openedAt", deadline_kind as "deadlineKind",
      deadline_at as "deadlineAt", contributions, outcome, version
    from problem_disputes
    where id = ${disputeId}
      and (${scope.buyerIdentityId ?? null}::uuid is null or
           buyer_identity_id = ${scope.buyerIdentityId ?? null}::uuid)
      and (${scope.storeId ?? null}::uuid is null or
           store_id = ${scope.storeId ?? null}::uuid)
  `;
  return row;
}

async function lockDispute(sql: Sql, disputeId: string) {
  const rows = await sql<Array<DisputeRow>>`
    select id as "disputeId", order_id as "orderId",
      buyer_identity_id as "buyerIdentityId", store_id as "storeId",
      status, category, opened_at as "openedAt", deadline_kind as "deadlineKind",
      deadline_at as "deadlineAt", contributions, outcome, version
    from problem_disputes where id = ${disputeId} for update
  `;
  return rows[0];
}

async function listDisputes(
  sql: Sql,
  query: PageQuery,
  scope: { storeId?: string } = {},
) {
  const cursor = decodeCursor(query.cursor);
  return sql<Array<DisputeRow>>`
    select id as "disputeId", order_id as "orderId",
      buyer_identity_id as "buyerIdentityId", store_id as "storeId",
      status, category, opened_at as "openedAt", deadline_kind as "deadlineKind",
      deadline_at as "deadlineAt", contributions, outcome, version
    from problem_disputes
    where (${scope.storeId ?? null}::uuid is null or
           store_id = ${scope.storeId ?? null}::uuid)
      and (${cursor?.occurredAt ?? null}::timestamptz is null or
        (opened_at, id) < (${cursor?.occurredAt ?? null}::timestamptz,
                           ${cursor?.id ?? null}::uuid))
    order by opened_at desc, id desc
    limit ${query.limit + 1}
  `;
}

function page<Row>(rows: Row[], limit: number, map: (row: Row) => unknown) {
  const visible = rows.slice(0, limit);
  const last = visible.at(-1) as
    | (Row & { openedAt?: Date; disputeId?: string; violationCaseId?: string })
    | undefined;
  return {
    items: visible.map(map),
    nextCursor:
      rows.length > limit && last?.openedAt
        ? encodeCursor(last.openedAt, last.disputeId ?? last.violationCaseId ?? "")
        : null,
  };
}

function encodeCursor(occurredAt: Date, id: string) {
  return Buffer.from(
    JSON.stringify({ occurredAt: occurredAt.toISOString(), id }),
  ).toString("base64url");
}

function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      occurredAt?: string;
      id?: string;
    };
    if (
      !value.occurredAt ||
      !value.id ||
      Number.isNaN(Date.parse(value.occurredAt)) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.id,
      )
    ) {
      throw new Error("invalid cursor");
    }
    return { occurredAt: value.occurredAt, id: value.id };
  } catch {
    throw new ProblemFollowUpFault("VALIDATION_ERROR");
  }
}

async function claim(
  sql: Sql,
  operation: string,
  command: { actorId: string; idempotencyKey: string; requestHash: string },
) {
  const [lock] = await sql<Array<{ acquired: boolean }>>`
    select pg_try_advisory_xact_lock(
      hashtextextended(${`${operation}:${command.actorId}:${command.idempotencyKey}`}, 0)
    ) as acquired
  `;
  if (!lock?.acquired) throw new ProblemFollowUpFault("IDEMPOTENCY_IN_PROGRESS");
  const [record] = await sql<IdempotencyRow[]>`
    select request_hash as "requestHash", response_json as response
    from problem_follow_up_idempotency_records
    where operation = ${operation} and actor_id = ${command.actorId}
      and key = ${command.idempotencyKey}
  `;
  if (!record) return undefined;
  if (record.requestHash !== command.requestHash) {
    throw new ProblemFollowUpFault("IDEMPOTENCY_CONFLICT");
  }
  return record.response;
}

async function remember(
  sql: Sql,
  operation: string,
  command: { actorId: string; idempotencyKey: string; requestHash: string },
  response: unknown,
) {
  await sql`
    insert into problem_follow_up_idempotency_records
      (operation, actor_id, key, request_hash, response_json)
    values (${operation}, ${command.actorId}, ${command.idempotencyKey},
      ${command.requestHash}, ${sql.json(response as JSONValue)})
  `;
}

async function updateDispute(
  sql: Sql,
  row: DisputeRow,
  update: {
    status: DisputeStatus;
    deadlineKind: DisputeRow["deadlineKind"];
    deadlineAt: Date | null;
    contributions: unknown;
    outcome: unknown;
    occurredAt: Date;
  },
) {
  await sql`
    update problem_disputes set status = ${update.status},
      deadline_kind = ${update.deadlineKind}, deadline_at = ${update.deadlineAt},
      contributions = ${sql.json(update.contributions as JSONValue)},
      outcome = ${update.outcome ? sql.json(update.outcome as JSONValue) : null},
      version = ${row.version + 1}, updated_at = ${update.occurredAt}
    where id = ${row.disputeId} and version = ${row.version}
  `;
}

async function auditDispute(
  sql: Sql,
  audit: {
    disputeId: string;
    action: string;
    actorKind: string;
    actorIdentityId: string;
    fromStatus: string | null;
    toStatus: string;
    reasonCode: string;
    evidenceCount: number;
    occurredAt: Date;
    correlationId: string;
  },
) {
  await sql`
    insert into problem_dispute_audits
      (id, dispute_id, action, actor_kind, actor_identity_id, from_status,
       to_status, reason_code, evidence_count, correlation_id, occurred_at)
    values (${randomUUID()}, ${audit.disputeId}, ${audit.action}, ${audit.actorKind},
      ${audit.actorIdentityId}, ${audit.fromStatus}, ${audit.toStatus},
      ${audit.reasonCode}, ${audit.evidenceCount}, ${audit.correlationId},
      ${audit.occurredAt})
  `;
}

function eventEnvelope(
  row: DisputeRow,
  command: { actorId: string; occurredAt: Date; correlationId: string },
  eventType: string,
) {
  return {
    version: 1,
    eventId: randomUUID(),
    eventType,
    aggregateId: row.disputeId,
    aggregateVersion: row.version + 1,
    occurredAt: command.occurredAt.toISOString(),
    correlationId: command.correlationId,
    actor: { type: "IDENTITY" as const, id: identityIdContract.parse(command.actorId) },
  };
}

async function authorize(
  access: ProblemFollowUpSensitiveAccess,
  transaction: OpaquePlatformAccessTransactionContext,
  command: SensitiveCaseRead,
) {
  return access.authorizeSensitiveAction(transaction, {
    grantId: command.access.grantId,
    actorIdentityId: command.actorId,
    responsibility: command.responsibility,
    resourceType: command.resourceType,
    resourceId: command.caseId,
    action: command.action,
    reason: command.access.reason,
    correlationId: command.correlationId,
  });
}

async function authorizeMutation(
  access: ProblemFollowUpSensitiveAccess,
  transaction: OpaquePlatformAccessTransactionContext,
  command: SensitiveDisputeMutation<unknown>,
) {
  await access.authorizeSensitiveAction(transaction, {
    grantId: command.access.grantId,
    actorIdentityId: command.actorId,
    responsibility: command.responsibility,
    resourceType: "DISPUTE_CASE",
    resourceId: command.disputeId,
    action: command.action,
    reason: command.access.reason,
    correlationId: command.correlationId,
  });
  return access.authorizeSensitiveAction(transaction, {
    grantId: command.access.grantId,
    actorIdentityId: command.actorId,
    responsibility: command.responsibility,
    resourceType: "DISPUTE_CASE",
    resourceId: command.disputeId,
    action: "REVEAL_MINIMUM",
    reason: command.access.reason,
    correlationId: command.correlationId,
  });
}

async function recordViolation(
  sql: Sql,
  row: DisputeRow,
  command: SensitiveDisputeMutation<ResolveDisputeInput>,
  evidence: unknown[],
) {
  const violationCaseId = randomUUID();
  const type = violationType(row.category);
  await sql`
    insert into problem_violation_cases
      (id, type, source_kind, source_reference_id, status, opened_at,
       deadline_at, next_action_code, evidence, action_reason_codes)
    values (${violationCaseId}, ${type}, 'DISPUTE', ${row.disputeId}, 'OPEN',
      ${command.occurredAt}, null, 'START_REVIEW', ${sql.json(evidence as JSONValue)},
      ${["VIOLATION_RECORDED"]})
  `;
  await sql`
    insert into problem_violation_audits
      (id, violation_case_id, actor_identity_id, action, status, reason_code,
       evidence_count, correlation_id, occurred_at)
    values (${randomUUID()}, ${violationCaseId}, ${command.actorId},
      'RECORD_VIOLATION', 'OPEN', 'VIOLATION_RECORDED', ${evidence.length},
      ${command.correlationId}, ${command.occurredAt})
  `;
  await enqueueOutboxEvent(
    sql,
    requireEventActor(
      violationRecordedV1Contract.parse({
        version: 1,
        eventId: randomUUID(),
        eventType: "ViolationRecorded.v1",
        aggregateId: violationCaseId,
        aggregateVersion: 1,
        occurredAt: command.occurredAt.toISOString(),
        correlationId: command.correlationId,
        actor: { type: "IDENTITY", id: command.actorId },
        payload: {
          violationCaseId,
          type,
          source: { kind: "DISPUTE", disputeId: row.disputeId },
          status: "OPEN",
          deadlineAt: null,
        },
      }),
    ),
  );
}

function violationType(category: string) {
  if (category === "DELIVERY_NOT_RECEIVED") return "FULFILLMENT_NONCOMPLIANCE";
  if (category === "REFUND_NOT_COMPLETED") return "REFUND_NONCOMPLIANCE";
  return "MISREPRESENTATION";
}

function violationQueueItem(row: ViolationRow) {
  return {
    violationCaseId: row.violationCaseId,
    type: row.type,
    source:
      row.sourceKind === "DISPUTE"
        ? { kind: "DISPUTE" as const, disputeId: row.sourceReferenceId }
        : row.sourceKind === "ORDER"
          ? { kind: "ORDER" as const, orderId: row.sourceReferenceId }
          : { kind: "OPERATIONAL_REPORT" as const, referenceId: row.sourceReferenceId },
    status: row.status,
    openedAt: row.openedAt.toISOString(),
    deadlineAt: row.deadlineAt?.toISOString() ?? null,
    nextActionCode: row.nextActionCode,
  };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function requireEventActor<Event extends { actor?: unknown }>(event: Event) {
  if (!event.actor) throw new Error("Outbox event actor is required");
  return event as Event & { actor: NonNullable<Event["actor"]> };
}
