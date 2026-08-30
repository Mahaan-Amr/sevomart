import { createHash, randomUUID } from "node:crypto";

import {
  approveEmergencyAccessCommandContract,
  approveResponsibilityGrantCommandContract,
  approveSensitiveAccessCommandContract,
  closeEmergencyAccessCommandContract,
  completeEmergencyAccessReviewCommandContract,
  emergencyAccessActivatedV1Contract,
  emergencyAccessActivationCommandContract,
  emergencyAccessClosedV1Contract,
  emergencyAccessExpiredV1Contract,
  emergencyAccessGrantViewContract,
  emergencyAccessRequestedV1Contract,
  emergencyAccessRejectedV1Contract,
  emergencyAccessRevokedV1Contract,
  platformPermissionGrantedV1Contract,
  platformPermissionGrantRequestedV1Contract,
  platformPermissionRevokedV1Contract,
  responsibilityGrantViewContract,
  requestEmergencyAccessCommandContract,
  requestResponsibilityGrantCommandContract,
  requestSensitiveAccessCommandContract,
  revokePlatformAccessCommandContract,
  sensitiveAccessGrantedV1Contract,
  sensitiveAccessAuthorizationReceiptContract,
  sensitiveAccessGrantViewContract,
  sensitiveAccessRequestedV1Contract,
  sensitiveAccessRevokedV1Contract,
  unresolvedSensitiveAccessAuditEntryContract,
  sensitiveAccessExpiredV1Contract,
  platformAccessGrantContract,
  platformAccessGrantIdContract,
  platformAccessRejectionContract,
  platformAccessAuditEntryContract,
  rejectPlatformAccessCommandContract,
  unresolvedEmergencyAccessAuditEntryContract,
  type PlatformAccessGrant,
  type PlatformAccessRejection,
  type PlatformAccessScope,
  type Responsibility,
  type SensitiveAccessAuthorizationReceipt,
} from "@sevo/contracts/identity-access/v1";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import { enqueueOutboxEvent } from "@sevo/outbox";
import postgres, { type Sql } from "postgres";

import {
  PlatformAccessError,
  PlatformAgentSessionUnauthorizedError,
  PlatformPermissionRequiredError,
  type PlatformAccessCommandContext,
  type PlatformAccessCore,
  type PlatformEmergencyAction,
  type PlatformSensitiveAction,
  type OpaquePlatformAccessTransactionContext,
} from "../public";
import { readOpaquePlatformAccessTransaction } from "./opaque-platform-access-transaction";

const HIGH_RISK = new Set<Responsibility>([
  "ACCESS_ADMINISTRATION",
  "PAYMENT_OUTCOME_CHANGE",
  "SENSITIVE_IDENTITY_BANKING_BROAD_VIEW",
  "HIGH_RISK_BULK_EXPORT",
]);

type AccessSession = {
  identityId: string;
  strongAuthenticationAt: Date;
};

type ResponsibilityGrantRow = {
  grantId: string;
  subjectIdentityId: string;
  requestedByIdentityId: string;
  approvedByIdentityId: string | null;
  responsibility: Responsibility;
  status: "PENDING_APPROVAL" | "ACTIVE" | "REVOKED";
  revision: number;
  singleManagerException: boolean;
  createdAt: Date;
  activatedAt: Date | null;
  revokedAt: Date | null;
};

type SensitiveGrantRow = {
  grantId: string;
  subjectIdentityId: string;
  requestedByIdentityId: string;
  approvedByIdentityId: string | null;
  responsibility: Responsibility;
  purposeCode:
    "RESOLVE_ASSIGNED_CASE" | "VERIFY_CASE_EVIDENCE" | "CONTAIN_ACTIVE_INCIDENT";
  scope: PlatformAccessScope;
  status: "PENDING_APPROVAL" | "ACTIVE" | "EXPIRED" | "REVOKED";
  revision: number;
  singleManagerException: boolean;
  createdAt: Date;
  activatedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
};

type AuthorizedSensitiveGrantRow = SensitiveGrantRow & {
  accessedAt: Date;
};

type EmergencyGrantRow = {
  grantId: string;
  subjectIdentityId: string;
  requestedByIdentityId: string;
  approvedByIdentityId: string | null;
  incidentId: string;
  scope: PlatformAccessScope;
  status: "PENDING_APPROVAL" | "ACTIVE" | "EXPIRED" | "REVOKED" | "CLOSED";
  revision: number;
  singleManagerException: boolean;
  createdAt: Date;
  activatedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  reviewDueAt: Date;
  reviewedAt: Date | null;
  reviewMode: "INDEPENDENT" | "WITHOUT_INDEPENDENT_REVIEW" | null;
  rejectedAt: Date | null;
};

type AuthorizedEmergencyGrantRow = EmergencyGrantRow & {
  accessedAt: Date;
};

export class PostgresPlatformAccessRepository implements PlatformAccessCore {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }

  async requestResponsibility(
    context: PlatformAccessCommandContext,
    input: {
      recipientIdentityId: string;
      responsibility: Responsibility;
      reason: string;
    },
  ): Promise<PlatformAccessGrant> {
    return this.#sql.begin(async (sql) => {
      const session = await authorizeAccessAdministrator(
        sql,
        context.sessionToken,
        true,
      );
      const replay = await beginIdempotentCommand(
        sql,
        "request-responsibility",
        session.identityId,
        context,
        input,
      );
      if (replay) return replay;
      if (session.identityId === input.recipientIdentityId) {
        throw new PlatformAccessError("SELF_GRANT_FORBIDDEN");
      }
      const activeManagerCount = await countActiveAccessManagers(sql);
      const highRisk = HIGH_RISK.has(input.responsibility);
      const controlMode = !highRisk
        ? "DIRECT"
        : activeManagerCount === 1
          ? "SINGLE_MANAGER_EXCEPTION"
          : "DUAL_CONTROL";
      const status = highRisk && activeManagerCount > 1 ? "PENDING_APPROVAL" : "ACTIVE";
      const now = new Date();
      const grantId = randomUUID();
      const singleManagerException = controlMode === "SINGLE_MANAGER_EXCEPTION";
      requestResponsibilityGrantCommandContract.parse({
        requesterIdentityId: session.identityId,
        recipientIdentityId: input.recipientIdentityId,
        responsibility: input.responsibility,
        reason: input.reason,
        activeAccessManagerCount: activeManagerCount,
        controlMode,
        strongAuthenticationAt: session.strongAuthenticationAt.toISOString(),
      });

      await sql`
        insert into identity_platform_access_grants
          (id, grant_kind, subject_identity_id, requested_by_identity_id,
           responsibility, status, control_mode, single_manager_exception,
           revision, created_at, activated_at)
        values
          (${grantId}, 'RESPONSIBILITY', ${input.recipientIdentityId},
           ${session.identityId}, ${input.responsibility}, ${status}, ${controlMode},
           ${singleManagerException}, 1, ${now}, ${status === "ACTIVE" ? now : null})
      `;
      if (status === "ACTIVE") {
        await sql`
          insert into identity_platform_permission_grants
            (id, identity_id, permission, granted_at)
          values (${randomUUID()}, ${input.recipientIdentityId}, ${input.responsibility}, ${now})
        `;
      }
      await insertAudit(sql, {
        grantId,
        action: "GRANT_REQUESTED",
        actorIdentityId: session.identityId,
        subjectIdentityId: input.recipientIdentityId,
        reasonCode: "RESPONSIBILITY_GRANTED",
        reason: input.reason,
        singleManagerException,
        correlationId: context.correlationId,
        occurredAt: now,
      });
      if (status === "ACTIVE") {
        await insertAudit(sql, {
          grantId,
          action: "GRANT_ACTIVATED",
          actorIdentityId: session.identityId,
          subjectIdentityId: input.recipientIdentityId,
          reasonCode: "RESPONSIBILITY_GRANTED",
          reason: "فعال‌سازی مجوز مسئولیت پس از واگذاری",
          singleManagerException,
          correlationId: context.correlationId,
          occurredAt: now,
        });
      }

      const view = responsibilityGrantViewContract.parse({
        grantId,
        grantKind: "RESPONSIBILITY",
        subjectIdentityId: input.recipientIdentityId,
        requestedByIdentityId: session.identityId,
        approvedByIdentityId: null,
        revision: 1,
        singleManagerException,
        createdAt: now.toISOString(),
        activatedAt: status === "ACTIVE" ? now.toISOString() : null,
        revokedAt: null,
        status,
        responsibility: input.responsibility,
        expiresAt: null,
      });
      const event = {
        version: 1,
        eventId: randomUUID(),
        eventType:
          status === "ACTIVE"
            ? "PlatformPermissionGranted.v1"
            : "PlatformPermissionGrantRequested.v1",
        aggregateId: grantId,
        aggregateVersion: 1,
        occurredAt: now.toISOString(),
        correlationId: context.correlationId,
        causationId: context.correlationId,
        actor: { type: "IDENTITY", id: identityIdContract.parse(session.identityId) },
        payload: {
          grantKind: "RESPONSIBILITY",
          grantId,
          subjectIdentityId: identityIdContract.parse(input.recipientIdentityId),
          responsibility: input.responsibility,
          status,
          singleManagerException,
          auditRequired: true,
        },
      } as const;
      if (status === "ACTIVE") {
        await enqueueOutboxEvent(sql, platformPermissionGrantedV1Contract.parse(event));
      } else {
        await enqueueOutboxEvent(
          sql,
          platformPermissionGrantRequestedV1Contract.parse(event),
        );
      }
      await completeIdempotentCommand(
        sql,
        "request-responsibility",
        session.identityId,
        context,
        view,
      );
      return view;
    });
  }

  async approveResponsibility(
    context: PlatformAccessCommandContext,
    grantId: string,
    expectedRevision: number,
  ): Promise<PlatformAccessGrant> {
    return this.#sql.begin(async (sql) => {
      const session = await authorizeAccessAdministrator(
        sql,
        context.sessionToken,
        true,
      );
      const replay = await beginIdempotentCommand(
        sql,
        "approve-responsibility",
        session.identityId,
        context,
        { grantId, expectedRevision },
      );
      if (replay) return replay;
      const grant = await readResponsibilityGrant(sql, grantId, "update");
      if (!grant) throw new PlatformAccessError("ACCESS_GRANT_NOT_FOUND");
      if (grant.revision !== expectedRevision) {
        throw new PlatformAccessError("ACCESS_GRANT_REVISION_CONFLICT");
      }
      if (grant.status !== "PENDING_APPROVAL") {
        throw new PlatformAccessError("INVALID_ACCESS_TRANSITION");
      }
      if (
        session.identityId === grant.requestedByIdentityId ||
        session.identityId === grant.subjectIdentityId
      ) {
        throw new PlatformAccessError("SELF_APPROVAL_FORBIDDEN");
      }
      const activeManagerCount = await countActiveAccessManagers(sql);
      if (activeManagerCount < 2) {
        throw new PlatformAccessError("SECOND_MANAGER_REQUIRED");
      }
      approveResponsibilityGrantCommandContract.parse({
        grantId,
        requesterIdentityId: grant.requestedByIdentityId,
        recipientIdentityId: grant.subjectIdentityId,
        approverIdentityId: session.identityId,
        responsibility: grant.responsibility,
        activeAccessManagerCount: activeManagerCount,
        strongAuthenticationAt: session.strongAuthenticationAt.toISOString(),
      });
      const occurredAt = new Date();
      const revision = grant.revision + 1;
      await sql`
        update identity_platform_access_grants
        set status = 'ACTIVE', approved_by_identity_id = ${session.identityId},
          activated_at = ${occurredAt}, revision = ${revision}
        where id = ${grantId}
      `;
      await sql`
        insert into identity_platform_permission_grants
          (id, identity_id, permission, granted_at)
        values (${randomUUID()}, ${grant.subjectIdentityId}, ${grant.responsibility}, ${occurredAt})
      `;
      await insertAudit(sql, {
        grantId,
        action: "GRANT_APPROVED",
        actorIdentityId: session.identityId,
        subjectIdentityId: grant.subjectIdentityId,
        reasonCode: "RESPONSIBILITY_GRANTED",
        reason: "تأیید مستقل واگذاری مسئولیت پرخطر",
        singleManagerException: false,
        correlationId: context.correlationId,
        occurredAt,
      });
      await insertAudit(sql, {
        grantId,
        action: "GRANT_ACTIVATED",
        actorIdentityId: session.identityId,
        subjectIdentityId: grant.subjectIdentityId,
        reasonCode: "RESPONSIBILITY_GRANTED",
        reason: "فعال‌سازی مجوز مسئولیت پس از تأیید مستقل",
        singleManagerException: false,
        correlationId: context.correlationId,
        occurredAt,
      });
      await enqueueOutboxEvent(
        sql,
        platformPermissionGrantedV1Contract.parse({
          version: 1,
          eventId: randomUUID(),
          eventType: "PlatformPermissionGranted.v1",
          aggregateId: grantId,
          aggregateVersion: revision,
          occurredAt: occurredAt.toISOString(),
          correlationId: context.correlationId,
          causationId: context.correlationId,
          actor: { type: "IDENTITY", id: identityIdContract.parse(session.identityId) },
          payload: {
            grantKind: "RESPONSIBILITY",
            grantId,
            subjectIdentityId: identityIdContract.parse(grant.subjectIdentityId),
            responsibility: grant.responsibility,
            status: "ACTIVE",
            singleManagerException: false,
            auditRequired: true,
          },
        }),
      );
      const view = responsibilityView({
        ...grant,
        approvedByIdentityId: session.identityId,
        status: "ACTIVE",
        revision,
        activatedAt: occurredAt,
      });
      await completeIdempotentCommand(
        sql,
        "approve-responsibility",
        session.identityId,
        context,
        view,
      );
      return view;
    });
  }

  async revokeResponsibility(
    context: PlatformAccessCommandContext,
    grantId: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<PlatformAccessGrant> {
    return this.#sql.begin(async (sql) => {
      const session = await authorizeAccessAdministrator(
        sql,
        context.sessionToken,
        false,
      );
      const replay = await beginIdempotentCommand(
        sql,
        "revoke-responsibility",
        session.identityId,
        context,
        { grantId, ...input },
      );
      if (replay) return replay;
      const grant = await readResponsibilityGrant(sql, grantId, "update");
      if (!grant) throw new PlatformAccessError("ACCESS_GRANT_NOT_FOUND");
      if (grant.status === "REVOKED") {
        const view = responsibilityView(grant);
        await completeIdempotentCommand(
          sql,
          "revoke-responsibility",
          session.identityId,
          context,
          view,
        );
        return view;
      }
      revokePlatformAccessCommandContract.parse({
        grantId,
        actorIdentityId: session.identityId,
        reason: input.reason,
        expectedRevision: input.expectedRevision,
      });
      const occurredAt = new Date();
      const revision = grant.revision + 1;
      await sql`
        update identity_platform_access_grants
        set status = 'REVOKED', revoked_at = ${occurredAt}, revision = ${revision}
        where id = ${grantId}
      `;
      await sql`
        update identity_platform_permission_grants
        set revoked_at = ${occurredAt}
        where identity_id = ${grant.subjectIdentityId}
          and permission = ${grant.responsibility} and revoked_at is null
      `;
      await insertAudit(sql, {
        grantId,
        action: "GRANT_REVOKED",
        actorIdentityId: session.identityId,
        subjectIdentityId: grant.subjectIdentityId,
        reasonCode: "ACCESS_REVOKED_FOR_SAFETY",
        reason: input.reason,
        singleManagerException: grant.singleManagerException,
        correlationId: context.correlationId,
        occurredAt,
      });
      await enqueueOutboxEvent(
        sql,
        platformPermissionRevokedV1Contract.parse({
          version: 1,
          eventId: randomUUID(),
          eventType: "PlatformPermissionRevoked.v1",
          aggregateId: grantId,
          aggregateVersion: revision,
          occurredAt: occurredAt.toISOString(),
          correlationId: context.correlationId,
          causationId: context.correlationId,
          actor: { type: "IDENTITY", id: identityIdContract.parse(session.identityId) },
          payload: {
            grantKind: "RESPONSIBILITY",
            grantId,
            subjectIdentityId: identityIdContract.parse(grant.subjectIdentityId),
            responsibility: grant.responsibility,
            status: "REVOKED",
            singleManagerException: grant.singleManagerException,
            auditRequired: true,
          },
        }),
      );
      const view = responsibilityView({
        ...grant,
        status: "REVOKED",
        revision,
        revokedAt: occurredAt,
      });
      await completeIdempotentCommand(
        sql,
        "revoke-responsibility",
        session.identityId,
        context,
        view,
      );
      return view;
    });
  }

  async requestSensitiveAccess(
    context: PlatformAccessCommandContext,
    input: {
      recipientIdentityId?: string;
      responsibility: Responsibility;
      purposeCode: SensitiveGrantRow["purposeCode"];
      reason: string;
      scope: PlatformAccessScope;
      ttlMinutes: number;
    },
  ): Promise<PlatformAccessGrant> {
    return this.#sql.begin(async (sql) => {
      const session = await authorizePlatformSession(sql, context.sessionToken, true);
      const replay = await beginIdempotentCommand(
        sql,
        "request-sensitive",
        session.identityId,
        context,
        input,
      );
      if (replay) return replay;
      const subjectIdentityId = input.recipientIdentityId ?? session.identityId;
      const managerAssignment = subjectIdentityId !== session.identityId;
      if (managerAssignment) {
        await requireAccessAdministrator(sql, session.identityId);
      }
      await requireResponsibility(sql, subjectIdentityId, input.responsibility);
      const managerCount = await countActiveAccessManagers(sql);
      const controlMode = managerAssignment
        ? managerCount === 1
          ? "SINGLE_MANAGER_EXCEPTION"
          : "DIRECT_ASSIGNMENT"
        : "REQUEST_APPROVAL";
      const status = managerAssignment ? "ACTIVE" : "PENDING_APPROVAL";
      const now = new Date();
      const expiresAt = new Date(now.getTime() + input.ttlMinutes * 60_000);
      const grantId = randomUUID();
      const singleManagerException = controlMode === "SINGLE_MANAGER_EXCEPTION";
      requestSensitiveAccessCommandContract.parse({
        requesterIdentityId: session.identityId,
        recipientIdentityId: subjectIdentityId,
        responsibility: input.responsibility,
        purposeCode: input.purposeCode,
        reason: input.reason,
        scope: input.scope,
        ttlMinutes: input.ttlMinutes,
        requestMode: managerAssignment ? "MANAGER_ASSIGNMENT" : "AGENT_REQUEST",
        activeAccessManagerCount: managerCount,
        controlMode,
        strongAuthenticationAt: session.strongAuthenticationAt.toISOString(),
      });
      await sql`
        insert into identity_platform_access_grants
          (id, grant_kind, subject_identity_id, requested_by_identity_id,
           responsibility, purpose_code, scope, status, control_mode,
           single_manager_exception, revision, expires_at, created_at, activated_at)
        values
          (${grantId}, 'SENSITIVE_ACCESS', ${subjectIdentityId}, ${session.identityId},
           ${input.responsibility}, ${input.purposeCode}, ${sql.json(input.scope)},
           ${status}, ${controlMode}, ${singleManagerException}, 1, ${expiresAt},
           ${now}, ${status === "ACTIVE" ? now : null})
      `;
      await insertAudit(sql, {
        grantId,
        action: "GRANT_REQUESTED",
        actorIdentityId: session.identityId,
        subjectIdentityId,
        scope: input.scope,
        reasonCode: managerAssignment ? "CASE_ASSIGNED" : "CASE_ACCESS_REQUESTED",
        reason: input.reason,
        singleManagerException,
        correlationId: context.correlationId,
        occurredAt: now,
      });
      if (status === "ACTIVE") {
        await insertAudit(sql, {
          grantId,
          action: "GRANT_ACTIVATED",
          actorIdentityId: session.identityId,
          subjectIdentityId,
          scope: input.scope,
          reasonCode: "CASE_ACCESS_APPROVED",
          reason: "فعال‌سازی مستقیم دسترسی محدود به پرونده",
          singleManagerException,
          correlationId: context.correlationId,
          occurredAt: now,
        });
      }
      const eventBase = {
        version: 1,
        eventId: randomUUID(),
        aggregateId: grantId,
        aggregateVersion: 1,
        occurredAt: now.toISOString(),
        correlationId: context.correlationId,
        causationId: context.correlationId,
        actor: {
          type: "IDENTITY" as const,
          id: identityIdContract.parse(session.identityId),
        },
        payload: {
          grantKind: "SENSITIVE_ACCESS" as const,
          grantId,
          subjectIdentityId: identityIdContract.parse(subjectIdentityId),
          scope: input.scope,
          expiresAt: expiresAt.toISOString(),
          singleManagerException,
          auditRequired: true as const,
        },
      };
      if (status === "ACTIVE") {
        await enqueueOutboxEvent(
          sql,
          sensitiveAccessGrantedV1Contract.parse({
            ...eventBase,
            eventType: "SensitiveAccessGranted.v1",
            payload: { ...eventBase.payload, status: "ACTIVE" },
          }),
        );
      } else {
        await enqueueOutboxEvent(
          sql,
          sensitiveAccessRequestedV1Contract.parse({
            ...eventBase,
            eventType: "SensitiveAccessRequested.v1",
            payload: { ...eventBase.payload, status: "PENDING_APPROVAL" },
          }),
        );
      }
      const view = sensitiveView({
        grantId,
        subjectIdentityId,
        requestedByIdentityId: session.identityId,
        approvedByIdentityId: null,
        responsibility: input.responsibility,
        purposeCode: input.purposeCode,
        scope: input.scope,
        status,
        revision: 1,
        singleManagerException,
        createdAt: now,
        activatedAt: status === "ACTIVE" ? now : null,
        revokedAt: null,
        expiresAt,
      });
      await completeIdempotentCommand(
        sql,
        "request-sensitive",
        session.identityId,
        context,
        view,
      );
      return view;
    });
  }

  async approveSensitiveAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    expectedRevision: number,
  ): Promise<PlatformAccessGrant> {
    return this.#sql.begin(async (sql) => {
      const session = await authorizeAccessAdministrator(
        sql,
        context.sessionToken,
        true,
      );
      const replay = await beginIdempotentCommand(
        sql,
        "approve-sensitive",
        session.identityId,
        context,
        { grantId, expectedRevision },
      );
      if (replay) return replay;
      const grant = await readSensitiveGrant(sql, grantId, "update");
      if (!grant) throw new PlatformAccessError("ACCESS_GRANT_NOT_FOUND");
      if (grant.revision !== expectedRevision) {
        throw new PlatformAccessError("ACCESS_GRANT_REVISION_CONFLICT");
      }
      if (grant.status !== "PENDING_APPROVAL" || grant.expiresAt <= new Date()) {
        throw new PlatformAccessError("INVALID_ACCESS_TRANSITION");
      }
      if (
        session.identityId === grant.requestedByIdentityId ||
        session.identityId === grant.subjectIdentityId
      ) {
        throw new PlatformAccessError("SELF_APPROVAL_FORBIDDEN");
      }
      await requireResponsibility(sql, grant.subjectIdentityId, grant.responsibility);
      const activeManagerCount = await countActiveAccessManagers(sql);
      approveSensitiveAccessCommandContract.parse({
        grantId,
        requesterIdentityId: grant.requestedByIdentityId,
        recipientIdentityId: grant.subjectIdentityId,
        approverIdentityId: session.identityId,
        activeAccessManagerCount: activeManagerCount,
        strongAuthenticationAt: session.strongAuthenticationAt.toISOString(),
      });
      const occurredAt = new Date();
      const revision = grant.revision + 1;
      await sql`
        update identity_platform_access_grants
        set status = 'ACTIVE', approved_by_identity_id = ${session.identityId},
          activated_at = ${occurredAt}, revision = ${revision}
        where id = ${grantId}
      `;
      await insertAudit(sql, {
        grantId,
        action: "GRANT_APPROVED",
        actorIdentityId: session.identityId,
        subjectIdentityId: grant.subjectIdentityId,
        scope: grant.scope,
        reasonCode: "CASE_ACCESS_APPROVED",
        reason: "تأیید دسترسی محدود به پرونده مشخص",
        singleManagerException: false,
        correlationId: context.correlationId,
        occurredAt,
      });
      await insertAudit(sql, {
        grantId,
        action: "GRANT_ACTIVATED",
        actorIdentityId: session.identityId,
        subjectIdentityId: grant.subjectIdentityId,
        scope: grant.scope,
        reasonCode: "CASE_ACCESS_APPROVED",
        reason: "فعال‌سازی دسترسی محدود پس از تأیید مستقل",
        singleManagerException: false,
        correlationId: context.correlationId,
        occurredAt,
      });
      await enqueueSensitiveEvent(sql, {
        eventType: "SensitiveAccessGranted.v1",
        status: "ACTIVE",
        grant: { ...grant, status: "ACTIVE", revision, activatedAt: occurredAt },
        actorIdentityId: session.identityId,
        correlationId: context.correlationId,
        occurredAt,
      });
      const view = sensitiveView({
        ...grant,
        approvedByIdentityId: session.identityId,
        status: "ACTIVE",
        revision,
        activatedAt: occurredAt,
      });
      await completeIdempotentCommand(
        sql,
        "approve-sensitive",
        session.identityId,
        context,
        view,
      );
      return view;
    });
  }

  async revokeSensitiveAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<PlatformAccessGrant> {
    return this.#sql.begin(async (sql) => {
      const session = await authorizePlatformSession(sql, context.sessionToken, false);
      const replay = await beginIdempotentCommand(
        sql,
        "revoke-sensitive",
        session.identityId,
        context,
        { grantId, ...input },
      );
      if (replay) return replay;
      const grant = await readSensitiveGrant(sql, grantId, "update");
      if (!grant) throw new PlatformAccessError("ACCESS_GRANT_NOT_FOUND");
      if (session.identityId !== grant.subjectIdentityId) {
        await requireAccessAdministrator(sql, session.identityId);
      }
      if (grant.status === "REVOKED") {
        const view = sensitiveView(grant);
        await completeIdempotentCommand(
          sql,
          "revoke-sensitive",
          session.identityId,
          context,
          view,
        );
        return view;
      }
      revokePlatformAccessCommandContract.parse({
        grantId,
        actorIdentityId: session.identityId,
        reason: input.reason,
        expectedRevision: input.expectedRevision,
      });
      const occurredAt = new Date();
      const revision = grant.revision + 1;
      await sql`
        update identity_platform_access_grants
        set status = 'REVOKED', revoked_at = ${occurredAt}, revision = ${revision}
        where id = ${grantId}
      `;
      await insertAudit(sql, {
        grantId,
        action: "GRANT_REVOKED",
        actorIdentityId: session.identityId,
        subjectIdentityId: grant.subjectIdentityId,
        scope: grant.scope,
        reasonCode: "ACCESS_REVOKED_FOR_SAFETY",
        reason: input.reason,
        singleManagerException: grant.singleManagerException,
        correlationId: context.correlationId,
        occurredAt,
      });
      await enqueueSensitiveEvent(sql, {
        eventType: "SensitiveAccessRevoked.v1",
        status: "REVOKED",
        grant: { ...grant, status: "REVOKED", revision, revokedAt: occurredAt },
        actorIdentityId: session.identityId,
        correlationId: context.correlationId,
        occurredAt,
      });
      const view = sensitiveView({
        ...grant,
        status: "REVOKED",
        revision,
        revokedAt: occurredAt,
      });
      await completeIdempotentCommand(
        sql,
        "revoke-sensitive",
        session.identityId,
        context,
        view,
      );
      return view;
    });
  }

  async requestEmergencyAccess(
    context: PlatformAccessCommandContext,
    input: {
      incidentId: string;
      reason: string;
      scope: PlatformAccessScope;
      ttlMinutes: number;
    },
  ): Promise<PlatformAccessGrant> {
    return this.#sql.begin(async (sql) => {
      const session = await authorizeAccessAdministrator(
        sql,
        context.sessionToken,
        true,
      );
      const replay = await beginIdempotentCommand(
        sql,
        "request-emergency",
        session.identityId,
        context,
        input,
      );
      if (replay) return replay;
      if (await hasOverdueEmergencyReview(sql, session.identityId)) {
        throw new PlatformAccessError("EMERGENCY_REVIEW_OVERDUE");
      }
      const activeManagerCount = await countActiveAccessManagers(sql);
      const controlMode =
        activeManagerCount === 1 ? "SINGLE_MANAGER_EXCEPTION" : "DUAL_CONTROL";
      requestEmergencyAccessCommandContract.parse({
        requesterIdentityId: session.identityId,
        incidentId: input.incidentId,
        reason: input.reason,
        scope: input.scope,
        ttlMinutes: input.ttlMinutes,
        activeAccessManagerCount: activeManagerCount,
        controlMode,
        strongAuthenticationAt: session.strongAuthenticationAt.toISOString(),
      });
      const occurredAt = new Date();
      const expiresAt = new Date(occurredAt.getTime() + input.ttlMinutes * 60_000);
      const reviewDueAt = new Date(occurredAt.getTime() + 24 * 60 * 60_000);
      const grantId = randomUUID();
      const singleManagerException = controlMode === "SINGLE_MANAGER_EXCEPTION";
      await sql`
        insert into identity_platform_access_grants
          (id, grant_kind, subject_identity_id, requested_by_identity_id,
           incident_id, scope, status, control_mode, single_manager_exception,
           revision, expires_at, review_due_at, created_at)
        values
          (${grantId}, 'EMERGENCY_ACCESS', ${session.identityId},
           ${session.identityId}, ${input.incidentId}, ${sql.json(input.scope)},
           'PENDING_APPROVAL', ${controlMode}, ${singleManagerException}, 1,
           ${expiresAt}, ${reviewDueAt}, ${occurredAt})
      `;
      await insertAudit(sql, {
        grantId,
        action: "GRANT_REQUESTED",
        actorIdentityId: session.identityId,
        subjectIdentityId: session.identityId,
        scope: input.scope,
        reasonCode: "INCIDENT_CONTAINMENT",
        reason: input.reason,
        singleManagerException,
        correlationId: context.correlationId,
        occurredAt,
      });
      const grant: EmergencyGrantRow = {
        grantId,
        subjectIdentityId: session.identityId,
        requestedByIdentityId: session.identityId,
        approvedByIdentityId: null,
        incidentId: input.incidentId,
        scope: input.scope,
        status: "PENDING_APPROVAL",
        revision: 1,
        singleManagerException,
        createdAt: occurredAt,
        activatedAt: null,
        revokedAt: null,
        expiresAt,
        reviewDueAt,
        reviewedAt: null,
        reviewMode: null,
        rejectedAt: null,
      };
      await enqueueEmergencyEvent(sql, {
        eventType: "EmergencyAccessRequested.v1",
        status: "PENDING_APPROVAL",
        grant,
        actorIdentityId: session.identityId,
        correlationId: context.correlationId,
        occurredAt,
      });
      const view = emergencyView(grant);
      await completeIdempotentCommand(
        sql,
        "request-emergency",
        session.identityId,
        context,
        view,
      );
      return view;
    });
  }

  async listEmergencyAccess(
    context: Omit<PlatformAccessCommandContext, "idempotencyKey">,
    query: {
      subjectIdentityId?: string;
      status?: "PENDING_APPROVAL" | "ACTIVE" | "EXPIRED" | "REVOKED" | "CLOSED";
      cursor?: string;
      limit: number;
    },
  ): Promise<{ items: PlatformAccessGrant[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeAccessCursor(query.cursor) : undefined;
    return this.#sql.begin(async (sql) => {
      await authorizeAccessAdministrator(sql, context.sessionToken, false);
      await expireDueEmergencyGrants(sql, context.correlationId);
      const subjectFilter = query.subjectIdentityId
        ? sql`and subject_identity_id = ${query.subjectIdentityId}`
        : sql``;
      const statusFilter = query.status ? sql`and status = ${query.status}` : sql``;
      const cursorFilter = cursor
        ? sql`and (created_at, id) < (${cursor.createdAt}, ${cursor.grantId})`
        : sql``;
      const rows = await sql<EmergencyGrantRow[]>`
        select id as "grantId", subject_identity_id as "subjectIdentityId",
          requested_by_identity_id as "requestedByIdentityId",
          approved_by_identity_id as "approvedByIdentityId",
          incident_id as "incidentId", scope, status, revision,
          single_manager_exception as "singleManagerException",
          created_at as "createdAt", activated_at as "activatedAt",
          revoked_at as "revokedAt", expires_at as "expiresAt",
          review_due_at as "reviewDueAt", reviewed_at as "reviewedAt",
          review_mode as "reviewMode", rejected_at as "rejectedAt"
        from identity_platform_access_grants
        where grant_kind = 'EMERGENCY_ACCESS' and rejected_at is null
          ${subjectFilter} ${statusFilter} ${cursorFilter}
        order by created_at desc, id desc
        limit ${query.limit + 1}
      `;
      const pageRows = rows.slice(0, query.limit);
      const last = pageRows.at(-1);
      return {
        items: pageRows.map(emergencyView),
        nextCursor:
          rows.length > query.limit && last
            ? encodeAccessCursor(last.createdAt, last.grantId)
            : null,
      };
    });
  }

  async approveEmergencyAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    expectedRevision: number,
  ): Promise<PlatformAccessGrant> {
    return this.#sql.begin(async (sql) => {
      const session = await authorizeAccessAdministrator(
        sql,
        context.sessionToken,
        true,
      );
      const replay = await beginIdempotentCommand(
        sql,
        "approve-emergency",
        session.identityId,
        context,
        { grantId, expectedRevision },
      );
      if (replay) return replay;
      const grant = await readEmergencyGrant(sql, grantId, "update");
      if (!grant) throw new PlatformAccessError("ACCESS_GRANT_NOT_FOUND");
      if (grant.revision !== expectedRevision) {
        throw new PlatformAccessError("ACCESS_GRANT_REVISION_CONFLICT");
      }
      if (
        grant.status !== "PENDING_APPROVAL" ||
        grant.singleManagerException ||
        grant.rejectedAt ||
        grant.approvedByIdentityId ||
        grant.expiresAt <= new Date()
      ) {
        throw new PlatformAccessError("INVALID_ACCESS_TRANSITION");
      }
      const activeAccessManagerCount = await countActiveAccessManagers(sql);
      if (activeAccessManagerCount < 2) {
        throw new PlatformAccessError("SECOND_MANAGER_REQUIRED");
      }
      if (session.identityId === grant.requestedByIdentityId) {
        throw new PlatformAccessError("SELF_APPROVAL_FORBIDDEN");
      }
      approveEmergencyAccessCommandContract.parse({
        grantId,
        requesterIdentityId: grant.requestedByIdentityId,
        approverIdentityId: session.identityId,
        activeAccessManagerCount,
        strongAuthenticationAt: session.strongAuthenticationAt.toISOString(),
      });
      const occurredAt = new Date();
      const revision = grant.revision + 1;
      await sql`
        update identity_platform_access_grants
        set approved_by_identity_id = ${session.identityId}, revision = ${revision}
        where id = ${grantId}
      `;
      await insertAudit(sql, {
        grantId,
        action: "GRANT_APPROVED",
        actorIdentityId: session.identityId,
        subjectIdentityId: grant.subjectIdentityId,
        scope: grant.scope,
        reasonCode: "INCIDENT_CONTAINMENT",
        reason: "تأیید مستقل دسترسی اضطراری برای مهار حادثه",
        singleManagerException: false,
        correlationId: context.correlationId,
        occurredAt,
      });
      const view = emergencyView({
        ...grant,
        approvedByIdentityId: session.identityId,
        revision,
      });
      await completeIdempotentCommand(
        sql,
        "approve-emergency",
        session.identityId,
        context,
        view,
      );
      return view;
    });
  }

  async activateEmergencyAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    expectedRevision: number,
  ): Promise<PlatformAccessGrant> {
    return this.#sql.begin(async (sql) => {
      const session = await authorizeAccessAdministrator(
        sql,
        context.sessionToken,
        true,
      );
      const replay = await beginIdempotentCommand(
        sql,
        "activate-emergency",
        session.identityId,
        context,
        { grantId, expectedRevision },
      );
      if (replay) return replay;
      const grant = await readEmergencyGrant(sql, grantId, "update");
      if (!grant) throw new PlatformAccessError("ACCESS_GRANT_NOT_FOUND");
      if (grant.revision !== expectedRevision) {
        throw new PlatformAccessError("ACCESS_GRANT_REVISION_CONFLICT");
      }
      if (
        grant.status !== "PENDING_APPROVAL" ||
        grant.rejectedAt ||
        grant.expiresAt <= new Date() ||
        session.identityId !== grant.requestedByIdentityId ||
        (!grant.singleManagerException && !grant.approvedByIdentityId)
      ) {
        throw new PlatformAccessError("INVALID_ACCESS_TRANSITION");
      }
      const activeAccessManagerCount = await countActiveAccessManagers(sql);
      if (
        (grant.singleManagerException && activeAccessManagerCount !== 1) ||
        (!grant.singleManagerException && activeAccessManagerCount < 2)
      ) {
        throw new PlatformAccessError("INVALID_ACCESS_TRANSITION");
      }
      emergencyAccessActivationCommandContract.parse({
        grantId,
        requesterIdentityId: grant.requestedByIdentityId,
        activatorIdentityId: session.identityId,
        ...(grant.approvedByIdentityId
          ? { approverIdentityId: grant.approvedByIdentityId }
          : {}),
        activeAccessManagerCount,
        controlMode: grant.singleManagerException
          ? "SINGLE_MANAGER_EXCEPTION"
          : "DUAL_CONTROL",
        strongAuthenticationAt: session.strongAuthenticationAt.toISOString(),
      });
      const occurredAt = new Date();
      const revision = grant.revision + 1;
      await sql`
        update identity_platform_access_grants
        set status = 'ACTIVE', activated_at = ${occurredAt}, revision = ${revision}
        where id = ${grantId}
      `;
      await insertAudit(sql, {
        grantId,
        action: "GRANT_ACTIVATED",
        actorIdentityId: session.identityId,
        subjectIdentityId: grant.subjectIdentityId,
        scope: grant.scope,
        reasonCode: "INCIDENT_CONTAINMENT",
        reason: "فعال‌سازی دسترسی اضطراری محدود به حادثه",
        singleManagerException: grant.singleManagerException,
        correlationId: context.correlationId,
        occurredAt,
      });
      const activatedGrant: EmergencyGrantRow = {
        ...grant,
        status: "ACTIVE",
        revision,
        activatedAt: occurredAt,
      };
      await enqueueEmergencyEvent(sql, {
        eventType: "EmergencyAccessActivated.v1",
        status: "ACTIVE",
        grant: activatedGrant,
        actorIdentityId: session.identityId,
        correlationId: context.correlationId,
        occurredAt,
      });
      const view = emergencyView(activatedGrant);
      await completeIdempotentCommand(
        sql,
        "activate-emergency",
        session.identityId,
        context,
        view,
      );
      return view;
    });
  }

  async revokeEmergencyAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<PlatformAccessGrant> {
    return this.#terminalEmergencyCommand(
      "revoke-emergency",
      "REVOKED",
      context,
      grantId,
      input,
    );
  }

  async closeEmergencyAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<PlatformAccessGrant> {
    return this.#terminalEmergencyCommand(
      "close-emergency",
      "CLOSED",
      context,
      grantId,
      input,
    );
  }

  async rejectEmergencyAccess(
    context: PlatformAccessCommandContext,
    grantId: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<PlatformAccessRejection> {
    return this.#sql.begin(async (sql) => {
      const session = await authorizeAccessAdministrator(
        sql,
        context.sessionToken,
        true,
      );
      const replay = await beginIdempotentRejectionCommand(
        sql,
        "reject-emergency",
        session.identityId,
        context,
        { grantId, ...input },
      );
      if (replay) return replay;
      const grant = await readEmergencyGrant(sql, grantId, "update");
      if (!grant) throw new PlatformAccessError("ACCESS_GRANT_NOT_FOUND");
      if (grant.revision !== input.expectedRevision) {
        throw new PlatformAccessError("ACCESS_GRANT_REVISION_CONFLICT");
      }
      if (grant.status !== "PENDING_APPROVAL" || grant.rejectedAt) {
        throw new PlatformAccessError("INVALID_ACCESS_TRANSITION");
      }
      if (session.identityId === grant.requestedByIdentityId) {
        throw new PlatformAccessError("SELF_APPROVAL_FORBIDDEN");
      }
      rejectPlatformAccessCommandContract.parse({
        grantId,
        requesterIdentityId: grant.requestedByIdentityId,
        recipientIdentityId: grant.subjectIdentityId,
        reviewerIdentityId: session.identityId,
        reason: input.reason,
        expectedRevision: input.expectedRevision,
      });
      const occurredAt = new Date();
      const revision = grant.revision + 1;
      await sql`
        update identity_platform_access_grants
        set rejected_at = ${occurredAt}, revision = ${revision}
        where id = ${grantId}
      `;
      await insertAudit(sql, {
        grantId,
        action: "GRANT_REJECTED",
        actorIdentityId: session.identityId,
        subjectIdentityId: grant.subjectIdentityId,
        scope: grant.scope,
        reasonCode: "ACCESS_REQUEST_REJECTED",
        reason: input.reason,
        singleManagerException: grant.singleManagerException,
        correlationId: context.correlationId,
        occurredAt,
      });
      await enqueueOutboxEvent(
        sql,
        emergencyAccessRejectedV1Contract.parse({
          version: 1,
          eventId: randomUUID(),
          eventType: "EmergencyAccessRejected.v1",
          aggregateId: grantId,
          aggregateVersion: revision,
          occurredAt: occurredAt.toISOString(),
          correlationId: context.correlationId,
          causationId: context.correlationId,
          actor: {
            type: "IDENTITY",
            id: identityIdContract.parse(session.identityId),
          },
          payload: {
            grantKind: "EMERGENCY_ACCESS",
            grantId,
            subjectIdentityId: identityIdContract.parse(grant.subjectIdentityId),
            requestStatus: "REJECTED",
            auditRequired: true,
          },
        }),
      );
      const response = platformAccessRejectionContract.parse({
        grantId,
        grantKind: "EMERGENCY_ACCESS",
        requestStatus: "REJECTED",
        revision,
        rejectedAt: occurredAt.toISOString(),
      });
      await completeIdempotentRejectionCommand(
        sql,
        "reject-emergency",
        session.identityId,
        context,
        response,
      );
      return response;
    });
  }

  async #terminalEmergencyCommand(
    operation: "revoke-emergency" | "close-emergency",
    nextStatus: "REVOKED" | "CLOSED",
    context: PlatformAccessCommandContext,
    grantId: string,
    input: { expectedRevision: number; reason: string },
  ): Promise<PlatformAccessGrant> {
    return this.#sql.begin(async (sql) => {
      const session = await authorizePlatformSession(sql, context.sessionToken, false);
      const replay = await beginIdempotentCommand(
        sql,
        operation,
        session.identityId,
        context,
        { grantId, ...input },
      );
      if (replay) return replay;
      const grant = await readEmergencyGrant(sql, grantId, "update");
      if (!grant) throw new PlatformAccessError("ACCESS_GRANT_NOT_FOUND");
      if (grant.rejectedAt) {
        throw new PlatformAccessError("INVALID_ACCESS_TRANSITION");
      }
      if (session.identityId !== grant.subjectIdentityId) {
        await requireAccessAdministrator(sql, session.identityId);
      }
      if (grant.status === nextStatus) {
        const view = emergencyView(grant);
        await completeIdempotentCommand(
          sql,
          operation,
          session.identityId,
          context,
          view,
        );
        return view;
      }
      if (grant.revision !== input.expectedRevision) {
        throw new PlatformAccessError("ACCESS_GRANT_REVISION_CONFLICT");
      }
      if (nextStatus === "CLOSED" && grant.status !== "ACTIVE") {
        throw new PlatformAccessError("INVALID_ACCESS_TRANSITION");
      }
      if (
        nextStatus === "REVOKED" &&
        grant.status !== "PENDING_APPROVAL" &&
        grant.status !== "ACTIVE"
      ) {
        throw new PlatformAccessError("INVALID_ACCESS_TRANSITION");
      }
      if (nextStatus === "CLOSED") {
        closeEmergencyAccessCommandContract.parse({
          grantId,
          actorIdentityId: session.identityId,
          ...input,
        });
      } else {
        revokePlatformAccessCommandContract.parse({
          grantId,
          actorIdentityId: session.identityId,
          ...input,
        });
      }
      const occurredAt = new Date();
      const revision = grant.revision + 1;
      await sql`
        update identity_platform_access_grants
        set status = ${nextStatus},
          revoked_at = ${nextStatus === "REVOKED" ? occurredAt : null},
          revision = ${revision}
        where id = ${grantId}
      `;
      await insertAudit(sql, {
        grantId,
        action: nextStatus === "REVOKED" ? "GRANT_REVOKED" : "EMERGENCY_ACCESS_CLOSED",
        actorIdentityId: session.identityId,
        subjectIdentityId: grant.subjectIdentityId,
        scope: grant.scope,
        reasonCode:
          nextStatus === "REVOKED"
            ? "ACCESS_REVOKED_FOR_SAFETY"
            : "INCIDENT_CONTAINMENT",
        reason: input.reason,
        singleManagerException: grant.singleManagerException,
        correlationId: context.correlationId,
        occurredAt,
      });
      const terminalGrant: EmergencyGrantRow = {
        ...grant,
        status: nextStatus,
        revision,
        revokedAt: nextStatus === "REVOKED" ? occurredAt : null,
      };
      await enqueueEmergencyEvent(sql, {
        eventType:
          nextStatus === "REVOKED"
            ? "EmergencyAccessRevoked.v1"
            : "EmergencyAccessClosed.v1",
        status: nextStatus,
        grant: terminalGrant,
        actorIdentityId: session.identityId,
        correlationId: context.correlationId,
        occurredAt,
      });
      const view = emergencyView(terminalGrant);
      await completeIdempotentCommand(
        sql,
        operation,
        session.identityId,
        context,
        view,
      );
      return view;
    });
  }

  async completeEmergencyAccessReview(
    context: PlatformAccessCommandContext,
    grantId: string,
    input: {
      expectedRevision: number;
      findingCode:
        | "CONTROLS_FOLLOWED"
        | "SCOPE_EXCEEDED"
        | "AUDIT_INCOMPLETE"
        | "FOLLOW_UP_REQUIRED";
    },
  ): Promise<PlatformAccessGrant> {
    await this.#expireEmergencyGrantIfDue(grantId);
    return this.#sql.begin(async (sql) => {
      const session = await authorizePlatformSession(sql, context.sessionToken, false);
      await requireResponsibility(sql, session.identityId, "ACCESS_AUDIT_REVIEW");
      const replay = await beginIdempotentCommand(
        sql,
        "review-emergency",
        session.identityId,
        context,
        { grantId, ...input },
      );
      if (replay) return replay;
      const grant = await readEmergencyGrant(sql, grantId, "update");
      if (!grant) throw new PlatformAccessError("ACCESS_GRANT_NOT_FOUND");
      if (grant.revision !== input.expectedRevision) {
        throw new PlatformAccessError("ACCESS_GRANT_REVISION_CONFLICT");
      }
      const replacesSelfReview =
        grant.reviewedAt !== null &&
        grant.reviewMode === "WITHOUT_INDEPENDENT_REVIEW" &&
        session.identityId !== grant.requestedByIdentityId &&
        session.identityId !== grant.approvedByIdentityId;
      if (
        (grant.reviewedAt !== null && !replacesSelfReview) ||
        !grant.activatedAt ||
        !["EXPIRED", "REVOKED", "CLOSED"].includes(grant.status)
      ) {
        throw new PlatformAccessError("INVALID_ACCESS_TRANSITION");
      }
      const availableHumanReviewerCount = await countActivePlatformHumans(sql);
      const reviewMode =
        availableHumanReviewerCount === 1 &&
        session.identityId === grant.requestedByIdentityId &&
        grant.approvedByIdentityId === null
          ? "WITHOUT_INDEPENDENT_REVIEW"
          : "INDEPENDENT";
      if (
        reviewMode === "INDEPENDENT" &&
        (session.identityId === grant.requestedByIdentityId ||
          session.identityId === grant.approvedByIdentityId)
      ) {
        throw new PlatformAccessError("SELF_APPROVAL_FORBIDDEN");
      }
      const occurredAt = new Date();
      completeEmergencyAccessReviewCommandContract.parse({
        grantId,
        requesterIdentityId: grant.requestedByIdentityId,
        approverIdentityId: grant.approvedByIdentityId,
        reviewerIdentityId: session.identityId,
        reviewMode,
        availableHumanReviewerCount,
        findingCode: input.findingCode,
        reviewDueAt: grant.reviewDueAt.toISOString(),
        reviewedAt: occurredAt.toISOString(),
        expectedRevision: input.expectedRevision,
      });
      const priorReviews = await sql<Array<{ reviewId: string }>>`
        select id as "reviewId"
        from identity_platform_emergency_access_reviews
        where grant_id = ${grantId}
        order by reviewed_at desc, id desc
        limit 1
        for share
      `;
      const reviewId = randomUUID();
      await sql`
        insert into identity_platform_emergency_access_reviews
          (id, grant_id, reviewer_identity_id, review_mode, finding_code,
           review_due_at, reviewed_at, supersedes_review_id, correlation_id)
        values
          (${reviewId}, ${grantId}, ${session.identityId}, ${reviewMode},
           ${input.findingCode}, ${grant.reviewDueAt}, ${occurredAt},
           ${priorReviews[0]?.reviewId ?? null}, ${context.correlationId})
      `;
      const revision = grant.revision + 1;
      await sql`
        update identity_platform_access_grants
        set reviewed_at = ${occurredAt}, reviewed_by_identity_id = ${session.identityId},
          review_mode = ${reviewMode}, review_finding_code = ${input.findingCode},
          revision = ${revision}
        where id = ${grantId}
      `;
      await insertAudit(sql, {
        grantId,
        action: "POST_INCIDENT_REVIEW_COMPLETED",
        actorIdentityId: session.identityId,
        subjectIdentityId: grant.subjectIdentityId,
        scope: grant.scope,
        reasonCode: "POST_INCIDENT_REVIEW",
        reason: "ثبت نتیجه بازبینی پس از دسترسی اضطراری",
        singleManagerException: grant.singleManagerException,
        correlationId: context.correlationId,
        occurredAt,
      });
      const reviewedGrant: EmergencyGrantRow = {
        ...grant,
        revision,
        reviewedAt: occurredAt,
        reviewMode,
      };
      const view = emergencyView(reviewedGrant);
      await completeIdempotentCommand(
        sql,
        "review-emergency",
        session.identityId,
        context,
        view,
      );
      return view;
    });
  }

  async authorizeEmergencyAction(
    transaction: OpaquePlatformAccessTransactionContext,
    input: PlatformEmergencyAction,
  ): Promise<void> {
    await this.#expireEmergencyGrantIfDue(input.grantId);
    const sql = readOpaquePlatformAccessTransaction(transaction);
    const grant = await readAuthorizedEmergencyGrant(sql, input);
    if (!grant) {
      await this.#auditDeniedEmergencyAction(input);
      throw new PlatformAccessError("EMERGENCY_SCOPE_REQUIRED");
    }
    await insertAudit(sql, {
      grantId: grant.grantId,
      action: accessAuditAction(input.action),
      actorIdentityId: input.actorIdentityId,
      subjectIdentityId: grant.subjectIdentityId,
      scope: grant.scope,
      reasonCode: "INCIDENT_CONTAINMENT",
      reason: input.reason,
      singleManagerException: grant.singleManagerException,
      correlationId: input.correlationId,
      occurredAt: grant.accessedAt,
    });
  }

  async #auditDeniedEmergencyAction(input: PlatformEmergencyAction): Promise<void> {
    await this.#sql.begin(async (sql) => {
      const grant = await readEmergencyGrant(sql, input.grantId, "none");
      if (!grant) {
        await insertUnresolvedEmergencyDenial(sql, input);
        return;
      }
      await insertAudit(sql, {
        grantId: grant.grantId,
        action: accessAuditAction(input.action),
        actorIdentityId: input.actorIdentityId,
        subjectIdentityId: grant.subjectIdentityId,
        scope: {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          allowedActions: [input.action],
        },
        reasonCode:
          grant.status === "REVOKED"
            ? "ACCESS_REVOKED_FOR_SAFETY"
            : "ACCESS_REQUEST_REJECTED",
        reason: input.reason,
        outcome: grant.status === "REVOKED" ? "STOPPED_AFTER_REVOCATION" : "DENIED",
        singleManagerException: grant.singleManagerException,
        correlationId: input.correlationId,
        occurredAt: new Date(),
      });
    });
  }

  async #expireEmergencyGrantIfDue(grantId: string): Promise<void> {
    await this.#sql.begin(async (sql) => {
      const grant = await readEmergencyGrant(sql, grantId, "update");
      const occurredAt = await readDatabaseClock(sql);
      if (!grant || grant.status !== "ACTIVE" || grant.expiresAt > occurredAt) return;
      const revision = grant.revision + 1;
      const correlationId = randomUUID();
      const expiredGrant: EmergencyGrantRow = {
        ...grant,
        status: "EXPIRED",
        revision,
      };
      await sql`
        update identity_platform_access_grants
        set status = 'EXPIRED', revision = ${revision}
        where id = ${grantId}
      `;
      await insertAudit(sql, {
        grantId,
        action: "GRANT_EXPIRED",
        actorIdentityId: grant.subjectIdentityId,
        subjectIdentityId: grant.subjectIdentityId,
        scope: grant.scope,
        reasonCode: "TTL_EXPIRED",
        reason: "پایان خودکار مهلت دسترسی اضطراری",
        singleManagerException: grant.singleManagerException,
        correlationId,
        occurredAt,
      });
      await enqueueEmergencyEvent(sql, {
        eventType: "EmergencyAccessExpired.v1",
        status: "EXPIRED",
        grant: expiredGrant,
        actorIdentityId: null,
        correlationId,
        occurredAt,
      });
    });
  }

  async authorizeSensitiveAction(
    transaction: OpaquePlatformAccessTransactionContext,
    input: PlatformSensitiveAction,
  ): Promise<SensitiveAccessAuthorizationReceipt> {
    const sql = readOpaquePlatformAccessTransaction(transaction);
    const permissionIsLive = await lockSensitiveActionPermission(sql, input);
    if (!permissionIsLive) return this.#denySensitiveAction(input);
    const grant = await readAuthorizedSensitiveGrant(sql, input);
    if (!grant) {
      await this.#expireSensitiveGrantIfDue(input.grantId);
      return this.#denySensitiveAction(input);
    }
    const accessedAt = grant.accessedAt;
    await insertAudit(sql, {
      grantId: grant.grantId,
      action: accessAuditAction(input.action),
      actorIdentityId: input.actorIdentityId,
      subjectIdentityId: input.actorIdentityId,
      scope: grant.scope,
      reasonCode: "CASE_ACCESS_APPROVED",
      reason: input.reason,
      singleManagerException: grant.singleManagerException,
      correlationId: input.correlationId,
      occurredAt: accessedAt,
    });
    return sensitiveAccessAuthorizationReceiptContract.parse({
      grantId: grant.grantId,
      scope: {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        allowedActions: [input.action],
      },
      accessedAt: accessedAt.toISOString(),
      expiresAt: grant.expiresAt.toISOString(),
    });
  }

  async #denySensitiveAction(input: PlatformSensitiveAction): Promise<never> {
    const denialCode = await this.#auditDeniedSensitiveAction(input);
    throw new PlatformAccessError(denialCode);
  }

  async #auditDeniedSensitiveAction(
    input: PlatformSensitiveAction,
  ): Promise<"RESPONSIBILITY_REQUIRED" | "SENSITIVE_SCOPE_REQUIRED"> {
    return this.#sql.begin(async (sql) => {
      const grant = await readSensitiveGrant(sql, input.grantId, "none");
      if (!grant) {
        await insertUnresolvedSensitiveDenial(sql, input);
        return "SENSITIVE_SCOPE_REQUIRED";
      }
      const scopeMatches = sensitiveGrantMatchesAction(grant, input);
      const responsibilityGranted = scopeMatches
        ? await hasResponsibility(sql, input.actorIdentityId, input.responsibility)
        : false;
      const stoppedAfterRevocation = grant.status === "REVOKED";
      await insertAudit(sql, {
        grantId: grant.grantId,
        action: accessAuditAction(input.action),
        actorIdentityId: input.actorIdentityId,
        subjectIdentityId: grant.subjectIdentityId,
        scope: {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          allowedActions: [input.action],
        },
        reasonCode: stoppedAfterRevocation
          ? "ACCESS_REVOKED_FOR_SAFETY"
          : "ACCESS_REQUEST_REJECTED",
        reason: input.reason,
        outcome: stoppedAfterRevocation ? "STOPPED_AFTER_REVOCATION" : "DENIED",
        singleManagerException: grant.singleManagerException,
        correlationId: input.correlationId,
        occurredAt: new Date(),
      });
      return scopeMatches && !responsibilityGranted
        ? "RESPONSIBILITY_REQUIRED"
        : "SENSITIVE_SCOPE_REQUIRED";
    });
  }

  async #expireSensitiveGrantIfDue(grantId: string): Promise<void> {
    await this.#sql.begin(async (sql) => {
      const grant = await readSensitiveGrant(sql, grantId, "update");
      const occurredAt = await readDatabaseClock(sql);
      if (!grant || grant.status !== "ACTIVE" || grant.expiresAt > occurredAt) return;
      const revision = grant.revision + 1;
      const correlationId = randomUUID();
      const expiredGrant: SensitiveGrantRow = {
        ...grant,
        status: "EXPIRED",
        revision,
      };
      await sql`
        update identity_platform_access_grants
        set status = 'EXPIRED', revision = ${revision}
        where id = ${grantId}
      `;
      await insertAudit(sql, {
        grantId,
        action: "GRANT_EXPIRED",
        actorIdentityId: grant.subjectIdentityId,
        subjectIdentityId: grant.subjectIdentityId,
        scope: grant.scope,
        reasonCode: "TTL_EXPIRED",
        reason: "پایان خودکار مهلت اجازه دسترسی حساس",
        singleManagerException: grant.singleManagerException,
        correlationId,
        occurredAt,
      });
      await enqueueSensitiveEvent(sql, {
        eventType: "SensitiveAccessExpired.v1",
        status: "EXPIRED",
        grant: expiredGrant,
        actorIdentityId: null,
        correlationId,
        occurredAt,
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.#sql.end();
  }
}

async function readResponsibilityGrant(
  sql: Sql,
  grantId: string,
  lock: "update" | "share",
): Promise<ResponsibilityGrantRow | undefined> {
  const lockSql = lock === "update" ? sql`for update` : sql`for share`;
  const rows = await sql<ResponsibilityGrantRow[]>`
    select id as "grantId", subject_identity_id as "subjectIdentityId",
      requested_by_identity_id as "requestedByIdentityId",
      approved_by_identity_id as "approvedByIdentityId", responsibility, status,
      revision, single_manager_exception as "singleManagerException",
      created_at as "createdAt", activated_at as "activatedAt", revoked_at as "revokedAt"
    from identity_platform_access_grants
    where id = ${grantId} and grant_kind = 'RESPONSIBILITY'
    ${lockSql}
  `;
  return rows[0];
}

async function readSensitiveGrant(
  sql: Sql,
  grantId: string,
  lock: "update" | "share" | "none",
): Promise<SensitiveGrantRow | undefined> {
  const lockSql =
    lock === "update" ? sql`for update` : lock === "share" ? sql`for share` : sql``;
  const rows = await sql<SensitiveGrantRow[]>`
    select id as "grantId", subject_identity_id as "subjectIdentityId",
      requested_by_identity_id as "requestedByIdentityId",
      approved_by_identity_id as "approvedByIdentityId", responsibility,
      purpose_code as "purposeCode", scope, status, revision,
      single_manager_exception as "singleManagerException",
      created_at as "createdAt", activated_at as "activatedAt",
      revoked_at as "revokedAt", expires_at as "expiresAt"
    from identity_platform_access_grants
    where id = ${grantId} and grant_kind = 'SENSITIVE_ACCESS'
    ${lockSql}
  `;
  return rows[0];
}

async function readEmergencyGrant(
  sql: Sql,
  grantId: string,
  lock: "update" | "share" | "none",
): Promise<EmergencyGrantRow | undefined> {
  const lockSql =
    lock === "update" ? sql`for update` : lock === "share" ? sql`for share` : sql``;
  const rows = await sql<EmergencyGrantRow[]>`
    select id as "grantId", subject_identity_id as "subjectIdentityId",
      requested_by_identity_id as "requestedByIdentityId",
      approved_by_identity_id as "approvedByIdentityId",
      incident_id as "incidentId", scope, status, revision,
      single_manager_exception as "singleManagerException",
      created_at as "createdAt", activated_at as "activatedAt",
      revoked_at as "revokedAt", expires_at as "expiresAt",
      review_due_at as "reviewDueAt", reviewed_at as "reviewedAt",
      review_mode as "reviewMode", rejected_at as "rejectedAt"
    from identity_platform_access_grants
    where id = ${grantId} and grant_kind = 'EMERGENCY_ACCESS'
    ${lockSql}
  `;
  return rows[0];
}

async function readAuthorizedSensitiveGrant(
  sql: Sql,
  input: PlatformSensitiveAction,
): Promise<AuthorizedSensitiveGrantRow | undefined> {
  await sql`savepoint sensitive_authorization_grant_lock`;
  const rows = await sql<SensitiveGrantRow[]>`
    select g.id as "grantId", g.subject_identity_id as "subjectIdentityId",
      g.requested_by_identity_id as "requestedByIdentityId",
      g.approved_by_identity_id as "approvedByIdentityId", g.responsibility,
      g.purpose_code as "purposeCode", g.scope, g.status, g.revision,
      g.single_manager_exception as "singleManagerException",
      g.created_at as "createdAt", g.activated_at as "activatedAt",
      g.revoked_at as "revokedAt", g.expires_at as "expiresAt"
    from identity_platform_access_grants g
    where g.id = ${input.grantId} and g.grant_kind = 'SENSITIVE_ACCESS'
      and g.status = 'ACTIVE'
      and g.subject_identity_id = ${input.actorIdentityId}
      and g.responsibility = ${input.responsibility}
      and g.scope ->> 'resourceType' = ${input.resourceType}
      and g.scope ->> 'resourceId' = ${input.resourceId}
      and g.scope -> 'allowedActions' @> ${sql.json([input.action])}::jsonb
    for share of g
  `;
  const accessedAt = await readDatabaseClock(sql);
  const grant = rows[0];
  if (!grant || grant.expiresAt <= accessedAt) {
    await sql`rollback to savepoint sensitive_authorization_grant_lock`;
    await sql`release savepoint sensitive_authorization_grant_lock`;
    return undefined;
  }
  await sql`release savepoint sensitive_authorization_grant_lock`;
  return { ...grant, accessedAt };
}

async function lockSensitiveActionPermission(
  sql: Sql,
  input: PlatformSensitiveAction,
): Promise<boolean> {
  const rows = await sql<Array<{ permissionId: string }>>`
    select p.id as "permissionId"
    from identity_platform_permission_grants p
    join identity_identities i
      on i.id = p.identity_id and i.status = 'ACTIVE'
    where p.identity_id = ${input.actorIdentityId}
      and p.permission = ${input.responsibility}
      and p.revoked_at is null
    for share of p
  `;
  return rows.length > 0;
}

async function readDatabaseClock(sql: Sql): Promise<Date> {
  const rows = await sql<Array<{ accessedAt: Date }>>`
    select clock_timestamp() as "accessedAt"
  `;
  return rows[0]!.accessedAt;
}

async function readAuthorizedEmergencyGrant(
  sql: Sql,
  input: PlatformEmergencyAction,
): Promise<AuthorizedEmergencyGrantRow | undefined> {
  await sql`savepoint emergency_authorization_grant_lock`;
  const rows = await sql<EmergencyGrantRow[]>`
    select g.id as "grantId", g.subject_identity_id as "subjectIdentityId",
      g.requested_by_identity_id as "requestedByIdentityId",
      g.approved_by_identity_id as "approvedByIdentityId",
      g.incident_id as "incidentId", g.scope, g.status, g.revision,
      g.single_manager_exception as "singleManagerException",
      g.created_at as "createdAt", g.activated_at as "activatedAt",
      g.revoked_at as "revokedAt", g.expires_at as "expiresAt",
      g.review_due_at as "reviewDueAt", g.reviewed_at as "reviewedAt",
      g.review_mode as "reviewMode", g.rejected_at as "rejectedAt"
    from identity_platform_access_grants g
    join identity_identities i
      on i.id = ${input.actorIdentityId} and i.status = 'ACTIVE'
    where g.id = ${input.grantId} and g.grant_kind = 'EMERGENCY_ACCESS'
      and g.status = 'ACTIVE'
      and g.subject_identity_id = ${input.actorIdentityId}
      and g.incident_id = ${input.incidentId}
      and g.scope ->> 'resourceType' = ${input.resourceType}
      and g.scope ->> 'resourceId' = ${input.resourceId}
      and g.scope -> 'allowedActions' @> ${sql.json([input.action])}::jsonb
    for share of g
  `;
  const accessedAt = await readDatabaseClock(sql);
  const grant = rows[0];
  if (!grant || grant.expiresAt <= accessedAt) {
    await sql`rollback to savepoint emergency_authorization_grant_lock`;
    await sql`release savepoint emergency_authorization_grant_lock`;
    return undefined;
  }
  await sql`release savepoint emergency_authorization_grant_lock`;
  return { ...grant, accessedAt };
}

function sensitiveGrantMatchesAction(
  grant: SensitiveGrantRow,
  input: PlatformSensitiveAction,
): boolean {
  return (
    grant.status === "ACTIVE" &&
    grant.expiresAt > new Date() &&
    grant.subjectIdentityId === input.actorIdentityId &&
    grant.responsibility === input.responsibility &&
    grant.scope.resourceType === input.resourceType &&
    grant.scope.resourceId === input.resourceId &&
    grant.scope.allowedActions.includes(input.action)
  );
}

function responsibilityView(grant: ResponsibilityGrantRow): PlatformAccessGrant {
  return responsibilityGrantViewContract.parse({
    grantId: grant.grantId,
    grantKind: "RESPONSIBILITY",
    subjectIdentityId: grant.subjectIdentityId,
    requestedByIdentityId: grant.requestedByIdentityId,
    approvedByIdentityId: grant.approvedByIdentityId,
    revision: grant.revision,
    singleManagerException: grant.singleManagerException,
    createdAt: grant.createdAt.toISOString(),
    activatedAt: grant.activatedAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    status: grant.status,
    responsibility: grant.responsibility,
    expiresAt: null,
  });
}

function sensitiveView(grant: SensitiveGrantRow): PlatformAccessGrant {
  return sensitiveAccessGrantViewContract.parse({
    grantId: grant.grantId,
    grantKind: "SENSITIVE_ACCESS",
    subjectIdentityId: grant.subjectIdentityId,
    requestedByIdentityId: grant.requestedByIdentityId,
    approvedByIdentityId: grant.approvedByIdentityId,
    revision: grant.revision,
    singleManagerException: grant.singleManagerException,
    createdAt: grant.createdAt.toISOString(),
    activatedAt: grant.activatedAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    status: grant.status,
    responsibility: grant.responsibility,
    purposeCode: grant.purposeCode,
    scope: grant.scope,
    expiresAt: grant.expiresAt.toISOString(),
  });
}

function emergencyView(grant: EmergencyGrantRow): PlatformAccessGrant {
  const reviewStatus = grant.reviewedAt
    ? grant.reviewMode === "WITHOUT_INDEPENDENT_REVIEW"
      ? "COMPLETED_WITHOUT_INDEPENDENT_REVIEW"
      : "COMPLETED"
    : !grant.activatedAt
      ? "NOT_DUE"
      : grant.reviewDueAt <= new Date()
        ? "OVERDUE"
        : "PENDING";
  return emergencyAccessGrantViewContract.parse({
    grantId: grant.grantId,
    grantKind: "EMERGENCY_ACCESS",
    subjectIdentityId: grant.subjectIdentityId,
    requestedByIdentityId: grant.requestedByIdentityId,
    approvedByIdentityId: grant.approvedByIdentityId,
    revision: grant.revision,
    singleManagerException: grant.singleManagerException,
    createdAt: grant.createdAt.toISOString(),
    activatedAt: grant.activatedAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    status: grant.status,
    incidentId: grant.incidentId,
    scope: grant.scope,
    expiresAt: grant.expiresAt.toISOString(),
    reviewDueAt: grant.reviewDueAt.toISOString(),
    reviewStatus,
  });
}

async function enqueueSensitiveEvent(
  sql: Sql,
  input: {
    eventType:
      | "SensitiveAccessGranted.v1"
      | "SensitiveAccessRevoked.v1"
      | "SensitiveAccessExpired.v1";
    status: "ACTIVE" | "REVOKED" | "EXPIRED";
    grant: SensitiveGrantRow;
    actorIdentityId: string | null;
    correlationId: string;
    occurredAt: Date;
  },
) {
  const event = {
    version: 1,
    eventId: randomUUID(),
    eventType: input.eventType,
    aggregateId: input.grant.grantId,
    aggregateVersion: input.grant.revision,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.correlationId,
    causationId: input.correlationId,
    actor: input.actorIdentityId
      ? {
          type: "IDENTITY" as const,
          id: identityIdContract.parse(input.actorIdentityId),
        }
      : { type: "SYSTEM" as const },
    payload: {
      grantKind: "SENSITIVE_ACCESS" as const,
      grantId: input.grant.grantId,
      subjectIdentityId: identityIdContract.parse(input.grant.subjectIdentityId),
      status: input.status,
      scope: input.grant.scope,
      expiresAt: input.grant.expiresAt.toISOString(),
      singleManagerException: input.grant.singleManagerException,
      auditRequired: true as const,
    },
  };
  if (input.eventType === "SensitiveAccessGranted.v1") {
    await enqueueOutboxEvent(sql, sensitiveAccessGrantedV1Contract.parse(event));
  } else if (input.eventType === "SensitiveAccessRevoked.v1") {
    await enqueueOutboxEvent(sql, sensitiveAccessRevokedV1Contract.parse(event));
  } else {
    await enqueueOutboxEvent(sql, sensitiveAccessExpiredV1Contract.parse(event));
  }
}

async function enqueueEmergencyEvent(
  sql: Sql,
  input: {
    eventType:
      | "EmergencyAccessRequested.v1"
      | "EmergencyAccessActivated.v1"
      | "EmergencyAccessRevoked.v1"
      | "EmergencyAccessExpired.v1"
      | "EmergencyAccessClosed.v1";
    status: "PENDING_APPROVAL" | "ACTIVE" | "REVOKED" | "EXPIRED" | "CLOSED";
    grant: EmergencyGrantRow;
    actorIdentityId: string | null;
    correlationId: string;
    occurredAt: Date;
  },
) {
  const event = {
    version: 1,
    eventId: randomUUID(),
    eventType: input.eventType,
    aggregateId: input.grant.grantId,
    aggregateVersion: input.grant.revision,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.correlationId,
    causationId: input.correlationId,
    actor: input.actorIdentityId
      ? {
          type: "IDENTITY" as const,
          id: identityIdContract.parse(input.actorIdentityId),
        }
      : { type: "SYSTEM" as const },
    payload: {
      grantKind: "EMERGENCY_ACCESS" as const,
      grantId: input.grant.grantId,
      subjectIdentityId: identityIdContract.parse(input.grant.subjectIdentityId),
      status: input.status,
      scope: input.grant.scope,
      expiresAt: input.grant.expiresAt.toISOString(),
      singleManagerException: input.grant.singleManagerException,
      auditRequired: true as const,
    },
  };
  if (input.eventType === "EmergencyAccessRequested.v1") {
    await enqueueOutboxEvent(
      sql,
      emergencyAccessRequestedV1Contract.parse({
        ...event,
        eventType: input.eventType,
        payload: { ...event.payload, status: "PENDING_APPROVAL" },
      }),
    );
  } else if (input.eventType === "EmergencyAccessActivated.v1") {
    await enqueueOutboxEvent(
      sql,
      emergencyAccessActivatedV1Contract.parse({
        ...event,
        eventType: input.eventType,
        payload: { ...event.payload, status: "ACTIVE" },
      }),
    );
  } else if (input.eventType === "EmergencyAccessRevoked.v1") {
    await enqueueOutboxEvent(
      sql,
      emergencyAccessRevokedV1Contract.parse({
        ...event,
        eventType: input.eventType,
        payload: { ...event.payload, status: "REVOKED" },
      }),
    );
  } else if (input.eventType === "EmergencyAccessExpired.v1") {
    await enqueueOutboxEvent(
      sql,
      emergencyAccessExpiredV1Contract.parse({
        ...event,
        eventType: input.eventType,
        payload: { ...event.payload, status: "EXPIRED" },
      }),
    );
  } else {
    await enqueueOutboxEvent(
      sql,
      emergencyAccessClosedV1Contract.parse({
        ...event,
        eventType: input.eventType,
        payload: { ...event.payload, status: "CLOSED" },
      }),
    );
  }
}

async function authorizeAccessAdministrator(
  sql: Sql,
  token: string,
  requireStrongAuthentication: boolean,
): Promise<AccessSession> {
  const session = await authorizePlatformSession(
    sql,
    token,
    requireStrongAuthentication,
  );
  await requireAccessAdministrator(sql, session.identityId);
  return session;
}

async function authorizePlatformSession(
  sql: Sql,
  token: string,
  requireStrongAuthentication: boolean,
): Promise<AccessSession> {
  if (!token) throw new PlatformAgentSessionUnauthorizedError();
  const rows = await sql<AccessSession[]>`
    select s.identity_id as "identityId", s.created_at as "strongAuthenticationAt"
    from identity_sessions s
    join identity_identities i on i.id = s.identity_id and i.status = 'ACTIVE'
    where s.token_hash = ${hashToken(token)}
      and s.audience = 'PLATFORM_AGENT' and s.revoked_at is null
      and s.expires_at > now()
    limit 1
  `;
  const session = rows[0];
  if (!session) throw new PlatformAgentSessionUnauthorizedError();
  if (
    requireStrongAuthentication &&
    Date.now() - session.strongAuthenticationAt.getTime() > 5 * 60 * 1000
  ) {
    throw new PlatformAccessError("STRONG_AUTHENTICATION_STALE");
  }
  return session;
}

async function requireAccessAdministrator(sql: Sql, identityId: string): Promise<void> {
  const rows = await sql<Array<{ id: string }>>`
    select p.id from identity_platform_permission_grants p
    where p.identity_id = ${identityId}
      and p.permission = 'ACCESS_ADMINISTRATION' and p.revoked_at is null
    for share
  `;
  if (!rows[0]) throw new PlatformPermissionRequiredError();
}

async function requireResponsibility(
  sql: Sql,
  identityId: string,
  responsibility: Responsibility,
): Promise<void> {
  const rows = await sql<Array<{ id: string }>>`
    select p.id from identity_platform_permission_grants p
    join identity_identities i on i.id = p.identity_id and i.status = 'ACTIVE'
    where p.identity_id = ${identityId} and p.permission = ${responsibility}
      and p.revoked_at is null
    for share of p
  `;
  if (!rows[0]) throw new PlatformAccessError("RESPONSIBILITY_REQUIRED");
}

async function hasResponsibility(
  sql: Sql,
  identityId: string,
  responsibility: Responsibility,
): Promise<boolean> {
  const rows = await sql<Array<{ exists: boolean }>>`
    select exists(
      select 1 from identity_platform_permission_grants p
      join identity_identities i on i.id = p.identity_id and i.status = 'ACTIVE'
      where p.identity_id = ${identityId} and p.permission = ${responsibility}
        and p.revoked_at is null
    ) as exists
  `;
  return rows[0]?.exists ?? false;
}

async function countActiveAccessManagers(sql: Sql): Promise<number> {
  const rows = await sql<Array<{ count: number }>>`
    select count(distinct p.identity_id)::int as count
    from identity_platform_permission_grants p
    join identity_identities i on i.id = p.identity_id and i.status = 'ACTIVE'
    where p.permission = 'ACCESS_ADMINISTRATION' and p.revoked_at is null
  `;
  return rows[0]?.count ?? 0;
}

async function countActivePlatformHumans(sql: Sql): Promise<number> {
  const rows = await sql<Array<{ count: number }>>`
    select count(distinct s.identity_id)::int as count
    from identity_sessions s
    join identity_identities i on i.id = s.identity_id and i.status = 'ACTIVE'
    where s.audience = 'PLATFORM_AGENT' and s.revoked_at is null
      and s.expires_at > now()
  `;
  return rows[0]?.count ?? 0;
}

async function hasOverdueEmergencyReview(
  sql: Sql,
  requesterIdentityId: string,
): Promise<boolean> {
  const rows = await sql<Array<{ exists: boolean }>>`
    select exists(
      select 1 from identity_platform_access_grants
      where grant_kind = 'EMERGENCY_ACCESS'
        and requested_by_identity_id = ${requesterIdentityId}
        and activated_at is not null and reviewed_at is null
        and review_due_at <= now()
    ) as exists
  `;
  return rows[0]?.exists ?? false;
}

async function expireDueEmergencyGrants(
  sql: Sql,
  correlationId: string,
): Promise<void> {
  const grants = await sql<EmergencyGrantRow[]>`
    select id as "grantId", subject_identity_id as "subjectIdentityId",
      requested_by_identity_id as "requestedByIdentityId",
      approved_by_identity_id as "approvedByIdentityId",
      incident_id as "incidentId", scope, status, revision,
      single_manager_exception as "singleManagerException",
      created_at as "createdAt", activated_at as "activatedAt",
      revoked_at as "revokedAt", expires_at as "expiresAt",
      review_due_at as "reviewDueAt", reviewed_at as "reviewedAt",
      review_mode as "reviewMode", rejected_at as "rejectedAt"
    from identity_platform_access_grants
    where grant_kind = 'EMERGENCY_ACCESS' and status = 'ACTIVE'
    order by created_at, id
    for update
  `;
  const occurredAt = await readDatabaseClock(sql);
  for (const grant of grants.filter((candidate) => candidate.expiresAt <= occurredAt)) {
    const expiredGrant: EmergencyGrantRow = {
      ...grant,
      status: "EXPIRED",
      revision: grant.revision + 1,
    };
    await sql`
      update identity_platform_access_grants
      set status = 'EXPIRED', revision = ${expiredGrant.revision}
      where id = ${grant.grantId}
    `;
    await insertAudit(sql, {
      grantId: grant.grantId,
      action: "GRANT_EXPIRED",
      actorIdentityId: grant.subjectIdentityId,
      subjectIdentityId: grant.subjectIdentityId,
      scope: grant.scope,
      reasonCode: "TTL_EXPIRED",
      reason: "پایان خودکار مهلت دسترسی اضطراری هنگام خواندن فهرست",
      singleManagerException: grant.singleManagerException,
      correlationId,
      occurredAt,
    });
    await enqueueEmergencyEvent(sql, {
      eventType: "EmergencyAccessExpired.v1",
      status: "EXPIRED",
      grant: expiredGrant,
      actorIdentityId: null,
      correlationId,
      occurredAt,
    });
  }
}

async function insertAudit(
  sql: Sql,
  entry: {
    grantId: string;
    action: string;
    actorIdentityId: string;
    subjectIdentityId: string;
    reasonCode: string;
    reason: string;
    scope?: PlatformAccessScope;
    singleManagerException: boolean;
    correlationId: string;
    occurredAt: Date;
    outcome?: "SUCCEEDED" | "DENIED" | "STOPPED_AFTER_REVOCATION";
  },
) {
  const audit = platformAccessAuditEntryContract.parse({
    auditId: randomUUID(),
    grantId: entry.grantId,
    action: entry.action,
    actorIdentityId: entry.actorIdentityId,
    subjectIdentityId: entry.subjectIdentityId,
    ...(entry.scope ? { scope: entry.scope } : {}),
    reasonCode: entry.reasonCode,
    reason: entry.reason,
    outcome: entry.outcome ?? "SUCCEEDED",
    singleManagerException: entry.singleManagerException,
    correlationId: entry.correlationId,
    occurredAt: entry.occurredAt.toISOString(),
  });
  await persistAuditRecord(sql, {
    auditId: audit.auditId,
    attemptedGrantId: audit.grantId,
    resolvedGrantId: audit.grantId,
    attemptedGrantKind: null,
    attemptedIncidentId: null,
    attemptedResponsibility: null,
    action: audit.action,
    actorIdentityId: audit.actorIdentityId,
    subjectIdentityId: audit.subjectIdentityId,
    scope: audit.scope,
    reasonCode: audit.reasonCode,
    reason: audit.reason,
    outcome: audit.outcome,
    singleManagerException: audit.singleManagerException,
    correlationId: audit.correlationId,
    occurredAt: audit.occurredAt,
  });
}

async function insertUnresolvedSensitiveDenial(
  sql: Sql,
  input: PlatformSensitiveAction,
): Promise<void> {
  const audit = unresolvedSensitiveAccessAuditEntryContract.parse({
    auditId: randomUUID(),
    attemptedGrantId: input.grantId,
    action: accessAuditAction(input.action),
    actorIdentityId: input.actorIdentityId,
    attemptedResponsibility: input.responsibility,
    scope: {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      allowedActions: [input.action],
    },
    reasonCode: "ACCESS_REQUEST_REJECTED",
    reason: input.reason,
    outcome: "DENIED",
    correlationId: input.correlationId,
    occurredAt: new Date().toISOString(),
  });
  await persistAuditRecord(sql, {
    auditId: audit.auditId,
    attemptedGrantId: audit.attemptedGrantId,
    resolvedGrantId: null,
    attemptedGrantKind: "SENSITIVE_ACCESS",
    attemptedIncidentId: null,
    attemptedResponsibility: audit.attemptedResponsibility,
    action: audit.action,
    actorIdentityId: audit.actorIdentityId,
    subjectIdentityId: null,
    scope: audit.scope,
    reasonCode: audit.reasonCode,
    reason: audit.reason,
    outcome: audit.outcome,
    singleManagerException: null,
    correlationId: audit.correlationId,
    occurredAt: audit.occurredAt,
  });
}

async function insertUnresolvedEmergencyDenial(
  sql: Sql,
  input: PlatformEmergencyAction,
): Promise<void> {
  const audit = unresolvedEmergencyAccessAuditEntryContract.parse({
    auditId: randomUUID(),
    attemptedGrantId: input.grantId,
    attemptedGrantKind: "EMERGENCY_ACCESS",
    attemptedIncidentId: input.incidentId,
    action: accessAuditAction(input.action),
    actorIdentityId: input.actorIdentityId,
    scope: {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      allowedActions: [input.action],
    },
    reasonCode: "ACCESS_REQUEST_REJECTED",
    reason: input.reason,
    outcome: "DENIED",
    correlationId: input.correlationId,
    occurredAt: new Date().toISOString(),
  });
  await persistAuditRecord(sql, {
    auditId: audit.auditId,
    attemptedGrantId: audit.attemptedGrantId,
    resolvedGrantId: null,
    attemptedGrantKind: audit.attemptedGrantKind,
    attemptedIncidentId: audit.attemptedIncidentId,
    attemptedResponsibility: null,
    action: audit.action,
    actorIdentityId: audit.actorIdentityId,
    subjectIdentityId: null,
    scope: audit.scope,
    reasonCode: audit.reasonCode,
    reason: audit.reason,
    outcome: audit.outcome,
    singleManagerException: null,
    correlationId: audit.correlationId,
    occurredAt: audit.occurredAt,
  });
}

async function persistAuditRecord(
  sql: Sql,
  audit: {
    auditId: string;
    attemptedGrantId: string;
    resolvedGrantId: string | null;
    attemptedGrantKind: "SENSITIVE_ACCESS" | "EMERGENCY_ACCESS" | null;
    attemptedIncidentId: string | null;
    attemptedResponsibility: Responsibility | null;
    action: string;
    actorIdentityId: string;
    subjectIdentityId: string | null;
    scope?: PlatformAccessScope;
    reasonCode: string;
    reason: string;
    outcome: "SUCCEEDED" | "DENIED" | "STOPPED_AFTER_REVOCATION";
    singleManagerException: boolean | null;
    correlationId: string;
    occurredAt: string;
  },
): Promise<void> {
  await sql`
    insert into identity_platform_access_audit
      (id, grant_id, resolved_grant_id, attempted_grant_kind,
       attempted_incident_id, attempted_responsibility, action,
       actor_identity_id, subject_identity_id, scope, reason_code, reason, outcome,
       single_manager_exception, correlation_id, occurred_at)
    values
      (${audit.auditId}, ${audit.attemptedGrantId}, ${audit.resolvedGrantId},
       ${audit.attemptedGrantKind}, ${audit.attemptedIncidentId},
       ${audit.attemptedResponsibility}, ${audit.action}, ${audit.actorIdentityId},
       ${audit.subjectIdentityId}, ${audit.scope ? sql.json(audit.scope) : null},
       ${audit.reasonCode}, ${audit.reason}, ${audit.outcome},
       ${audit.singleManagerException}, ${audit.correlationId}, ${audit.occurredAt})
  `;
}

function accessAuditAction(
  action: PlatformSensitiveAction["action"],
): "SENSITIVE_FIELD_REVEALED" | "SENSITIVE_CHANGE_ATTEMPTED" {
  return action === "REVEAL_MINIMUM"
    ? "SENSITIVE_FIELD_REVEALED"
    : "SENSITIVE_CHANGE_ATTEMPTED";
}

async function beginIdempotentCommand(
  sql: Sql,
  operation: string,
  actorIdentityId: string,
  context: PlatformAccessCommandContext,
  payload: unknown,
): Promise<PlatformAccessGrant | undefined> {
  const payloadHash = hashPayload(payload);
  await sql`
    insert into identity_platform_access_idempotency
      (operation, actor_identity_id, key, payload_hash)
    values (${operation}, ${actorIdentityId}, ${context.idempotencyKey}, ${payloadHash})
    on conflict (operation, actor_identity_id, key) do nothing
  `;
  const rows = await sql<Array<{ payloadHash: string; response: unknown | null }>>`
    select payload_hash as "payloadHash", response
    from identity_platform_access_idempotency
    where operation = ${operation} and actor_identity_id = ${actorIdentityId}
      and key = ${context.idempotencyKey}
    for update
  `;
  const row = rows[0];
  if (!row || row.payloadHash !== payloadHash) {
    throw new PlatformAccessError("IDEMPOTENCY_CONFLICT");
  }
  return row.response ? platformAccessGrantContract.parse(row.response) : undefined;
}

async function completeIdempotentCommand(
  sql: Sql,
  operation: string,
  actorIdentityId: string,
  context: PlatformAccessCommandContext,
  response: PlatformAccessGrant,
): Promise<void> {
  await sql`
    update identity_platform_access_idempotency
    set response = ${sql.json(response)}
    where operation = ${operation} and actor_identity_id = ${actorIdentityId}
      and key = ${context.idempotencyKey}
  `;
}

async function beginIdempotentRejectionCommand(
  sql: Sql,
  operation: string,
  actorIdentityId: string,
  context: PlatformAccessCommandContext,
  payload: unknown,
): Promise<PlatformAccessRejection | undefined> {
  const payloadHash = hashPayload(payload);
  await sql`
    insert into identity_platform_access_idempotency
      (operation, actor_identity_id, key, payload_hash)
    values (${operation}, ${actorIdentityId}, ${context.idempotencyKey}, ${payloadHash})
    on conflict (operation, actor_identity_id, key) do nothing
  `;
  const rows = await sql<Array<{ payloadHash: string; response: unknown | null }>>`
    select payload_hash as "payloadHash", response
    from identity_platform_access_idempotency
    where operation = ${operation} and actor_identity_id = ${actorIdentityId}
      and key = ${context.idempotencyKey}
    for update
  `;
  const row = rows[0];
  if (!row || row.payloadHash !== payloadHash) {
    throw new PlatformAccessError("IDEMPOTENCY_CONFLICT");
  }
  return row.response ? platformAccessRejectionContract.parse(row.response) : undefined;
}

async function completeIdempotentRejectionCommand(
  sql: Sql,
  operation: string,
  actorIdentityId: string,
  context: PlatformAccessCommandContext,
  response: PlatformAccessRejection,
): Promise<void> {
  await sql`
    update identity_platform_access_idempotency
    set response = ${sql.json(response)}
    where operation = ${operation} and actor_identity_id = ${actorIdentityId}
      and key = ${context.idempotencyKey}
  `;
}

function encodeAccessCursor(createdAt: Date, grantId: string): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), grantId }),
  ).toString("base64url");
}

function decodeAccessCursor(cursor: string): { createdAt: Date; grantId: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      grantId?: unknown;
    };
    if (typeof parsed.createdAt !== "string" || typeof parsed.grantId !== "string") {
      throw new Error("invalid cursor shape");
    }
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error("invalid cursor timestamp");
    const grantId = platformAccessGrantIdContract.parse(parsed.grantId);
    return { createdAt, grantId };
  } catch {
    throw new PlatformAccessError("INVALID_ACCESS_TRANSITION");
  }
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
