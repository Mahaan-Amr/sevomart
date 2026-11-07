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
  passwordEnrollmentContract,
  passwordLoginContract,
  passwordRecoveryContract,
} from "@sevo/contracts/identity-access/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { readIdentitySessionToken } from "../../http/identity-session";

import {
  InvalidIdentitySessionError,
  OtpRejectedError,
  OtpRequestRateLimitedError,
  IdentityOtpService,
} from "./application/identity-otp.service";
import {
  IDENTITY_OTP_SERVICE,
  RUNTIME_ENVIRONMENT,
  SELLER_PASSWORD_SERVICE,
} from "./identity-access.tokens";
import {
  PasswordBusyError,
  SellerPasswordService,
} from "./application/seller-password.service";

@ApiExcludeController()
@Controller("v1/auth")
export class IdentityAccessController {
  constructor(
    @Inject(IDENTITY_OTP_SERVICE) private readonly service: IdentityOtpService,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
    @Inject(SELLER_PASSWORD_SERVICE) private readonly passwords: SellerPasswordService,
  ) {}

  @Post("password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async enrollPassword(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = passwordEnrollmentContract.safeParse(body);
    if (!parsed.success)
      throw validationError(request.id, "رمز باید بین ۱۲ تا ۱۲۸ نویسه باشد.", [
        { field: "password", code: "INVALID_FORMAT" },
      ]);
    if (
      !(await passwordAdmission(request.id, () =>
        this.passwords.enroll(
          readIdentitySessionToken(request) ?? "",
          parsed.data.password,
        ),
      ))
    ) {
      throw new HttpException(
        {
          code: "UNAUTHORIZED",
          message: "ساخت رمز انجام نشد. دوباره وارد شوید یا رمز را بازیابی کنید.",
          correlationId: request.id,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  @Post("password/sessions")
  @HttpCode(HttpStatus.OK)
  async passwordSession(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = passwordLoginContract.safeParse(body);
    if (!parsed.success)
      throw validationError(
        request.id,
        "شماره و رمز را بررسی کنید.",
        invalidPasswordFields(parsed.error.issues),
      );
    const result = await passwordAdmission(request.id, () =>
      this.passwords.login(parsed.data.mobile, parsed.data.password),
    );
    if (!result)
      throw new HttpException(
        {
          code: "UNAUTHORIZED",
          message: "شماره یا رمز درست نیست، یا تلاش‌ها زیاد شده است.",
          correlationId: request.id,
        },
        HttpStatus.UNAUTHORIZED,
      );
    const secure = this.environment.SEVO_RUNTIME_ENV === "production" ? "; Secure" : "";
    void reply.header(
      "Set-Cookie",
      `sevo_session=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000${secure}`,
    );
    return result.session;
  }

  @Post("password/recovery/requests")
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordRecovery(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = otpRequestContract.safeParse(body);
    if (!parsed.success)
      throw validationError(request.id, "شماره موبایل را بررسی کنید.", [
        { field: "mobile", code: "INVALID_FORMAT" },
      ]);
    const result = await this.passwords.requestRecovery(parsed.data.mobile, request.id);
    if (!result)
      throw new HttpException(
        {
          code: "RATE_LIMITED",
          message: "درخواست‌ها زیاد شده است؛ کمی بعد دوباره تلاش کنید.",
          correlationId: request.id,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    return result;
  }

  @Post("password/recovery")
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = passwordRecoveryContract.safeParse(body);
    if (!parsed.success)
      throw validationError(
        request.id,
        "کد و رمز تازه را بررسی کنید.",
        invalidPasswordFields(parsed.error.issues),
      );
    if (
      !(await passwordAdmission(request.id, () =>
        this.passwords.reset(
          parsed.data.challengeId,
          parsed.data.code,
          parsed.data.password,
        ),
      ))
    ) {
      throw new HttpException(
        {
          code: "UNAUTHORIZED",
          message: "بازیابی انجام نشد. کد را بررسی کنید یا دوباره درخواست دهید.",
          correlationId: request.id,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

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
      const maxAge = 90 * 24 * 60 * 60;
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

  @Delete("sessions")
  @HttpCode(HttpStatus.NO_CONTENT)
  async endAllSessions(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (
      !(await this.service.revokeAllSessions(readIdentitySessionToken(request) ?? ""))
    ) {
      throw new HttpException(
        {
          code: "UNAUTHORIZED",
          message: "نشست شما معتبر نیست. دوباره وارد شوید.",
          correlationId: request.id,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const secure = this.environment.SEVO_RUNTIME_ENV === "production" ? "; Secure" : "";
    void reply.header(
      "Set-Cookie",
      `sevo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    );
  }
}

async function passwordAdmission<T>(
  correlationId: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof PasswordBusyError)
      throw new HttpException(
        {
          code: "RATE_LIMITED",
          message: "درخواست‌ها زیاد شده است؛ کمی بعد دوباره تلاش کنید.",
          correlationId,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    throw error;
  }
}

function invalidPasswordFields(issues: readonly { path: readonly PropertyKey[] }[]) {
  const fields = new Set(
    issues.map((issue) => (typeof issue.path[0] === "string" ? issue.path[0] : "form")),
  );
  return [...fields].map((field) => ({ field, code: "INVALID_FORMAT" as const }));
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
