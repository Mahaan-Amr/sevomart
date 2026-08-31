import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Param,
  Inject,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  platformAccessApprovalInputContract,
  emergencyAccessActivationInputContract,
  emergencyAccessClosureInputContract,
  emergencyAccessRequestInputContract,
  emergencyAccessReviewInputContract,
  platformAccessListQueryContract,
  platformAccessAuditQueryContract,
  platformAccessRejectionInputContract,
  platformAccessGrantIdContract,
  platformAccessRevocationInputContract,
  responsibilityGrantRequestInputContract,
  sensitiveAccessRequestInputContract,
  idempotencyKeyContract,
} from "@sevo/contracts/identity-access/v1";
import type { FastifyRequest } from "fastify";

import { readPlatformSessionToken } from "../../http/identity-session";
import { PLATFORM_ACCESS_CORE } from "./identity-access.tokens";
import {
  PlatformAccessError,
  PlatformAgentSessionUnauthorizedError,
  PlatformPermissionRequiredError,
  type PlatformAccessCore,
} from "./public";

@ApiExcludeController()
@Controller("v1/platform/access")
export class PlatformAccessController {
  constructor(
    @Inject(PLATFORM_ACCESS_CORE) private readonly access: PlatformAccessCore,
  ) {}

  @Post("responsibility-grants")
  @HttpCode(202)
  async requestResponsibility(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = responsibilityGrantRequestInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.requestResponsibility(context, input.data),
    );
  }

  @Get("responsibility-grants")
  async listResponsibilityAccess(
    @Query() rawQuery: unknown,
    @Req() request: FastifyRequest,
  ) {
    const query = parseListQuery(rawQuery, request.id);
    return this.handleRead(request, (context) =>
      this.access.listResponsibilityAccess(context, query),
    );
  }

  @Post("responsibility-grants/:grantId/approval")
  @HttpCode(200)
  async approveResponsibility(
    @Param("grantId") rawGrantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const grantId = platformAccessGrantIdContract.safeParse(rawGrantId);
    const input = platformAccessApprovalInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!grantId.success || !input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.approveResponsibility(
        context,
        grantId.data,
        input.data.expectedRevision,
      ),
    );
  }

  @Post("responsibility-grants/:grantId/revocation")
  @HttpCode(200)
  async revokeResponsibility(
    @Param("grantId") rawGrantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const grantId = platformAccessGrantIdContract.safeParse(rawGrantId);
    const input = platformAccessRevocationInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!grantId.success || !input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.revokeResponsibility(context, grantId.data, input.data),
    );
  }

  @Post("sensitive-grants")
  @HttpCode(202)
  async requestSensitiveAccess(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = sensitiveAccessRequestInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.requestSensitiveAccess(context, input.data),
    );
  }

  @Get("sensitive-grants")
  async listSensitiveAccess(
    @Query() rawQuery: unknown,
    @Req() request: FastifyRequest,
  ) {
    const query = parseListQuery(rawQuery, request.id);
    return this.handleRead(request, (context) =>
      this.access.listSensitiveAccess(context, query),
    );
  }

  @Post("sensitive-grants/:grantId/approval")
  @HttpCode(200)
  async approveSensitiveAccess(
    @Param("grantId") rawGrantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const grantId = platformAccessGrantIdContract.safeParse(rawGrantId);
    const input = platformAccessApprovalInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!grantId.success || !input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.approveSensitiveAccess(
        context,
        grantId.data,
        input.data.expectedRevision,
      ),
    );
  }

  @Post("sensitive-grants/:grantId/revocation")
  @HttpCode(200)
  async revokeSensitiveAccess(
    @Param("grantId") rawGrantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const grantId = platformAccessGrantIdContract.safeParse(rawGrantId);
    const input = platformAccessRevocationInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!grantId.success || !input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.revokeSensitiveAccess(context, grantId.data, input.data),
    );
  }

  @Post("emergency-grants")
  @HttpCode(202)
  async requestEmergencyAccess(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = emergencyAccessRequestInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.requestEmergencyAccess(context, input.data),
    );
  }

  @Get("emergency-grants")
  async listEmergencyAccess(
    @Query() rawQuery: unknown,
    @Req() request: FastifyRequest,
  ) {
    const query = parseListQuery(rawQuery, request.id);
    return this.handleRead(request, (context) =>
      this.access.listEmergencyAccess(context, query),
    );
  }

  @Get("audit")
  async listAudit(@Query() rawQuery: unknown, @Req() request: FastifyRequest) {
    const queryRecord = queryRecordWithNumericLimit(rawQuery);
    const query = platformAccessAuditQueryContract.safeParse(queryRecord);
    if (!query.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handleRead(request, (context) =>
      this.access.listAudit(context, query.data),
    );
  }

  @Post("emergency-grants/:grantId/approval")
  @HttpCode(200)
  async approveEmergencyAccess(
    @Param("grantId") rawGrantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const grantId = platformAccessGrantIdContract.safeParse(rawGrantId);
    const input = platformAccessApprovalInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!grantId.success || !input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.approveEmergencyAccess(
        context,
        grantId.data,
        input.data.expectedRevision,
      ),
    );
  }

  @Post("emergency-grants/:grantId/activation")
  @HttpCode(200)
  async activateEmergencyAccess(
    @Param("grantId") rawGrantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const grantId = platformAccessGrantIdContract.safeParse(rawGrantId);
    const input = emergencyAccessActivationInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!grantId.success || !input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.activateEmergencyAccess(
        context,
        grantId.data,
        input.data.expectedRevision,
      ),
    );
  }

  @Post("emergency-grants/:grantId/revocation")
  @HttpCode(200)
  async revokeEmergencyAccess(
    @Param("grantId") rawGrantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const grantId = platformAccessGrantIdContract.safeParse(rawGrantId);
    const input = platformAccessRevocationInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!grantId.success || !input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.revokeEmergencyAccess(context, grantId.data, input.data),
    );
  }

  @Post("emergency-grants/:grantId/closure")
  @HttpCode(200)
  async closeEmergencyAccess(
    @Param("grantId") rawGrantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const grantId = platformAccessGrantIdContract.safeParse(rawGrantId);
    const input = emergencyAccessClosureInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!grantId.success || !input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.closeEmergencyAccess(context, grantId.data, input.data),
    );
  }

  @Post("emergency-grants/:grantId/rejection")
  @HttpCode(200)
  async rejectEmergencyAccess(
    @Param("grantId") rawGrantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const grantId = platformAccessGrantIdContract.safeParse(rawGrantId);
    const input = platformAccessRejectionInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!grantId.success || !input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.rejectEmergencyAccess(context, grantId.data, input.data),
    );
  }

  @Post("emergency-grants/:grantId/review")
  @HttpCode(200)
  async completeEmergencyAccessReview(
    @Param("grantId") rawGrantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const grantId = platformAccessGrantIdContract.safeParse(rawGrantId);
    const input = emergencyAccessReviewInputContract.safeParse(body);
    const commandKey = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!grantId.success || !input.success || !commandKey.success) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, commandKey.data, (context) =>
      this.access.completeEmergencyAccessReview(context, grantId.data, input.data),
    );
  }

  private async handle<T>(
    request: FastifyRequest,
    idempotencyKey: string,
    command: (context: {
      sessionToken: string;
      correlationId: string;
      idempotencyKey: string;
    }) => Promise<T>,
  ): Promise<T> {
    return this.execute(
      command({
        sessionToken: readPlatformSessionToken(request) ?? "",
        correlationId: request.id,
        idempotencyKey,
      }),
      request.id,
    );
  }

  private async handleRead<T>(
    request: FastifyRequest,
    read: (context: { sessionToken: string; correlationId: string }) => Promise<T>,
  ): Promise<T> {
    return this.execute(
      read({
        sessionToken: readPlatformSessionToken(request) ?? "",
        correlationId: request.id,
      }),
      request.id,
    );
  }

  private async execute<T>(operation: Promise<T>, correlationId: string): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      if (error instanceof PlatformAgentSessionUnauthorizedError) {
        throw accessHttpError("UNAUTHORIZED", correlationId, 401);
      }
      if (error instanceof PlatformPermissionRequiredError) {
        throw accessHttpError("RESPONSIBILITY_REQUIRED", correlationId, 403);
      }
      if (error instanceof PlatformAccessError) {
        throw accessHttpError(error.code, correlationId, accessStatus(error.code));
      }
      throw error;
    }
  }
}

function parseListQuery(rawQuery: unknown, correlationId: string) {
  const query = platformAccessListQueryContract.safeParse(
    queryRecordWithNumericLimit(rawQuery),
  );
  if (!query.success) {
    throw accessHttpError("VALIDATION_ERROR", correlationId, 422);
  }
  return query.data;
}

function queryRecordWithNumericLimit(rawQuery: unknown) {
  const queryRecord =
    typeof rawQuery === "object" && rawQuery !== null
      ? (rawQuery as Record<string, unknown>)
      : {};
  return {
    ...queryRecord,
    ...(typeof queryRecord.limit === "string"
      ? { limit: Number(queryRecord.limit) }
      : {}),
  };
}

function accessStatus(code: PlatformAccessError["code"]): number {
  if (
    code === "SELF_GRANT_FORBIDDEN" ||
    code === "SELF_APPROVAL_FORBIDDEN" ||
    code === "RESPONSIBILITY_REQUIRED" ||
    code === "SENSITIVE_SCOPE_REQUIRED" ||
    code === "EMERGENCY_SCOPE_REQUIRED"
  ) {
    return 403;
  }
  if (code === "ACCESS_GRANT_NOT_FOUND") return 404;
  return code.startsWith("STRONG_AUTHENTICATION") ? 403 : 409;
}

function accessHttpError(code: string, correlationId: string, status: number) {
  const messages: Record<string, string> = {
    SELF_GRANT_FORBIDDEN:
      "مدیر دسترسی نمی‌تواند این مسئولیت را به خودش واگذار کند؛ دریافت‌کننده دیگری را انتخاب کنید.",
    SELF_APPROVAL_FORBIDDEN:
      "درخواست‌کننده یا دریافت‌کننده نمی‌تواند این درخواست را تأیید کند؛ مدیر مستقل دیگری باید آن را بررسی کند.",
    RESPONSIBILITY_REQUIRED:
      "مسئولیت لازم برای این اقدام فعال نیست؛ با مدیر دسترسی پلتفرم پیگیری کنید.",
    SENSITIVE_SCOPE_REQUIRED:
      "اجازه زنده و هم‌محدوده برای این پرونده وجود ندارد؛ دسترسی تازه درخواست کنید.",
    EMERGENCY_SCOPE_REQUIRED:
      "دسترسی اضطراری زنده و هم‌محدوده برای این حادثه وجود ندارد؛ وضعیت حادثه را بررسی کنید.",
    SECOND_MANAGER_REQUIRED: "برای این واگذاری، تأیید یک مدیر دسترسی دیگر لازم است.",
    STRONG_AUTHENTICATION_REQUIRED:
      "برای ادامه، دوباره با رمز یک‌بارمصرف وارد فضای کار پلتفرم شوید.",
    STRONG_AUTHENTICATION_STALE:
      "تأیید ورود شما قدیمی شده است؛ دوباره با رمز یک‌بارمصرف وارد شوید.",
    ACCESS_GRANT_NOT_FOUND: "درخواست دسترسی پیدا نشد؛ فهرست درخواست‌ها را تازه کنید.",
    ACCESS_GRANT_REVISION_CONFLICT:
      "این درخواست تغییر کرده است؛ صفحه را تازه کنید و دوباره بررسی کنید.",
    INVALID_ACCESS_TRANSITION:
      "این درخواست دیگر در وضعیت قابل انجام نیست؛ وضعیت تازه را ببینید.",
    ACCESS_ALREADY_REVOKED: "این دسترسی پیش‌تر لغو شده و اکنون قابل استفاده نیست.",
    EMERGENCY_REVIEW_OVERDUE:
      "بازبینی دسترسی اضطراری قبلی عقب افتاده است؛ ابتدا همان بازبینی را ببندید.",
    IDEMPOTENCY_CONFLICT:
      "این شناسه قبلاً برای درخواست دیگری استفاده شده است؛ با شناسه تازه دوباره تلاش کنید.",
    UNAUTHORIZED: "نشست عامل پلتفرم معتبر نیست؛ دوباره وارد شوید.",
    VALIDATION_ERROR: "اطلاعات درخواست معتبر نیست؛ مقدارهای واردشده را بررسی کنید.",
  };
  return new HttpException(
    {
      code,
      message: messages[code] ?? "درخواست دسترسی قابل انجام نیست؛ دوباره تلاش کنید.",
      correlationId,
    },
    status,
  );
}
