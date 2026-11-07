import { createHash, randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Headers,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  idempotencyKeyContract,
  platformAccessGrantIdContract,
  superadminGrantInputContract,
  superadminRevocationInputContract,
} from "@sevo/contracts/identity-access/v1";
import type { FastifyRequest } from "fastify";
import postgres from "postgres";
import { readPlatformSessionToken } from "../../http/identity-session";

export const SUPERADMIN_SERVICE = Symbol("SUPERADMIN_SERVICE");

export class SuperadminService {
  readonly #sql: ReturnType<typeof postgres>;
  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5 });
  }
  async list(
    token: string,
    correlationId: string,
    kind: "roles" | "audit" | "sensitive",
  ) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    return this.#sql.begin(async (sql) => {
      const actors = await sql`select 1 from identity_sessions s
      join identity_identities i on i.id = s.identity_id and i.status = 'ACTIVE'
      join identity_platform_superadmins a on a.identity_id = i.id and a.revoked_at is null
      where s.token_hash = ${tokenHash} and s.audience = 'PLATFORM_AGENT'
      and s.revoked_at is null and s.expires_at > now() for share of s, i, a`;
      if (!actors.length)
        throw superadminError(correlationId, "RESPONSIBILITY_REQUIRED", 403);
      if (kind === "sensitive") {
        const items =
          await sql`select actor_identity_id as "actorIdentityId", resource_type as "resourceType", resource_id as "resourceId", action, reason, outcome, occurred_at as "occurredAt" from identity_platform_superadmin_sensitive_audit order by occurred_at desc, id desc`;
        return { items };
      }
      if (kind === "audit") {
        const items =
          await sql`select actor_identity_id as "actorIdentityId", actor_kind as "actorKind", subject_identity_id as "subjectIdentityId", action, reason, occurred_at as "occurredAt" from identity_platform_superadmin_audit order by occurred_at desc, id desc`;
        return { items };
      }
      const items =
        await sql`select a.identity_id as "identityId", case when a.revoked_at is not null then 'REVOKED' when i.status <> 'ACTIVE' then 'INACTIVE' else 'ACTIVE' end as status, a.granted_at as "grantedAt", a.revoked_at as "revokedAt" from identity_platform_superadmins a join identity_identities i on i.id = a.identity_id order by a.granted_at desc, a.identity_id`;
      return { items };
    });
  }
  async change(
    token: string,
    subject: string,
    reason: string,
    key: string,
    correlationId: string,
    action: "GRANTED" | "REVOKED",
  ) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const payloadHash = createHash("sha256")
      .update(JSON.stringify({ subject, reason }))
      .digest("hex");
    return this.#sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext('identity_platform_superadmins'))`;
      const actors = await sql<Array<{ identityId: string }>>`
        select s.identity_id as "identityId" from identity_sessions s
        join identity_identities i on i.id = s.identity_id and i.status = 'ACTIVE'
        join identity_platform_superadmins a on a.identity_id = i.id and a.revoked_at is null
        where s.token_hash = ${tokenHash} and s.audience = 'PLATFORM_AGENT'
          and s.revoked_at is null and s.expires_at > now()
          and s.created_at > now() - interval '5 minutes' for share of s, i, a`;
      const actor = actors[0];
      if (!actor) throw superadminError(correlationId, "RESPONSIBILITY_REQUIRED", 403);
      const prior = await sql<Array<{ payloadHash: string; response: unknown }>>`
        select payload_hash as "payloadHash", response from identity_platform_superadmin_idempotency
        where actor_identity_id = ${actor.identityId} and operation = ${action} and key = ${key}`;
      if (prior[0]) {
        if (prior[0].payloadHash !== payloadHash)
          throw superadminError(correlationId, "IDEMPOTENCY_CONFLICT", 409);
        return prior[0].response;
      }
      const subjects = await sql<
        Array<{ id: string; status: string }>
      >`select id, status from identity_identities where id = ${subject} for share`;
      if (!subjects[0] || (action === "GRANTED" && subjects[0].status !== "ACTIVE"))
        throw superadminError(correlationId, "ACCESS_GRANT_NOT_FOUND", 404);
      if (action === "GRANTED") {
        const changed =
          await sql`insert into identity_platform_superadmins (identity_id, granted_at)
          values (${subject}, now()) on conflict (identity_id) do update set granted_at = now(), revoked_at = null, generation_id = gen_random_uuid()
          where identity_platform_superadmins.revoked_at is not null returning identity_id`;
        if (!changed.length)
          throw superadminError(correlationId, "INVALID_ACCESS_TRANSITION", 409);
      } else {
        const active = await sql<
          Array<{ count: number }>
        >`select count(*)::int as count from identity_platform_superadmins a join identity_identities i on i.id = a.identity_id and i.status = 'ACTIVE' where a.revoked_at is null`;
        if (subjects[0].status === "ACTIVE" && (active[0]?.count ?? 0) <= 1)
          throw superadminError(correlationId, "LAST_SUPERADMIN", 409);
        const changed =
          await sql`update identity_platform_superadmins set revoked_at = now() where identity_id = ${subject} and revoked_at is null returning identity_id`;
        if (!changed.length)
          throw superadminError(correlationId, "INVALID_ACCESS_TRANSITION", 409);
      }
      await sql`insert into identity_platform_superadmin_audit (id, actor_identity_id, subject_identity_id, action, reason, correlation_id) values (${randomUUID()}, ${actor.identityId}, ${subject}, ${action}, ${reason}, ${correlationId})`;
      const response = {
        identityId: subject,
        status: action === "GRANTED" ? "ACTIVE" : "REVOKED",
      };
      await sql`insert into identity_platform_superadmin_idempotency (actor_identity_id, operation, key, payload_hash, response) values (${actor.identityId}, ${action}, ${key}, ${payloadHash}, ${sql.json(response)})`;
      return response;
    });
  }
  async onModuleDestroy() {
    await this.#sql.end();
  }
}

@ApiExcludeController()
@Controller("v1/platform/access/superadmins")
export class SuperadminController {
  constructor(
    @Inject(SUPERADMIN_SERVICE) private readonly service: SuperadminService,
  ) {}
  @Get()
  async list(@Req() request: FastifyRequest) {
    return this.service.list(
      readPlatformSessionToken(request) ?? "",
      request.id,
      "roles",
    );
  }
  @Get("audit")
  async audit(@Req() request: FastifyRequest) {
    return this.service.list(
      readPlatformSessionToken(request) ?? "",
      request.id,
      "audit",
    );
  }
  @Get("sensitive-audit")
  async sensitiveAudit(@Req() request: FastifyRequest) {
    return this.service.list(
      readPlatformSessionToken(request) ?? "",
      request.id,
      "sensitive",
    );
  }
  @Post()
  @HttpCode(201)
  async grant(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = superadminGrantInputContract.safeParse(body);
    if (!input.success) throw superadminError(request.id, "VALIDATION_ERROR", 422);
    return this.change(
      request,
      input.data.identityId,
      input.data.reason,
      key,
      "GRANTED",
    );
  }
  @Post(":identityId/revocation")
  @HttpCode(200)
  async revoke(
    @Param("identityId") identityId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = superadminRevocationInputContract.safeParse(body);
    if (!input.success) throw superadminError(request.id, "VALIDATION_ERROR", 422);
    return this.change(request, identityId, input.data.reason, key, "REVOKED");
  }
  private change(
    request: FastifyRequest,
    identityId: unknown,
    reason: unknown,
    key: string | undefined,
    action: "GRANTED" | "REVOKED",
  ) {
    const id = platformAccessGrantIdContract.safeParse(identityId);
    const payload = superadminRevocationInputContract.shape.reason.safeParse(reason);
    const commandKey = idempotencyKeyContract.safeParse(key);
    if (!id.success || !payload.success || !commandKey.success)
      throw superadminError(request.id, "VALIDATION_ERROR", 422);
    return this.service.change(
      readPlatformSessionToken(request) ?? "",
      id.data,
      payload.data,
      commandKey.data,
      request.id,
      action,
    );
  }
}

function superadminError(correlationId: string, code: string, status: number) {
  return new HttpException(
    {
      code,
      message:
        "انجام این اقدام ممکن نیست؛ وضعیت دسترسی و اطلاعات واردشده را بررسی کنید.",
      correlationId,
    },
    status,
  );
}
