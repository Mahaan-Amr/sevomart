import { randomUUID } from "node:crypto";

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
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  readMySellerApplicationsQueryContract,
  resubmitSellerApplicationContract,
  sellerApplicationIdContract,
  sellerApplicationInputContract,
  withdrawSellerApplicationContract,
} from "@sevo/contracts/identity-access/v1";
import type { FastifyRequest } from "fastify";

import { readIdentitySessionToken } from "../../http/identity-session";

import {
  ActiveSellerApplicationExistsError,
  InvalidSellerApplicationTransitionError,
  SellerApplicationCursorError,
  SellerApplicationIdempotencyConflictError,
  SellerApplicationIdempotencyInProgressError,
  SellerApplicationNotFoundError,
  SellerApplicationRevisionConflictError,
  SellerAccessExistsError,
  type SellerApplicationApplicant,
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
} from "./public";
import { SELLER_APPLICATION_APPLICANT } from "./identity-access.tokens";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@ApiExcludeController()
@Controller("v1/seller-applications")
export class SellerApplicationController {
  constructor(
    @Inject(SELLER_APPLICATION_APPLICANT)
    private readonly applicant: SellerApplicationApplicant,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
  ) {}

  @Post()
  async submit(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = sellerApplicationInputContract.safeParse(body);
    const key =
      typeof idempotencyKey === "string" && UUID_PATTERN.test(idempotencyKey)
        ? idempotencyKey
        : undefined;
    if (!input.success || !key) {
      throw validationError(request.id, input.success ? [] : input.error.issues, !!key);
    }
    const identityId = await this.requireIdentity(request);
    const correlationId = correlationIdFor(request.id);
    try {
      return await this.applicant.submit(
        { identityId, correlationId, idempotencyKey: key },
        input.data,
      );
    } catch (error) {
      throw mapApplicationError(error, correlationId);
    }
  }

  @Get("mine")
  async readMine(
    @Query("cursor") cursor: string | undefined,
    @Query("limit") rawLimit: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const query = readMySellerApplicationsQueryContract.safeParse({
      cursor,
      limit: rawLimit === undefined ? undefined : Number(rawLimit),
    });
    if (!query.success) {
      throw validationError(request.id, query.error.issues, undefined);
    }
    const identityId = await this.requireIdentity(request);
    try {
      return await this.applicant.readMine(identityId, query.data);
    } catch (error) {
      throw mapApplicationError(error, correlationIdFor(request.id));
    }
  }

  @Post(":applicationId/resubmission")
  @HttpCode(HttpStatus.OK)
  async resubmit(
    @Param("applicationId") applicationId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const id = sellerApplicationIdContract.safeParse(applicationId);
    const input = resubmitSellerApplicationContract.safeParse(body);
    const key =
      typeof idempotencyKey === "string" && UUID_PATTERN.test(idempotencyKey)
        ? idempotencyKey
        : undefined;
    if (!id.success || !input.success || !key) {
      const issues = [
        ...(id.success ? [] : id.error.issues),
        ...(input.success ? [] : input.error.issues),
      ];
      throw validationError(request.id, issues, !!key);
    }
    const identityId = await this.requireIdentity(request);
    const correlationId = correlationIdFor(request.id);
    try {
      return await this.applicant.resubmit(
        { identityId, correlationId, idempotencyKey: key },
        id.data,
        input.data,
      );
    } catch (error) {
      throw mapApplicationError(error, correlationId);
    }
  }

  @Post(":applicationId/withdrawal")
  @HttpCode(HttpStatus.OK)
  async withdraw(
    @Param("applicationId") applicationId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const id = sellerApplicationIdContract.safeParse(applicationId);
    const input = withdrawSellerApplicationContract.safeParse(body);
    const key =
      typeof idempotencyKey === "string" && UUID_PATTERN.test(idempotencyKey)
        ? idempotencyKey
        : undefined;
    if (!id.success || !input.success || !key) {
      const issues = [
        ...(id.success ? [] : id.error.issues),
        ...(input.success ? [] : input.error.issues),
      ];
      throw validationError(request.id, issues, !!key);
    }
    const identityId = await this.requireIdentity(request);
    const correlationId = correlationIdFor(request.id);
    try {
      return await this.applicant.withdraw(
        { identityId, correlationId, idempotencyKey: key },
        id.data,
        input.data,
      );
    } catch (error) {
      throw mapApplicationError(error, correlationId);
    }
  }

  private async requireIdentity(request: FastifyRequest): Promise<string> {
    const token = readIdentitySessionToken(request);
    const session = token
      ? await this.sessions.readActiveIdentitySession(token)
      : undefined;
    if (!session) {
      throw new HttpException(
        {
          code: "UNAUTHORIZED",
          message: "برای ثبت یا پیگیری درخواست وارد شوید.",
          correlationId: request.id,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return session.actor.identityId;
  }
}

function validationError(
  correlationId: string,
  issues: readonly { path: PropertyKey[]; code: string }[],
  hasIdempotencyKey: boolean | undefined,
) {
  return new HttpException(
    {
      code: "VALIDATION_ERROR",
      message: "اطلاعات درخواست را کامل و درست وارد کنید.",
      correlationId,
      details: {
        issues: [
          ...issues.map((issue) => ({
            field: issue.path.map(String).join(".") || "applicationId",
            code: issue.code === "too_small" ? "TOO_SHORT" : "INVALID_FORMAT",
          })),
          ...(hasIdempotencyKey === false
            ? [{ field: "idempotencyKey", code: "INVALID_FORMAT" }]
            : []),
        ],
      },
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function mapApplicationError(error: unknown, correlationId: string): HttpException {
  if (error instanceof SellerApplicationNotFoundError) {
    return applicationError(
      "APPLICATION_NOT_FOUND",
      "درخواست فروشندگی پیدا نشد.",
      correlationId,
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof ActiveSellerApplicationExistsError) {
    return applicationError(
      "ACTIVE_APPLICATION_EXISTS",
      "یک درخواست در حال بررسی دارید.",
      correlationId,
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof SellerAccessExistsError) {
    return applicationError(
      "SELLER_ALREADY_ACTIVE",
      "این هویت پیش‌تر فروشندگی داشته است.",
      correlationId,
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof InvalidSellerApplicationTransitionError) {
    return applicationError(
      "INVALID_APPLICATION_TRANSITION",
      "این تغییر با وضعیت فعلی درخواست سازگار نیست.",
      correlationId,
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof SellerApplicationRevisionConflictError) {
    return applicationError(
      "APPLICATION_REVISION_CONFLICT",
      "درخواست تغییر کرده است؛ تازه‌ترین نسخه را ببینید.",
      correlationId,
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof SellerApplicationIdempotencyConflictError) {
    return applicationError(
      "IDEMPOTENCY_CONFLICT",
      "این شناسه قبلاً برای اطلاعات دیگری استفاده شده است.",
      correlationId,
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof SellerApplicationIdempotencyInProgressError) {
    return applicationError(
      "IDEMPOTENCY_IN_PROGRESS",
      "درخواست قبلی هنوز در حال ثبت است؛ کمی بعد دوباره تلاش کنید.",
      correlationId,
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof SellerApplicationCursorError) {
    return applicationError(
      "INVALID_CURSOR",
      "ادامه فهرست درخواست‌ها معتبر نیست.",
      correlationId,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return error instanceof HttpException
    ? error
    : new HttpException(
        {
          code: "INTERNAL_SERVER_ERROR",
          message: "درخواست انجام نشد. دوباره تلاش کنید.",
          correlationId,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
}

function applicationError(
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
