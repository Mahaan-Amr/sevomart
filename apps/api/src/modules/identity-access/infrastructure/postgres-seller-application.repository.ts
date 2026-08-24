import { createHash, randomUUID } from "node:crypto";

import {
  sellerApplicationIdContract,
  sellerApplicationViewContract,
  type MySellerApplications,
  type ReadMySellerApplicationsQuery,
  type ResubmitSellerApplication,
  type SellerApplicationInput,
  type SellerApplicationStatus,
  type SellerApplicationView,
  type WithdrawSellerApplication,
} from "@sevo/contracts/identity-access/v1";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type JSONValue, type Sql } from "postgres";

import {
  ActiveSellerApplicationExistsError,
  InvalidSellerApplicationTransitionError,
  SellerApplicationCursorError,
  SellerApplicationIdempotencyConflictError,
  SellerApplicationIdempotencyInProgressError,
  SellerApplicationNotFoundError,
  SellerApplicationRevisionConflictError,
  SellerAccessExistsError,
  type SellerApplicationApplicant,
  type SellerApplicationCommandContext,
} from "../public";

type ApplicationRow = {
  applicationId: string;
  identityId: string;
  status: SellerApplicationStatus;
  currentRevision: number;
  aggregateVersion: number;
  createdAt: Date;
  lastSubmittedAt: Date;
  applicantName: string;
  proposedStoreName: string;
  goodsAreaText: string;
  currentSalesMethod: string;
};

type TimelineRow = {
  revision: number;
  status: SellerApplicationStatus;
  title: string;
  publicReason: string | null;
  reasonCode: SellerApplicationView["timeline"][number]["reasonCode"];
  requestedFields: SellerApplicationView["timeline"][number]["requestedFields"];
  occurredAt: Date;
};

type IdempotencyRow = {
  payloadHash: string;
  state: "IN_PROGRESS" | "COMPLETED";
  response: JSONValue | null;
};

const SUBMIT_OPERATION = "SubmitSellerApplication.v1";
const RESUBMIT_OPERATION = "ResubmitSellerApplication.v1";
const WITHDRAW_OPERATION = "WithdrawSellerApplication.v1";

export class PostgresSellerApplicationRepository implements SellerApplicationApplicant {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async submit(
    context: SellerApplicationCommandContext,
    input: SellerApplicationInput,
  ): Promise<SellerApplicationView> {
    const payloadHash = hashPayload(input);
    return this.#sql.begin(async (sql) => {
      const replay = await beginIdempotentCommand(
        sql,
        SUBMIT_OPERATION,
        context,
        payloadHash,
      );
      if (replay) return replay;

      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${"seller-application-active:" + context.identityId}, 0)
        )
      `;

      const sellerAccess = await sql<Array<{ id: string }>>`
        select id from identity_seller_access
        where identity_id = ${context.identityId}
          and status in ('ACTIVE', 'SUSPENDED', 'REVOKED')
        limit 1
      `;
      if (sellerAccess[0]) throw new SellerAccessExistsError();

      const active = await sql<Array<{ id: string }>>`
        select id from identity_seller_applications
        where identity_id = ${context.identityId}
          and status in ('SUBMITTED', 'NEEDS_INFORMATION')
        limit 1
      `;
      if (active[0]) throw new ActiveSellerApplicationExistsError();

      const applicationId = randomUUID();
      const occurredAt = new Date();
      await sql`
        insert into identity_seller_applications
          (id, identity_id, status, current_revision, aggregate_version,
           created_at, last_submitted_at)
        values
          (${applicationId}, ${context.identityId}, 'SUBMITTED', 1, 1,
           ${occurredAt}, ${occurredAt})
      `;
      await insertRevision(sql, applicationId, 1, input, occurredAt);
      await insertAudit(sql, {
        context,
        applicationId,
        action: SUBMIT_OPERATION,
        previousStatus: null,
        nextStatus: "SUBMITTED",
        previousRevision: null,
        nextRevision: 1,
        occurredAt,
      });
      await enqueueApplicantEvent(sql, {
        context,
        applicationId,
        eventType: "SellerApplicationSubmitted.v1",
        revision: 1,
        aggregateVersion: 1,
        status: "SUBMITTED",
        occurredAt,
      });

      const response = await readApplication(sql, applicationId, context.identityId);
      await completeIdempotentCommand(
        sql,
        SUBMIT_OPERATION,
        context,
        response,
        occurredAt,
      );
      return response;
    });
  }

  async readMine(
    identityId: string,
    query: Partial<ReadMySellerApplicationsQuery> = {},
  ): Promise<MySellerApplications> {
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await readMineRows(this.#sql, identityId, cursor, limit + 1);
    const pageRows = rows.slice(0, limit);
    return {
      items: await Promise.all(
        pageRows.map((row) => hydrateApplication(this.#sql, row)),
      ),
      nextCursor:
        rows.length > limit && pageRows.length > 0
          ? encodeCursor(pageRows[pageRows.length - 1]!)
          : null,
    };
  }

  async resubmit(
    context: SellerApplicationCommandContext,
    applicationId: string,
    input: ResubmitSellerApplication,
  ): Promise<SellerApplicationView> {
    const payloadHash = hashPayload({ applicationId, ...input });
    return this.#sql.begin(async (sql) => {
      const replay = await beginIdempotentCommand(
        sql,
        RESUBMIT_OPERATION,
        context,
        payloadHash,
      );
      if (replay) return replay;

      const applications = await sql<
        Array<{
          status: SellerApplicationStatus;
          currentRevision: number;
          aggregateVersion: number;
        }>
      >`
        select status, current_revision as "currentRevision",
          aggregate_version as "aggregateVersion"
        from identity_seller_applications
        where id = ${applicationId} and identity_id = ${context.identityId}
        for update
      `;
      const application = applications[0];
      if (!application) throw new SellerApplicationNotFoundError();
      if (application.currentRevision !== input.expectedRevision) {
        throw new SellerApplicationRevisionConflictError();
      }
      if (application.status !== "NEEDS_INFORMATION") {
        throw new InvalidSellerApplicationTransitionError();
      }

      const revision = application.currentRevision + 1;
      const aggregateVersion = application.aggregateVersion + 1;
      const occurredAt = new Date();
      await sql`
        update identity_seller_applications
        set status = 'SUBMITTED', current_revision = ${revision},
          aggregate_version = ${aggregateVersion},
          last_submitted_at = ${occurredAt}
        where id = ${applicationId}
      `;
      await insertRevision(sql, applicationId, revision, input, occurredAt);
      await insertAudit(sql, {
        context,
        applicationId,
        action: RESUBMIT_OPERATION,
        previousStatus: "NEEDS_INFORMATION",
        nextStatus: "SUBMITTED",
        previousRevision: application.currentRevision,
        nextRevision: revision,
        occurredAt,
      });
      await enqueueApplicantEvent(sql, {
        context,
        applicationId,
        eventType: "SellerApplicationResubmitted.v1",
        revision,
        aggregateVersion,
        status: "SUBMITTED",
        occurredAt,
      });

      const response = await readApplication(sql, applicationId, context.identityId);
      await completeIdempotentCommand(
        sql,
        RESUBMIT_OPERATION,
        context,
        response,
        occurredAt,
      );
      return response;
    });
  }

  async withdraw(
    context: SellerApplicationCommandContext,
    applicationId: string,
    input: WithdrawSellerApplication,
  ): Promise<SellerApplicationView> {
    const payloadHash = hashPayload({ applicationId, ...input });
    return this.#sql.begin(async (sql) => {
      const replay = await beginIdempotentCommand(
        sql,
        WITHDRAW_OPERATION,
        context,
        payloadHash,
      );
      if (replay) return replay;

      const rows = await sql<
        Array<{
          status: SellerApplicationStatus;
          currentRevision: number;
          aggregateVersion: number;
        }>
      >`
        select status, current_revision as "currentRevision",
          aggregate_version as "aggregateVersion"
        from identity_seller_applications
        where id = ${applicationId} and identity_id = ${context.identityId}
        for update
      `;
      const application = rows[0];
      if (!application) throw new SellerApplicationNotFoundError();
      if (application.currentRevision !== input.expectedRevision) {
        throw new SellerApplicationRevisionConflictError();
      }
      if (
        application.status !== "SUBMITTED" &&
        application.status !== "NEEDS_INFORMATION"
      ) {
        throw new InvalidSellerApplicationTransitionError();
      }

      const occurredAt = new Date();
      const aggregateVersion = application.aggregateVersion + 1;
      await sql`
        update identity_seller_applications
        set status = 'WITHDRAWN', aggregate_version = ${aggregateVersion},
          completed_at = ${occurredAt}
        where id = ${applicationId}
      `;
      await sql`
        insert into identity_seller_application_decisions
          (id, application_id, revision, action, reason_code, public_reason,
           requested_fields, actor_identity_id, occurred_at)
        values
          (${randomUUID()}, ${applicationId}, ${application.currentRevision},
           'WITHDRAW', 'OTHER', 'درخواست به خواست متقاضی پس گرفته شد.',
           ARRAY[]::text[], ${context.identityId}, ${occurredAt})
      `;
      await insertAudit(sql, {
        context,
        applicationId,
        action: WITHDRAW_OPERATION,
        previousStatus: application.status,
        nextStatus: "WITHDRAWN",
        previousRevision: application.currentRevision,
        nextRevision: application.currentRevision,
        occurredAt,
      });
      await enqueueApplicantEvent(sql, {
        context,
        applicationId,
        eventType: "SellerApplicationWithdrawn.v1",
        revision: application.currentRevision,
        aggregateVersion,
        status: "WITHDRAWN",
        occurredAt,
      });

      const response = await readApplication(sql, applicationId, context.identityId);
      await completeIdempotentCommand(
        sql,
        WITHDRAW_OPERATION,
        context,
        response,
        occurredAt,
      );
      return response;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.#sql.end();
  }
}

async function beginIdempotentCommand(
  sql: Sql,
  operation: string,
  context: SellerApplicationCommandContext,
  payloadHash: string,
): Promise<SellerApplicationView | undefined> {
  const lockKey = `${operation}:${context.identityId}:${context.idempotencyKey}`;
  const lock = await sql<Array<{ locked: boolean }>>`
    select pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) as locked
  `;
  if (!lock[0]?.locked) throw new SellerApplicationIdempotencyInProgressError();

  const rows = await sql<IdempotencyRow[]>`
    select payload_hash as "payloadHash", state, response
    from identity_seller_application_idempotency
    where operation = ${operation} and actor_id = ${context.identityId}
      and key = ${context.idempotencyKey}
  `;
  const existing = rows[0];
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new SellerApplicationIdempotencyConflictError();
    }
    if (existing.state !== "COMPLETED" || !existing.response) {
      throw new SellerApplicationIdempotencyInProgressError();
    }
    return sellerApplicationViewContract.parse(existing.response);
  }

  await sql`
    insert into identity_seller_application_idempotency
      (operation, actor_id, key, payload_hash, state)
    values
      (${operation}, ${context.identityId}, ${context.idempotencyKey},
       ${payloadHash}, 'IN_PROGRESS')
  `;
  return undefined;
}

async function completeIdempotentCommand(
  sql: Sql,
  operation: string,
  context: SellerApplicationCommandContext,
  response: SellerApplicationView,
  completedAt: Date,
): Promise<void> {
  await sql`
    update identity_seller_application_idempotency
    set state = 'COMPLETED', response = ${sql.json(response as unknown as JSONValue)},
      completed_at = ${completedAt}
    where operation = ${operation} and actor_id = ${context.identityId}
      and key = ${context.idempotencyKey}
  `;
}

async function insertRevision(
  sql: Sql,
  applicationId: string,
  revision: number,
  input: SellerApplicationInput,
  submittedAt: Date,
): Promise<void> {
  await sql`
    insert into identity_seller_application_revisions
      (id, application_id, revision, applicant_name, proposed_store_name,
       goods_area_text, current_sales_method, submitted_at)
    values
      (${randomUUID()}, ${applicationId}, ${revision}, ${input.applicantName},
       ${input.proposedStoreName}, ${input.goodsAreaText},
       ${input.currentSalesMethod}, ${submittedAt})
  `;
}

async function insertAudit(
  sql: Sql,
  input: {
    context: SellerApplicationCommandContext;
    applicationId: string;
    action: string;
    previousStatus: SellerApplicationStatus | null;
    nextStatus: SellerApplicationStatus;
    previousRevision: number | null;
    nextRevision: number;
    occurredAt: Date;
  },
): Promise<void> {
  await sql`
    insert into identity_seller_application_audit
      (id, actor_kind, actor_identity_id, audience, action, target_id, result,
       previous_status, next_status, previous_revision, next_revision,
       correlation_id, idempotency_key_hash, occurred_at)
    values
      (${randomUUID()}, 'IDENTITY', ${input.context.identityId}, 'PUBLIC',
       ${input.action}, ${input.applicationId}, 'SUCCEEDED',
       ${input.previousStatus}, ${input.nextStatus}, ${input.previousRevision},
       ${input.nextRevision}, ${input.context.correlationId},
       ${hashText(input.context.idempotencyKey)}, ${input.occurredAt})
  `;
}

async function enqueueApplicantEvent(
  sql: Sql,
  input: {
    context: SellerApplicationCommandContext;
    applicationId: string;
    eventType:
      | "SellerApplicationSubmitted.v1"
      | "SellerApplicationResubmitted.v1"
      | "SellerApplicationWithdrawn.v1";
    revision: number;
    aggregateVersion: number;
    status: "SUBMITTED" | "WITHDRAWN";
    occurredAt: Date;
  },
): Promise<void> {
  await enqueueOutboxEvent(sql, {
    version: 1,
    eventId: randomUUID(),
    eventType: input.eventType,
    aggregateId: input.applicationId,
    aggregateVersion: input.aggregateVersion,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.context.correlationId,
    actor: {
      type: "IDENTITY",
      id: identityIdContract.parse(input.context.identityId),
    },
    payload: {
      applicationId: input.applicationId,
      identityId: input.context.identityId,
      status: input.status,
      revision: input.revision,
      actorKind: "APPLICANT",
    },
  });
}

async function readApplication(
  sql: Sql,
  applicationId: string,
  identityId: string,
): Promise<SellerApplicationView> {
  const rows = await readApplicationRows(sql, identityId, applicationId);
  const row = rows[0];
  if (!row) throw new SellerApplicationNotFoundError();
  return hydrateApplication(sql, row);
}

async function readApplicationRows(
  sql: Sql,
  identityId: string,
  applicationId?: string,
): Promise<ApplicationRow[]> {
  return sql<ApplicationRow[]>`
    select a.id as "applicationId", a.identity_id as "identityId", a.status,
      a.current_revision as "currentRevision",
      a.aggregate_version as "aggregateVersion", a.created_at as "createdAt",
      a.last_submitted_at as "lastSubmittedAt",
      r.applicant_name as "applicantName",
      r.proposed_store_name as "proposedStoreName",
      r.goods_area_text as "goodsAreaText",
      r.current_sales_method as "currentSalesMethod"
    from identity_seller_applications a
    join identity_seller_application_revisions r
      on r.application_id = a.id and r.revision = a.current_revision
    where a.identity_id = ${identityId}
      ${applicationId ? sql`and a.id = ${applicationId}` : sql``}
    order by a.created_at desc, a.id desc
  `;
}

type DecodedCursor = { createdAt: Date; applicationId: string };

async function readMineRows(
  sql: Sql,
  identityId: string,
  cursor: DecodedCursor | undefined,
  limit: number,
): Promise<ApplicationRow[]> {
  return sql<ApplicationRow[]>`
    select a.id as "applicationId", a.identity_id as "identityId", a.status,
      a.current_revision as "currentRevision",
      a.aggregate_version as "aggregateVersion", a.created_at as "createdAt",
      a.last_submitted_at as "lastSubmittedAt",
      r.applicant_name as "applicantName",
      r.proposed_store_name as "proposedStoreName",
      r.goods_area_text as "goodsAreaText",
      r.current_sales_method as "currentSalesMethod"
    from identity_seller_applications a
    join identity_seller_application_revisions r
      on r.application_id = a.id and r.revision = a.current_revision
    where a.identity_id = ${identityId}
      ${
        cursor
          ? sql`and (a.created_at, a.id) < (${cursor.createdAt}, ${cursor.applicationId}::uuid)`
          : sql``
      }
    order by a.created_at desc, a.id desc
    limit ${limit}
  `;
}

function encodeCursor(row: ApplicationRow): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: row.createdAt.toISOString(),
      applicationId: row.applicationId,
    }),
  ).toString("base64url");
}

function decodeCursor(cursor: string): DecodedCursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      applicationId?: unknown;
    };
    const applicationId = sellerApplicationIdContract.parse(parsed.applicationId);
    if (typeof parsed.createdAt !== "string") throw new Error("invalid cursor");
    const createdAt = new Date(parsed.createdAt);
    if (!Number.isFinite(createdAt.getTime())) throw new Error("invalid cursor");
    return { createdAt, applicationId };
  } catch {
    throw new SellerApplicationCursorError();
  }
}

async function hydrateApplication(
  sql: Sql,
  row: ApplicationRow,
): Promise<SellerApplicationView> {
  const timeline = await sql<TimelineRow[]>`
    select revision, 'SUBMITTED' as status,
      case when revision = 1 then 'درخواست ثبت شد' else 'اطلاعات تکمیل شد' end as title,
      null::text as "publicReason", null::text as "reasonCode",
      ARRAY[]::text[] as "requestedFields", submitted_at as "occurredAt"
    from identity_seller_application_revisions
    where application_id = ${row.applicationId}
    union all
    select revision,
      case action
        when 'REQUEST_INFORMATION' then 'NEEDS_INFORMATION'
        when 'APPROVE' then 'APPROVED'
        when 'REJECT' then 'REJECTED'
        else 'WITHDRAWN'
      end as status,
      case action
        when 'REQUEST_INFORMATION' then 'اطلاعات بیشتری لازم است'
        when 'APPROVE' then 'درخواست تأیید شد'
        when 'REJECT' then 'درخواست تأیید نشد'
        else 'درخواست پس گرفته شد'
      end as title,
      public_reason as "publicReason", reason_code as "reasonCode",
      requested_fields as "requestedFields", occurred_at as "occurredAt"
    from identity_seller_application_decisions
    where application_id = ${row.applicationId}
    order by "occurredAt" asc
  `;

  return sellerApplicationViewContract.parse({
    applicationId: row.applicationId,
    status: row.status,
    currentRevision: row.currentRevision,
    currentPayload: {
      applicantName: row.applicantName,
      proposedStoreName: row.proposedStoreName,
      goodsAreaText: row.goodsAreaText,
      currentSalesMethod: row.currentSalesMethod,
    },
    nextStep: nextStep(row.status),
    createdAt: row.createdAt.toISOString(),
    lastSubmittedAt: row.lastSubmittedAt.toISOString(),
    timeline: timeline.map((entry) => ({
      ...entry,
      occurredAt: entry.occurredAt.toISOString(),
    })),
  });
}

function nextStep(status: SellerApplicationStatus) {
  if (status === "NEEDS_INFORMATION") return "PROVIDE_INFORMATION" as const;
  if (status === "APPROVED") return "START_SELLER_WORKSPACE" as const;
  if (status === "SUBMITTED") return "WAIT_FOR_REVIEW" as const;
  return "APPLICATION_ENDED" as const;
}

function hashPayload(payload: object): string {
  return hashText(canonicalJson(payload));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
