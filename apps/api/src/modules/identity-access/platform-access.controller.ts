import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Param,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  platformAccessApprovalInputContract,
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

  private async handle<T>(
    request: FastifyRequest,
    idempotencyKey: string,
    command: (context: {
      sessionToken: string;
      correlationId: string;
      idempotencyKey: string;
    }) => Promise<T>,
  ): Promise<T> {
    try {
      return await command({
        sessionToken: readPlatformSessionToken(request) ?? "",
        correlationId: request.id,
        idempotencyKey,
      });
    } catch (error) {
      if (error instanceof PlatformAgentSessionUnauthorizedError) {
        throw accessHttpError("UNAUTHORIZED", request.id, 401);
      }
      if (error instanceof PlatformPermissionRequiredError) {
        throw accessHttpError("RESPONSIBILITY_REQUIRED", request.id, 403);
      }
      if (error instanceof PlatformAccessError) {
        throw accessHttpError(error.code, request.id, accessStatus(error.code));
      }
      throw error;
    }
  }
}

function accessStatus(code: PlatformAccessError["code"]): number {
  if (
    code === "SELF_GRANT_FORBIDDEN" ||
    code === "SELF_APPROVAL_FORBIDDEN" ||
    code === "RESPONSIBILITY_REQUIRED" ||
    code === "SENSITIVE_SCOPE_REQUIRED"
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
