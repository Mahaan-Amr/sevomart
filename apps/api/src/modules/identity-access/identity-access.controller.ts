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
  SellerOtpService,
  TestMobileNotAllowedError,
} from "./application/seller-otp.service";
import { RUNTIME_ENVIRONMENT, SELLER_OTP_SERVICE } from "./identity-access.tokens";

@ApiExcludeController()
@Controller("v1/auth/otp")
export class IdentityAccessController {
  constructor(
    @Inject(SELLER_OTP_SERVICE) private readonly service: SellerOtpService,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  @Post("requests")
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
      if (error instanceof TestMobileNotAllowedError) {
        throw validationError(
          request.id,
          "این شماره برای ورود آزمایشی در دسترس نیست.",
          [{ field: "mobile", code: "INVALID_FORMAT" }],
        );
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
      const secure = this.environment.NODE_ENV === "production" ? "; Secure" : "";
      void reply.header(
        "Set-Cookie",
        `sevo_seller_session=${verified.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
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
