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
import {
  appendContribution,
  contribution,
  decodeCursor,
  page,
  platformQueueItem,
  relatedView,
  violationQueueItem,
  type DisputeRow,
  type DisputeStatus,
  type ViolationRow,
} from "./problem-follow-up-views";

const REOPEN_WINDOW_MS = DISPUTE_REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1_000;

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

  async replayOpen(command: {
    actorId: string;
    idempotencyKey: string;
    requestHash: string;
  }) {
    const replay = await readReplay(this.#sql, "OPEN", command);
    return replay ? buyerDisputeViewContract.parse(replay) : undefined;
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
        command.input.evidence,
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
        evidenceCount: command.input.evidence.length,
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
        command.input.evidence,
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
        evidenceCount: command.input.evidence.length,
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
      const resolvingExpiredSellerCase =
        row.status === "AWAITING_SELLER_RESPONSE" &&
        row.deadlineAt !== null &&
        command.occurredAt > row.deadlineAt;
      if (row.status !== "UNDER_REVIEW" && !resolvingExpiredSellerCase) {
        throw new ProblemFollowUpFault("INVALID_TRANSITION");
      }
      const deadlineAt = new Date(command.occurredAt.getTime() + REOPEN_WINDOW_MS);
      const contributions = appendContribution(
        row,
        "PLATFORM_AGENT",
        command.input.explanation,
        command.input.evidence,
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
        evidenceCount: command.input.evidence.length,
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
              fromStatus: row.status,
              toStatus: command.input.status,
              nextDeadlineAt: deadlineAt.toISOString(),
              reasonCode,
            },
          }),
        ),
      );
      if (command.input.outcomeCode === "VIOLATION_RECORDED") {
        await recordViolation(
          sql,
          row,
          command,
          command.input.violationType!,
          contributions.at(-1)?.evidence ?? [],
        );
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
        command.input.evidence,
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
        evidenceCount: command.input.evidence.length,
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
  return readReplay(sql, operation, command);
}

async function readReplay(
  sql: Sql,
  operation: string,
  command: { actorId: string; idempotencyKey: string; requestHash: string },
) {
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
  return access.authorizeSensitiveAction(
    transaction,
    sensitiveAction(command, command.resourceType, command.caseId, command.action),
  );
}

async function authorizeMutation(
  access: ProblemFollowUpSensitiveAccess,
  transaction: OpaquePlatformAccessTransactionContext,
  command: SensitiveDisputeMutation<unknown>,
) {
  await access.authorizeSensitiveAction(
    transaction,
    sensitiveAction(command, "DISPUTE_CASE", command.disputeId, command.action),
  );
  return access.authorizeSensitiveAction(
    transaction,
    sensitiveAction(command, "DISPUTE_CASE", command.disputeId, "REVEAL_MINIMUM"),
  );
}

function sensitiveAction(
  command: SensitiveCaseRead | SensitiveDisputeMutation<unknown>,
  resourceType: "DISPUTE_CASE" | "VIOLATION_CASE",
  resourceId: string,
  action: "REVEAL_MINIMUM" | "UPDATE_CASE_STATUS",
) {
  return {
    grantId: command.access.grantId,
    actorIdentityId: command.actorId,
    responsibility: command.responsibility,
    resourceType,
    resourceId,
    action,
    reason: command.access.reason,
    correlationId: command.correlationId,
  } as const;
}

async function recordViolation(
  sql: Sql,
  row: DisputeRow,
  command: SensitiveDisputeMutation<ResolveDisputeInput>,
  type: string,
  evidence: unknown[],
) {
  const violationCaseId = randomUUID();
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
