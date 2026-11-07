import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { sessionSecurityRevocationRequestContract } from "@sevo/contracts/identity-access/v1";
import type { FastifyRequest } from "fastify";
import { readPlatformSessionToken } from "../../http/identity-session";
import {
  PlatformAgentTotpService,
  TotpDeniedError,
  TotpUnavailableError,
} from "./application/platform-agent-totp.service";
import { PLATFORM_AGENT_TOTP_SERVICE } from "./identity-access.tokens";

@ApiExcludeController()
@Controller("v1/platform/security")
export class PlatformSessionSecurityController {
  constructor(
    @Inject(PLATFORM_AGENT_TOTP_SERVICE)
    private readonly totp: PlatformAgentTotpService,
  ) {}

  @Post("session-revocations")
  @HttpCode(204)
  async revoke(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = sessionSecurityRevocationRequestContract.safeParse(body);
    if (!parsed.success)
      throw new HttpException(
        {
          code: "VALIDATION_ERROR",
          message: "اطلاعات اقدام معتبر نیست.",
          correlationId: request.id,
        },
        422,
      );
    try {
      await this.totp.revokePublicSessions(
        readPlatformSessionToken(request) ?? "",
        parsed.data,
        request.id,
      );
    } catch (error) {
      if (error instanceof TotpDeniedError)
        throw new HttpException(
          {
            code: "PLATFORM_PERMISSION_REQUIRED",
            message: "اجازه یا تأیید تازه برای این اقدام معتبر نیست.",
            correlationId: request.id,
          },
          403,
        );
      if (error instanceof TotpUnavailableError)
        throw new HttpException(
          {
            code: "UNAVAILABLE",
            message: "انجام اقدام در حال حاضر ممکن نیست.",
            correlationId: request.id,
          },
          503,
        );
      throw error;
    }
  }
}
