import {
  Body,
  Controller,
  Delete,
  Get,
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

import { readIdentitySessionToken } from "../../http/identity-session";

import {
  InvalidIdentitySessionError,
  OtpRejectedError,
  OtpRequestRateLimitedError,
  IdentityOtpService,
} from "./application/identity-otp.service";
import { IDENTITY_OTP_SERVICE, RUNTIME_ENVIRONMENT } from "./identity-access.tokens";

@ApiExcludeController()
@Controller("v1/auth")
export class IdentityAccessController {
  constructor(
    @Inject(IDENTITY_OTP_SERVICE) private readonly service: IdentityOtpService,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  @Post("otp/requests")
  @HttpCode(HttpStatus.ACCEPTED)
  async requestOtp(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = otpRequestContract.safeParse(body);
    if (!parsed.success) {
      throw validationError(
        request.id,
        "شماره موبایل را با قالب ۰۹xxxxxxxxx وارد کنید.",
        [{ field: "mobile", code: "INVALID_FORMAT" }],
      );
    }

    try {
      return await this.service.requestOtp(parsed.data.mobile, request.id);
    } catch (error) {
      if (error instanceof OtpRequestRateLimitedError) {
        throw new HttpException(
          {
            code: "RATE_LIMITED",
            message: "درخواست‌ها زیاد شده است؛ کمی بعد دوباره تلاش کنید.",
            correlationId: request.id,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
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
    if (!parsed.success) {
      throw validationError(request.id, "کد شش‌رقمی را کامل وارد کنید.", [
        { field: "code", code: "INVALID_FORMAT" },
      ]);
    }

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
        `sevo_session=${verified.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
      );
      return verified.session;
    } catch (error) {
      if (error instanceof OtpRejectedError) {
        throw new HttpException(
          {
            code: "UNAUTHORIZED",
            message: "کد واردشده درست نیست.",
            correlationId: request.id,
          },
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw error;
    }
  }

  @Get("session")
  async readSession(@Req() request: FastifyRequest) {
    const token = readIdentitySessionToken(request);
    try {
      return await this.service.readSession(token ?? "");
    } catch (error) {
      if (error instanceof InvalidIdentitySessionError) {
        throw new HttpException(
          {
            code: "UNAUTHORIZED",
            message: "نشست شما معتبر نیست. دوباره وارد شوید.",
            correlationId: request.id,
          },
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw error;
    }
  }

  @Delete("session")
  @HttpCode(HttpStatus.NO_CONTENT)
  async endSession(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = readIdentitySessionToken(request) ?? "";
    await this.service.revokeSession(token);
    const secure = this.environment.SEVO_RUNTIME_ENV === "production" ? "; Secure" : "";
    void reply.header(
      "Set-Cookie",
      `sevo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    );
  }
}

function validationError(
  correlationId: string,
  message: string,
  issues: Array<{ field: string; code: "INVALID_FORMAT" }>,
) {
  return new HttpException(
    {
      code: "VALIDATION_ERROR",
      message,
      correlationId,
      details: { issues },
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}
