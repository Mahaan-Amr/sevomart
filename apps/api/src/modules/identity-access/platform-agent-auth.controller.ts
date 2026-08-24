import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { RuntimeEnvironment } from "@sevo/config";
import {
  otpRequestContract,
  otpVerificationContract,
} from "@sevo/contracts/identity-access/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  OtpRejectedError,
  OtpRequestRateLimitedError,
} from "./application/identity-otp.service";
import { PlatformAgentOtpService } from "./application/platform-agent-otp.service";
import {
  PLATFORM_AGENT_OTP_SERVICE,
  RUNTIME_ENVIRONMENT,
} from "./identity-access.tokens";
import { PlatformPermissionRequiredError } from "./public";

@ApiExcludeController()
@Controller("v1/platform/auth/otp")
export class PlatformAgentAuthController {
  constructor(
    @Inject(PLATFORM_AGENT_OTP_SERVICE)
    private readonly service: PlatformAgentOtpService,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  @Post("requests")
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

  @Post("verifications")
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
      const secure =
        this.environment.SEVO_RUNTIME_ENV === "production" ? "; Secure" : "";
      void reply.header(
        "Set-Cookie",
        `sevo_platform_session=${verified.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`,
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
