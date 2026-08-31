import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";

import { eventCorrelationId } from "../../event-correlation-id";
import {
  readIdentitySessionToken,
  readPlatformSessionToken,
} from "../../http/identity-session";
import { PlatformAccessError } from "../identity-access/public";
import { ProblemFollowUpService } from "./application/problem-follow-up.service";
import { PROBLEM_FOLLOW_UP_SERVICE, ProblemFollowUpFault } from "./public";

@ApiExcludeController()
@Controller()
export class ProblemFollowUpController {
  constructor(
    @Inject(PROBLEM_FOLLOW_UP_SERVICE)
    private readonly service: ProblemFollowUpService,
  ) {}

  @Post("v2/buyer/disputes")
  @HttpCode(HttpStatus.CREATED)
  open(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.respond(request, response, () =>
      this.service.open(this.buyerContext(request), body, key),
    );
  }

  @Get("v1/buyer/disputes/:disputeId")
  readBuyer(
    @Param("disputeId") disputeId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.respond(request, response, () =>
      this.service.readBuyer(this.buyerContext(request), disputeId),
    );
  }

  @Get("v1/seller/disputes")
  listSeller(
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.respond(request, response, () =>
      this.service.listSeller(this.buyerContext(request), cursor, limit),
    );
  }

  @Get("v1/seller/disputes/:disputeId")
  readSeller(
    @Param("disputeId") disputeId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.respond(request, response, () =>
      this.service.readSeller(this.buyerContext(request), disputeId),
    );
  }

  @Post("v2/seller/disputes/:disputeId/response")
  @HttpCode(HttpStatus.OK)
  respondAsSeller(
    @Param("disputeId") disputeId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.respond(request, response, () =>
      this.service.respond(this.buyerContext(request), disputeId, body, key),
    );
  }

  @Get("v1/platform/disputes")
  listPlatformDisputes(
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.respond(request, response, () =>
      this.service.listPlatformDisputes(this.platformContext(request), cursor, limit),
    );
  }

  @Get("v1/platform/disputes/:disputeId")
  readPlatformDispute(
    @Param("disputeId") disputeId: string,
    @Headers("x-platform-access-grant-id") grantId: string | undefined,
    @Headers("x-platform-access-reason") reason: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.respond(request, response, () =>
      this.service.readPlatformDispute(this.platformContext(request), disputeId, {
        grantId: grantId ?? "",
        reason: reason ?? "",
      }),
    );
  }

  @Post("v2/platform/disputes/:disputeId/resolution")
  @HttpCode(HttpStatus.OK)
  resolve(
    @Param("disputeId") disputeId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Headers("x-platform-access-grant-id") grantId: string | undefined,
    @Headers("x-platform-access-reason") reason: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.respond(request, response, () =>
      this.service.resolve(this.platformContext(request), disputeId, body, key, {
        grantId: grantId ?? "",
        reason: reason ?? "",
      }),
    );
  }

  @Post("v2/platform/disputes/:disputeId/reopening")
  @HttpCode(HttpStatus.OK)
  reopen(
    @Param("disputeId") disputeId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Headers("x-platform-access-grant-id") grantId: string | undefined,
    @Headers("x-platform-access-reason") reason: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.respond(request, response, () =>
      this.service.reopen(this.platformContext(request), disputeId, body, key, {
        grantId: grantId ?? "",
        reason: reason ?? "",
      }),
    );
  }

  @Get("v1/platform/violations")
  listPlatformViolations(
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.respond(request, response, () =>
      this.service.listPlatformViolations(this.platformContext(request), cursor, limit),
    );
  }

  @Get("v1/platform/violations/:violationCaseId")
  readPlatformViolation(
    @Param("violationCaseId") violationCaseId: string,
    @Headers("x-platform-access-grant-id") grantId: string | undefined,
    @Headers("x-platform-access-reason") reason: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.respond(request, response, () =>
      this.service.readPlatformViolation(
        this.platformContext(request),
        violationCaseId,
        { grantId: grantId ?? "", reason: reason ?? "" },
      ),
    );
  }

  private buyerContext(request: FastifyRequest) {
    return this.context(request, readIdentitySessionToken(request));
  }

  private platformContext(request: FastifyRequest) {
    return this.context(request, readPlatformSessionToken(request));
  }

  private context(request: FastifyRequest, sessionToken: string | undefined) {
    request.id = eventCorrelationId(request.id);
    return { sessionToken, correlationId: request.id };
  }

  private async respond(
    request: FastifyRequest,
    response: FastifyReply,
    operation: () => Promise<unknown>,
  ) {
    response.header("cache-control", "no-store");
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PlatformAccessError) {
        throw problemHttpError(
          request.id,
          "SENSITIVE_ACCESS_REQUIRED",
          HttpStatus.FORBIDDEN,
        );
      }
      if (!(error instanceof ProblemFollowUpFault)) throw error;
      if (error.code === "UNAUTHENTICATED") {
        throw problemHttpError(request.id, "UNAUTHORIZED", HttpStatus.UNAUTHORIZED);
      }
      if (error.code === "VALIDATION_ERROR") {
        throw new HttpException(
          {
            code: "VALIDATION_ERROR",
            message: "اطلاعات پرونده معتبر نیست.",
            correlationId: request.id,
            details: { issues: [{ field: "request", code: "INVALID_FORMAT" }] },
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const status =
        error.code === "FORBIDDEN" || error.code === "SENSITIVE_ACCESS_REQUIRED"
          ? HttpStatus.FORBIDDEN
          : error.code === "NOT_FOUND"
            ? HttpStatus.NOT_FOUND
            : error.code === "PRECONDITION_REQUIRED"
              ? HttpStatus.PRECONDITION_REQUIRED
              : HttpStatus.CONFLICT;
      throw problemHttpError(request.id, error.code, status);
    }
  }
}

function problemHttpError(correlationId: string, code: string, status: number) {
  const messages: Record<string, string> = {
    UNAUTHORIZED: "برای ادامه دوباره وارد شوید.",
    FORBIDDEN: "اجازه انجام این کار را ندارید.",
    WINDOW_CLOSED: "مهلت ثبت این پرونده گذشته است.",
    DEADLINE_PASSED: "مهلت این اقدام گذشته است؛ وضعیت پرونده را تازه کنید.",
    INVALID_TRANSITION: "این اقدام با وضعیت فعلی پرونده سازگار نیست.",
    NOT_FOUND: "پرونده پیدا نشد.",
    SENSITIVE_ACCESS_REQUIRED: "دسترسی محدود و زنده همین پرونده لازم است.",
    IDEMPOTENCY_CONFLICT: "این شناسه درخواست قبلاً با اطلاعات دیگری استفاده شده است.",
    IDEMPOTENCY_IN_PROGRESS: "درخواست مشابه هنوز در حال انجام است.",
    PRECONDITION_REQUIRED: "شناسه یکتای درخواست را ارسال کنید.",
  };
  return new HttpException(
    { code, message: messages[code] ?? messages.VALIDATION_ERROR, correlationId },
    status,
  );
}
