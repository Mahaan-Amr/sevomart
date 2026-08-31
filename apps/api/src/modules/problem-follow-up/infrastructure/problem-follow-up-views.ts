import type { JSONValue } from "postgres";

import { ProblemFollowUpFault } from "../public";

export type DisputeStatus =
  "AWAITING_SELLER_RESPONSE" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";

export type DisputeRow = {
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

export type ViolationRow = {
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

export function contribution(
  authorKind: "BUYER" | "SELLER" | "PLATFORM_AGENT",
  text: string,
  evidence: readonly { evidenceId: string; kind: string }[],
  submittedAt: string,
) {
  return {
    authorKind,
    text,
    evidence: evidence.map((reference) => ({ ...reference, submittedAt })),
    submittedAt,
  };
}

export function appendContribution(
  row: DisputeRow,
  authorKind: "SELLER" | "PLATFORM_AGENT",
  text: string,
  evidence: readonly { evidenceId: string; kind: string }[],
  occurredAt: Date,
) {
  return [
    ...(row.contributions as unknown as ReturnType<typeof contribution>[]),
    contribution(authorKind, text, evidence, occurredAt.toISOString()),
  ];
}

export function relatedView(row: DisputeRow) {
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
    nextAction: nextAction(row.status, row.deadlineAt),
    contributions: row.contributions,
    outcome: row.outcome,
  };
}

export function platformQueueItem(row: DisputeRow) {
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

function nextAction(status: DisputeStatus, deadlineAt: Date | null) {
  if (status === "AWAITING_SELLER_RESPONSE") {
    if (deadlineAt && deadlineAt.getTime() < Date.now()) {
      return { actorKind: "PLATFORM_AGENT" as const, code: "REVIEW_CASE" as const };
    }
    return { actorKind: "SELLER" as const, code: "SUBMIT_FIRST_RESPONSE" as const };
  }
  if (status === "UNDER_REVIEW") {
    return { actorKind: "PLATFORM_AGENT" as const, code: "REVIEW_CASE" as const };
  }
  return { actorKind: null, code: "NO_ACTION" as const };
}

export function violationQueueItem(row: ViolationRow) {
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

export function page<Row>(rows: Row[], limit: number, map: (row: Row) => unknown) {
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

export function decodeCursor(cursor?: string) {
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
