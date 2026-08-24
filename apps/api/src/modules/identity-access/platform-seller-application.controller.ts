import { randomUUID } from "node:crypto";

import {
  Controller,
  Body,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Query,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  platformSellerApplicationListQueryContract,
  idempotencyKeyContract,
  rejectSellerApplicationContract,
  requestSellerApplicationInformationContract,
  sellerApplicationIdContract,
} from "@sevo/contracts/identity-access/v1";
import type { FastifyRequest } from "fastify";

import { readPlatformSessionToken } from "../../http/identity-session";

import {
  PLATFORM_AGENT_SESSION_AUTHORIZER,
  SELLER_APPLICATION_REVIEWER,
} from "./identity-access.tokens";
import {
  PlatformAgentSessionUnauthorizedError,
  PlatformPermissionRequiredError,
  SellerApplicationCursorError,
  SellerApplicationNotFoundError,
  InvalidSellerApplicationTransitionError,
  SellerApplicationIdempotencyConflictError,
  SellerApplicationIdempotencyInProgressError,
  SellerApplicationRevisionConflictError,
  SellerApplicationSelfReviewForbiddenError,
  type PlatformAgentSessionAuthorizer,
  type SellerApplicationReviewer,
} from "./public";

@ApiExcludeController()
@Controller("v1/platform/seller-applications")
export class PlatformSellerApplicationController {
  constructor(
    @Inject(SELLER_APPLICATION_REVIEWER)
    private readonly reviewer: SellerApplicationReviewer,
    @Inject(PLATFORM_AGENT_SESSION_AUTHORIZER)
    private readonly sessions: PlatformAgentSessionAuthorizer,
  ) {}

  @Get()
  async list(
    @Query("status") status: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") rawLimit: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const query = platformSellerApplicationListQueryContract.safeParse({
      status,
      cursor,
      limit: rawLimit === undefined ? undefined : Number(rawLimit),
    });
    if (!query.success) {
      throw new HttpException(
        {
          code: "VALIDATION_ERROR",
          message: "فیلتر صف درخواست‌ها معتبر نیست.",
          correlationId: request.id,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.requireAgent(request);
    try {
      return await this.reviewer.list(query.data);
    } catch (error) {
      if (error instanceof SellerApplicationCursorError) {
        throw new HttpException(
          {
            code: "INVALID_CURSOR",
            message: "ادامه صف درخواست‌ها معتبر نیست.",
            correlationId: request.id,
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw error;
    }
  }

  @Get(":applicationId")
  async read(
    @Param("applicationId") applicationId: string,
    @Req() request: FastifyRequest,
  ) {
    const id = sellerApplicationIdContract.safeParse(applicationId);
    if (!id.success) {
      throw new HttpException(
        {
          code: "VALIDATION_ERROR",
          message: "شناسه درخواست معتبر نیست.",
          correlationId: request.id,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const actor = await this.requireAgent(request);
    const correlationId = correlationIdFor(request.id);
    try {
      return await this.reviewer.read({ ...actor, correlationId }, id.data);
    } catch (error) {
      if (error instanceof SellerApplicationNotFoundError) {
        throw new HttpException(
          {
            code: "APPLICATION_NOT_FOUND",
            message: "درخواست فروشندگی پیدا نشد.",
            correlationId,
          },
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }

  @Post(":applicationId/information-request")
  @HttpCode(HttpStatus.OK)
  async requestInformation(
    @Param("applicationId") applicationId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const id = sellerApplicationIdContract.safeParse(applicationId);
    const input = requestSellerApplicationInformationContract.safeParse(body);
    const key = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!id.success || !input.success || !key.success) {
      throw new HttpException(
        {
          code: "VALIDATION_ERROR",
          message: "دلیل و اطلاعات درخواستی را کامل و درست وارد کنید.",
          correlationId: request.id,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const actor = await this.requireAgent(request);
    const correlationId = correlationIdFor(request.id);
    try {
      return await this.reviewer.requestInformation(
        { ...actor, correlationId, idempotencyKey: key.data },
        id.data,
        input.data,
      );
    } catch (error) {
      throw mapReviewError(error, correlationId);
    }
  }

  @Post(":applicationId/rejection")
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param("applicationId") applicationId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const id = sellerApplicationIdContract.safeParse(applicationId);
    const input = rejectSellerApplicationContract.safeParse(body);
    const key = idempotencyKeyContract.safeParse(idempotencyKey);
    if (!id.success || !input.success || !key.success) {
      throw new HttpException(
        {
          code: "VALIDATION_ERROR",
          message: "دلیل رد درخواست را کامل و درست وارد کنید.",
          correlationId: request.id,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const actor = await this.requireAgent(request);
    const correlationId = correlationIdFor(request.id);
    try {
      return await this.reviewer.reject(
        { ...actor, correlationId, idempotencyKey: key.data },
        id.data,
        input.data,
      );
    } catch (error) {
      throw mapReviewError(error, correlationId);
    }
  }

  private async requireAgent(request: FastifyRequest) {
    try {
      return await this.sessions.authorizeSellerApplicationReview(
        readPlatformSessionToken(request) ?? "",
      );
    } catch (error) {
      if (error instanceof PlatformAgentSessionUnauthorizedError) {
        throw new HttpException(
          {
            code: "UNAUTHORIZED",
            message: "برای بررسی درخواست‌ها با نشست عامل پلتفرم وارد شوید.",
            correlationId: request.id,
          },
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (error instanceof PlatformPermissionRequiredError) {
        throw new HttpException(
          {
            code: "PLATFORM_PERMISSION_REQUIRED",
            message: "مجوز بررسی درخواست فروشندگی برای این نشست فعال نیست.",
            correlationId: request.id,
          },
          HttpStatus.FORBIDDEN,
        );
      }
      throw error;
    }
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapReviewError(error: unknown, correlationId: string): HttpException {
  if (error instanceof PlatformPermissionRequiredError) {
    return reviewError(
      "PLATFORM_PERMISSION_REQUIRED",
      "مجوز بررسی درخواست فروشندگی برای این نشست فعال نیست.",
      correlationId,
      HttpStatus.FORBIDDEN,
    );
  }
  if (error instanceof SellerApplicationNotFoundError) {
    return reviewError(
      "APPLICATION_NOT_FOUND",
      "درخواست فروشندگی پیدا نشد.",
      correlationId,
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof SellerApplicationRevisionConflictError) {
    return reviewError(
      "APPLICATION_REVISION_CONFLICT",
      "درخواست تغییر کرده است؛ تازه‌ترین نسخه را ببینید.",
      correlationId,
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof InvalidSellerApplicationTransitionError) {
    return reviewError(
      "INVALID_APPLICATION_TRANSITION",
      "این تصمیم با وضعیت فعلی درخواست سازگار نیست.",
      correlationId,
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof SellerApplicationSelfReviewForbiddenError) {
    return reviewError(
      "SELF_REVIEW_FORBIDDEN",
      "این درخواست متعلق به خود شماست و باید عامل دیگری آن را بررسی کند.",
      correlationId,
      HttpStatus.FORBIDDEN,
    );
  }
  if (error instanceof SellerApplicationIdempotencyConflictError) {
    return reviewError(
      "IDEMPOTENCY_CONFLICT",
      "این شناسه قبلاً برای تصمیم دیگری استفاده شده است.",
      correlationId,
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof SellerApplicationIdempotencyInProgressError) {
    return reviewError(
      "IDEMPOTENCY_IN_PROGRESS",
      "تصمیم قبلی هنوز در حال ثبت است؛ کمی بعد دوباره تلاش کنید.",
      correlationId,
      HttpStatus.CONFLICT,
    );
  }
  return error instanceof HttpException
    ? error
    : new HttpException(
        {
          code: "INTERNAL_SERVER_ERROR",
          message: "تصمیم ثبت نشد. دوباره تلاش کنید.",
          correlationId,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
}

function reviewError(
  code: string,
  message: string,
  correlationId: string,
  status: HttpStatus,
) {
  return new HttpException({ code, message, correlationId }, status);
}

function correlationIdFor(requestId: string): string {
  return UUID_PATTERN.test(requestId) ? requestId : randomUUID();
}
