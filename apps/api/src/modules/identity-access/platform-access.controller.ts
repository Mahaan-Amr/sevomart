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
    if (!input.success || !idempotencyKey) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    try {
      return await this.access.requestResponsibility(
        {
          sessionToken: readPlatformSessionToken(request) ?? "",
          correlationId: request.id,
          idempotencyKey,
        },
        input.data,
      );
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
    if (!grantId.success || !input.success || !idempotencyKey) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, idempotencyKey, (context) =>
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
    if (!grantId.success || !input.success || !idempotencyKey) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, idempotencyKey, (context) =>
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
    if (!input.success || !idempotencyKey) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, idempotencyKey, (context) =>
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
    if (!grantId.success || !input.success || !idempotencyKey) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, idempotencyKey, (context) =>
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
    if (!grantId.success || !input.success || !idempotencyKey) {
      throw accessHttpError("VALIDATION_ERROR", request.id, 422);
    }
    return this.handle(request, idempotencyKey, (context) =>
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
  return new HttpException(
    {
      code,
      message:
        code === "SELF_GRANT_FORBIDDEN"
          ? "مدیر دسترسی نمی‌تواند این مسئولیت را به خودش واگذار کند."
          : code === "RESPONSIBILITY_REQUIRED"
            ? "مسئولیت لازم برای این اقدام فعال نیست."
            : code === "UNAUTHORIZED"
              ? "نشست عامل پلتفرم معتبر نیست."
              : "درخواست دسترسی قابل انجام نیست.",
      correlationId,
    },
    status,
  );
}
