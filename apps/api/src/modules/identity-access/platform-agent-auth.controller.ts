import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Param,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { RuntimeEnvironment } from "@sevo/config";
import {
  otpRequestContract,
  otpVerificationContract,
  totpConfirmationContract,
  totpActionProofRequestContract,
  totpRecoveryRequestContract,
  totpRecoveryApprovalContract,
  totpRecoveryContract,
} from "@sevo/contracts/identity-access/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  OtpRejectedError,
  OtpRequestRateLimitedError,
} from "./application/identity-otp.service";
import {
  PlatformAgentTotpService,
  TotpDeniedError,
  TotpRateLimitedError,
  TotpUnavailableError,
} from "./application/platform-agent-totp.service";
import { PlatformAgentOtpService } from "./application/platform-agent-otp.service";
import {
  PLATFORM_AGENT_OTP_SERVICE,
  PLATFORM_AGENT_TOTP_SERVICE,
  PLATFORM_AGENT_SESSION_AUTHORIZER,
  RUNTIME_ENVIRONMENT,
} from "./identity-access.tokens";
import {
  PlatformAgentSessionUnauthorizedError,
  PlatformPermissionRequiredError,
  type PlatformAgentSessionAuthorizer,
} from "./public";
import { readPlatformSessionToken } from "../../http/identity-session";

@ApiExcludeController()
@Controller("v1/platform/auth")
export class PlatformAgentAuthController {
  constructor(
    @Inject(PLATFORM_AGENT_OTP_SERVICE)
    private readonly service: PlatformAgentOtpService,
    @Inject(PLATFORM_AGENT_TOTP_SERVICE)
    private readonly totp: PlatformAgentTotpService,
    @Inject(PLATFORM_AGENT_SESSION_AUTHORIZER)
    private readonly sessions: PlatformAgentSessionAuthorizer,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  @Get("session")
  async readSession(@Req() request: FastifyRequest) {
    try {
      return await this.sessions.readWorkspaceSession(
        readPlatformSessionToken(request) ?? "",
      );
    } catch (error) {
      if (error instanceof PlatformAgentSessionUnauthorizedError) {
        throw platformAuthError("UNAUTHORIZED", request.id, 401);
      }
      throw error;
    }
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.sessions.revokeSession(readPlatformSessionToken(request) ?? "");
    void reply.header(
      "Set-Cookie",
      platformSessionCookie("", 0, this.environment.SEVO_RUNTIME_ENV === "production"),
    );
  }

  @Post("totp/enrollment")
  @HttpCode(HttpStatus.CREATED)
  async beginTotp(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header("Cache-Control", "no-store");
    try {
      return await this.totp.begin(readPlatformSessionToken(request) ?? "", request.id);
    } catch (error) {
      throw totpError(error, request.id);
    }
  }

  @Post("totp/enrollment/confirmation")
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmTotp(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = totpConfirmationContract.safeParse(body);
    if (!parsed.success) throw platformAuthError("VALIDATION_ERROR", request.id, 422);
    try {
      await this.totp.confirm(
        readPlatformSessionToken(request) ?? "",
        parsed.data.code,
        request.id,
      );
    } catch (error) {
      throw totpError(error, request.id);
    }
  }

  @Post("totp/proofs")
  @HttpCode(HttpStatus.CREATED)
  async createTotpProof(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    try {
      await this.totp.recordProofAttempt(
        readPlatformSessionToken(request) ?? "",
        request.id,
      );
    } catch (error) {
      throw totpError(error, request.id);
    }
    const parsed = totpActionProofRequestContract.safeParse(body);
    if (!parsed.success) throw platformAuthError("VALIDATION_ERROR", request.id, 422);
    void reply.header("Cache-Control", "no-store");
    try {
      return await this.totp.createProof(
        readPlatformSessionToken(request) ?? "",
        parsed.data,
        request.id,
      );
    } catch (error) {
      throw totpError(error, request.id);
    }
  }

  @Post("totp/recoveries")
  @HttpCode(HttpStatus.CREATED)
  async requestRecovery(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = totpRecoveryRequestContract.safeParse(body);
    if (!parsed.success) throw platformAuthError("VALIDATION_ERROR", request.id, 422);
    try {
      return await this.totp.requestRecovery(
        readPlatformSessionToken(request) ?? "",
        parsed.data,
        request.id,
      );
    } catch (error) {
      throw totpError(error, request.id);
    }
  }

  @Get("totp/recoveries/:recoveryId")
  async readRecovery(
    @Req() request: FastifyRequest,
    @Param("recoveryId") recoveryId: string,
  ) {
    const id = totpRecoveryContract.shape.recoveryId.safeParse(recoveryId);
    if (!id.success) throw platformAuthError("VALIDATION_ERROR", request.id, 422);
    try {
      return await this.totp.readRecovery(
        readPlatformSessionToken(request) ?? "",
        id.data,
      );
    } catch (error) {
      throw totpError(error, request.id);
    }
  }

  @Post("totp/recoveries/:recoveryId/approvals")
  @HttpCode(HttpStatus.NO_CONTENT)
  async approveRecovery(
    @Req() request: FastifyRequest,
    @Param("recoveryId") recoveryId: string,
    @Body() body: unknown,
  ) {
    const id = totpRecoveryContract.shape.recoveryId.safeParse(recoveryId);
    const parsed = totpRecoveryApprovalContract.safeParse(body);
    if (!id.success || !parsed.success)
      throw platformAuthError("VALIDATION_ERROR", request.id, 422);
    try {
      await this.totp.approveRecovery(
        readPlatformSessionToken(request) ?? "",
        id.data,
        parsed.data.proof,
        request.id,
      );
    } catch (error) {
      throw totpError(error, request.id);
    }
  }

  @Post("totp/recoveries/:recoveryId/enrollment")
  @HttpCode(HttpStatus.CREATED)
  async beginRecovery(
    @Req() request: FastifyRequest,
    @Param("recoveryId") recoveryId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const id = totpRecoveryContract.shape.recoveryId.safeParse(recoveryId);
    if (!id.success) throw platformAuthError("VALIDATION_ERROR", request.id, 422);
    void reply.header("Cache-Control", "no-store");
    try {
      return await this.totp.beginRecovery(
        readPlatformSessionToken(request) ?? "",
        id.data,
        request.id,
      );
    } catch (error) {
      throw totpError(error, request.id);
    }
  }

  @Post("totp/recoveries/:recoveryId/confirmation")
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmRecovery(
    @Req() request: FastifyRequest,
    @Param("recoveryId") recoveryId: string,
    @Body() body: unknown,
  ) {
    const id = totpRecoveryContract.shape.recoveryId.safeParse(recoveryId);
    const parsed = totpConfirmationContract.safeParse(body);
    if (!id.success || !parsed.success)
      throw platformAuthError("VALIDATION_ERROR", request.id, 422);
    try {
      await this.totp.confirmRecovery(
        readPlatformSessionToken(request) ?? "",
        id.data,
        parsed.data.code,
        request.id,
      );
    } catch (error) {
      throw totpError(error, request.id);
    }
  }

  @Post("otp/requests")
  @HttpCode(HttpStatus.ACCEPTED)
  async requestOtp(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = otpRequestContract.safeParse(body);
    if (!parsed.success) throw platformAuthError("VALIDATION_ERROR", request.id, 422);
    try {
      return await this.service.requestOtp(parsed.data.mobile, request.id);
    } catch (error) {
      if (error instanceof PlatformPermissionRequiredError) {
        throw platformAuthError("PLATFORM_PERMISSION_REQUIRED", request.id, 403);
      }
      if (error instanceof OtpRequestRateLimitedError) {
        throw platformAuthError("RATE_LIMITED", request.id, 429);
      }
      throw error;
    }
  }

  @Post("otp/verifications")
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = otpVerificationContract.safeParse(body);
    if (!parsed.success) throw platformAuthError("VALIDATION_ERROR", request.id, 422);
    try {
      const verified = await this.service.verifyOtp(
        parsed.data.challengeId,
        parsed.data.code,
      );
      const maxAge = Math.floor(
        (Date.parse(verified.session.expiresAt) - Date.now()) / 1_000,
      );
      void reply.header(
        "Set-Cookie",
        platformSessionCookie(
          verified.token,
          maxAge,
          this.environment.SEVO_RUNTIME_ENV === "production",
        ),
      );
      return verified.session;
    } catch (error) {
      if (error instanceof OtpRejectedError) {
        throw platformAuthError("UNAUTHORIZED", request.id, 401);
      }
      if (error instanceof PlatformPermissionRequiredError) {
        throw platformAuthError("PLATFORM_PERMISSION_REQUIRED", request.id, 403);
      }
      throw error;
    }
  }
}

@ApiExcludeController()
@Controller("v2/platform/auth")
export class PlatformAgentAuthV2Controller {
  constructor(
    @Inject(PLATFORM_AGENT_OTP_SERVICE)
    private readonly service: PlatformAgentOtpService,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}
  @Post("otp/requests")
  @HttpCode(HttpStatus.ACCEPTED)
  async requestOtp(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = otpRequestContract.safeParse(body);
    if (!parsed.success) throw platformAuthError("VALIDATION_ERROR", request.id, 422);
    try {
      return await this.service.requestOtp(parsed.data.mobile, request.id, true);
    } catch (error) {
      if (error instanceof PlatformPermissionRequiredError)
        throw platformAuthError("PLATFORM_PERMISSION_REQUIRED", request.id, 403);
      if (error instanceof OtpRequestRateLimitedError)
        throw platformAuthError("RATE_LIMITED", request.id, 429);
      throw error;
    }
  }
  @Post("otp/verifications")
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = otpVerificationContract.safeParse(body);
    if (!parsed.success) throw platformAuthError("VALIDATION_ERROR", request.id, 422);
    try {
      const verified = await this.service.verifyOtp(
        parsed.data.challengeId,
        parsed.data.code,
        true,
      );
      const maxAge = Math.floor(
        (Date.parse(verified.session.expiresAt) - Date.now()) / 1000,
      );
      void reply.header(
        "Set-Cookie",
        platformSessionCookie(
          verified.token,
          maxAge,
          this.environment.SEVO_RUNTIME_ENV === "production",
        ),
      );
      return verified.session;
    } catch (error) {
      if (error instanceof OtpRejectedError)
        throw platformAuthError("UNAUTHORIZED", request.id, 401);
      if (error instanceof PlatformPermissionRequiredError)
        throw platformAuthError("PLATFORM_PERMISSION_REQUIRED", request.id, 403);
      throw error;
    }
  }
}

function platformSessionCookie(value: string, maxAge: number, secure: boolean) {
  return `sevo_platform_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function platformAuthError(code: string, correlationId: string, status: number) {
  return new HttpException(
    {
      code,
      message:
        code === "PLATFORM_PERMISSION_REQUIRED"
          ? "مجوز عامل پلتفرم برای این شماره فعال نیست."
          : code === "RATE_LIMITED"
            ? "درخواست‌ها زیاد شده است؛ کمی بعد دوباره تلاش کنید."
            : code === "UNAUTHORIZED"
              ? "کد واردشده درست نیست."
              : "اطلاعات ورود معتبر نیست.",
      correlationId,
    },
    status,
  );
}

function totpError(error: unknown, correlationId: string): Error {
  if (error instanceof TotpDeniedError)
    return platformAuthError("PLATFORM_PERMISSION_REQUIRED", correlationId, 403);
  if (error instanceof TotpRateLimitedError)
    return platformAuthError("RATE_LIMITED", correlationId, 429);
  if (error instanceof TotpUnavailableError)
    return platformAuthError("UNAVAILABLE", correlationId, 503);
  return error instanceof Error ? error : new Error("TOTP operation failed");
}
