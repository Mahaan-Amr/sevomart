import { createHash } from "node:crypto";

import {
  DISPUTE_SELLER_FIRST_RESPONSE_HOURS,
  disputeIdContract,
  problemFollowUpCursorContract,
  problemFollowUpIdempotencyKeyContract,
  problemFollowUpPageLimitContract,
  violationCaseIdContract,
} from "@sevo/contracts/problem-follow-up/v1";
import {
  openDisputeInputV2Contract,
  reopenDisputeInputV2Contract,
  resolveDisputeInputV2Contract,
  respondToDisputeInputV2Contract,
} from "@sevo/contracts/problem-follow-up/v2";
import {
  identityIdContract,
  type IdentityId,
  type OrderId,
} from "@sevo/contracts/platform/v1";
import { PlatformAgentSessionUnauthorizedError } from "../../identity-access/public";
import { isBuyerDisputeWindowOpen } from "./buyer-dispute-eligibility";

import {
  ProblemFollowUpFault,
  type ProblemFollowUpFulfillmentRead,
  type ProblemFollowUpEvidenceRead,
  type ProblemFollowUpPlatformSessionRead,
  type ProblemFollowUpRepository,
  type ProblemFollowUpRequest,
  type ProblemFollowUpSellerAccessRead,
  type ProblemFollowUpSessionRead,
  type ProblemFollowUpStoreResolver,
  type SensitiveAccessInput,
} from "../public";

const HOUR_MS = 60 * 60 * 1_000;

export class ProblemFollowUpService {
  constructor(
    private readonly repository: ProblemFollowUpRepository,
    private readonly sessions: ProblemFollowUpSessionRead,
    private readonly fulfillment: ProblemFollowUpFulfillmentRead,
    private readonly now: () => Date = () => new Date(),
    private readonly sellers?: ProblemFollowUpSellerAccessRead,
    private readonly stores?: ProblemFollowUpStoreResolver,
    private readonly platformSessions?: ProblemFollowUpPlatformSessionRead,
    private readonly evidence?: ProblemFollowUpEvidenceRead,
  ) {}

  async open(request: ProblemFollowUpRequest, body: unknown, key: unknown) {
    const actorId = await this.requireIdentity(request.sessionToken);
    const input = this.parse(openDisputeInputV2Contract, body);
    const idempotencyKey = this.parseKey(key);
    const requestHash = hash(input);
    const replay = await this.repository.replayOpen({
      actorId,
      idempotencyKey,
      requestHash,
    });
    if (replay) return replay;
    const snapshot = await this.requireEligibleOrder(actorId, input.orderId);
    const openedAt = this.now();
    if (
      !this.evidence ||
      !(
        await Promise.all(
          input.evidence.map(({ evidenceId, kind }) =>
            this.evidence!.isReadyBuyerEvidence({
              identityId: actorId,
              orderId: input.orderId,
              evidenceId,
              kind,
            }),
          ),
        )
      ).every((result) => result === "READY")
    ) {
      throw new ProblemFollowUpFault("VALIDATION_ERROR");
    }
    return this.repository.open({
      actorId,
      storeId: snapshot.storeId,
      input,
      openedAt,
      sellerResponseDeadline: new Date(
        openedAt.getTime() + DISPUTE_SELLER_FIRST_RESPONSE_HOURS * HOUR_MS,
      ),
      idempotencyKey,
      requestHash,
      correlationId: request.correlationId,
    });
  }

  async readBuyer(request: ProblemFollowUpRequest, disputeId: unknown) {
    const actorId = await this.requireIdentity(request.sessionToken);
    return this.repository.readBuyer(actorId, this.parse(disputeIdContract, disputeId));
  }

  async listBuyer(request: ProblemFollowUpRequest, cursor?: unknown, limit?: unknown) {
    const actorId = await this.requireIdentity(request.sessionToken);
    return this.repository.listBuyer(actorId, this.page(cursor, limit));
  }

  async listSeller(request: ProblemFollowUpRequest, cursor?: unknown, limit?: unknown) {
    const { storeId } = await this.requireSeller(request.sessionToken);
    return this.repository.listSeller(storeId, this.page(cursor, limit));
  }

  async readSeller(request: ProblemFollowUpRequest, disputeId: unknown) {
    const { storeId } = await this.requireSeller(request.sessionToken);
    return this.repository.readSeller(
      storeId,
      this.parse(disputeIdContract, disputeId),
    );
  }

  async respond(
    request: ProblemFollowUpRequest,
    disputeId: unknown,
    body: unknown,
    key: unknown,
  ) {
    const { actorId, storeId } = await this.requireSeller(request.sessionToken);
    const input = this.parse(respondToDisputeInputV2Contract, body);
    const parsedDisputeId = this.parse(disputeIdContract, disputeId);
    if (
      input.evidence.length > 0 &&
      (!this.evidence ||
        !(
          await Promise.all(
            input.evidence.map(({ evidenceId, kind }) =>
              this.evidence!.isReadySellerEvidence({
                identityId: actorId,
                disputeId: parsedDisputeId,
                evidenceId,
                kind,
              }),
            ),
          )
        ).every(Boolean))
    ) {
      throw new ProblemFollowUpFault("VALIDATION_ERROR");
    }
    return this.repository.respond({
      disputeId: parsedDisputeId,
      actorId,
      storeId,
      input,
      occurredAt: this.now(),
      idempotencyKey: this.parseKey(key),
      requestHash: hash({ disputeId: parsedDisputeId, input }),
      correlationId: request.correlationId,
    });
  }

  async listPlatformDisputes(
    request: ProblemFollowUpRequest,
    cursor?: unknown,
    limit?: unknown,
  ) {
    await this.requirePlatform(request.sessionToken, "DISPUTE_REVIEW");
    return this.repository.listPlatformDisputes(this.page(cursor, limit));
  }

  async readPlatformDispute(
    request: ProblemFollowUpRequest,
    disputeId: unknown,
    access: SensitiveAccessInput,
  ) {
    const actorId = await this.requirePlatform(request.sessionToken, "DISPUTE_REVIEW");
    const caseId = this.parse(disputeIdContract, disputeId);
    return this.repository.readPlatformDispute({
      caseId,
      actorId,
      responsibility: "DISPUTE_REVIEW",
      resourceType: "DISPUTE_CASE",
      action: "REVEAL_MINIMUM",
      access: this.requireAccess(access),
      correlationId: request.correlationId,
    });
  }

  async resolve(
    request: ProblemFollowUpRequest,
    disputeId: unknown,
    body: unknown,
    key: unknown,
    access: SensitiveAccessInput,
  ) {
    const actorId = await this.requirePlatform(request.sessionToken, "DISPUTE_REVIEW");
    const input = this.parse(resolveDisputeInputV2Contract, body);
    const parsedDisputeId = this.parse(disputeIdContract, disputeId);
    return this.repository.resolve({
      disputeId: parsedDisputeId,
      actorId,
      input,
      occurredAt: this.now(),
      idempotencyKey: this.parseKey(key),
      requestHash: hash({ disputeId: parsedDisputeId, input }),
      correlationId: request.correlationId,
      access: this.requireAccess(access),
      responsibility: "DISPUTE_REVIEW",
      action: "UPDATE_CASE_STATUS",
    });
  }

  async reopen(
    request: ProblemFollowUpRequest,
    disputeId: unknown,
    body: unknown,
    key: unknown,
    access: SensitiveAccessInput,
  ) {
    const actorId = await this.requirePlatform(request.sessionToken, "DISPUTE_REVIEW");
    const input = this.parse(reopenDisputeInputV2Contract, body);
    const parsedDisputeId = this.parse(disputeIdContract, disputeId);
    return this.repository.reopen({
      disputeId: parsedDisputeId,
      actorId,
      input,
      occurredAt: this.now(),
      idempotencyKey: this.parseKey(key),
      requestHash: hash({ disputeId: parsedDisputeId, input }),
      correlationId: request.correlationId,
      access: this.requireAccess(access),
      responsibility: "DISPUTE_REVIEW",
      action: "UPDATE_CASE_STATUS",
    });
  }

  async listPlatformViolations(
    request: ProblemFollowUpRequest,
    cursor?: unknown,
    limit?: unknown,
  ) {
    await this.requirePlatform(request.sessionToken, "VIOLATION_REVIEW");
    return this.repository.listPlatformViolations(this.page(cursor, limit));
  }

  async readPlatformViolation(
    request: ProblemFollowUpRequest,
    violationCaseId: unknown,
    access: SensitiveAccessInput,
  ) {
    const actorId = await this.requirePlatform(
      request.sessionToken,
      "VIOLATION_REVIEW",
    );
    const caseId = this.parse(violationCaseIdContract, violationCaseId);
    return this.repository.readPlatformViolation({
      caseId,
      actorId,
      responsibility: "VIOLATION_REVIEW",
      resourceType: "VIOLATION_CASE",
      action: "REVEAL_MINIMUM",
      access: this.requireAccess(access),
      correlationId: request.correlationId,
    });
  }

  private async requireIdentity(token: string | undefined) {
    if (!token) throw new ProblemFollowUpFault("UNAUTHENTICATED");
    const session = await this.sessions.readActiveIdentitySession(token);
    if (!session) throw new ProblemFollowUpFault("UNAUTHENTICATED");
    return identityIdContract.parse(session.identityId);
  }

  private async requireEligibleOrder(actorId: IdentityId, orderId: OrderId) {
    const snapshot = await this.fulfillment.readOrderSnapshot({
      orderId,
      buyerId: actorId,
    });
    if (!snapshot) throw new ProblemFollowUpFault("NOT_FOUND");
    if (!isBuyerDisputeWindowOpen(snapshot, this.now())) {
      throw new ProblemFollowUpFault("WINDOW_CLOSED");
    }
    return snapshot;
  }

  private parseKey(value: unknown) {
    const parsed = problemFollowUpIdempotencyKeyContract.safeParse(value);
    if (!parsed.success) throw new ProblemFollowUpFault("PRECONDITION_REQUIRED");
    return parsed.data;
  }

  private page(cursor: unknown, limit: unknown) {
    const parsedCursor =
      cursor === undefined
        ? undefined
        : problemFollowUpCursorContract.safeParse(cursor);
    const parsedLimit = problemFollowUpPageLimitContract.safeParse(
      limit === undefined ? 25 : Number(limit),
    );
    if (parsedCursor && !parsedCursor.success) {
      throw new ProblemFollowUpFault("VALIDATION_ERROR");
    }
    if (!parsedLimit.success) throw new ProblemFollowUpFault("VALIDATION_ERROR");
    return { cursor: parsedCursor?.data, limit: parsedLimit.data };
  }

  private async requireSeller(token: string | undefined) {
    const actorId = await this.requireIdentity(token);
    if (
      !this.sellers ||
      !this.stores ||
      !(await this.sellers.isActiveSeller(actorId))
    ) {
      throw new ProblemFollowUpFault("FORBIDDEN");
    }
    const storeId = await this.stores.resolveStore(actorId);
    if (!storeId) throw new ProblemFollowUpFault("FORBIDDEN");
    return { actorId, storeId };
  }

  private async requirePlatform(token: string | undefined, permission: string) {
    if (!token || !this.platformSessions) {
      throw new ProblemFollowUpFault("UNAUTHENTICATED");
    }
    try {
      const session = await this.platformSessions.readWorkspaceSession(token);
      if (!session.permissions.includes(permission)) {
        throw new ProblemFollowUpFault("FORBIDDEN");
      }
      return identityIdContract.parse(session.actor.identityId);
    } catch (error) {
      if (error instanceof ProblemFollowUpFault) throw error;
      if (error instanceof PlatformAgentSessionUnauthorizedError) {
        throw new ProblemFollowUpFault("UNAUTHENTICATED");
      }
      throw error;
    }
  }

  private requireAccess(access: SensitiveAccessInput) {
    if (!access.grantId || access.reason.trim().length < 10) {
      throw new ProblemFollowUpFault("SENSITIVE_ACCESS_REQUIRED");
    }
    return access;
  }

  private parse<Output>(
    contract: {
      safeParse(value: unknown): { success: true; data: Output } | { success: false };
    },
    value: unknown,
  ) {
    const parsed = contract.safeParse(value);
    if (!parsed.success) throw new ProblemFollowUpFault("VALIDATION_ERROR");
    return parsed.data;
  }
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
