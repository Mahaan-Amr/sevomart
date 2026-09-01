import { timingSafeEqual } from "node:crypto";

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
import {
  providerCallbackResultContract,
  paymentIdempotencyKeyContract,
} from "@sevo/contracts/payments/v1";
import {
  paymentReconciliationRequestV2Contract,
  paymentReconciliationRequestInputV2Contract,
  paymentReviewDetailV2Contract,
  paymentReviewQueueV2Contract,
  paymentReviewRevealInputV2Contract,
} from "@sevo/contracts/payments/v2";
import type { RuntimeEnvironment } from "@sevo/config";
import {
  identityIdContract,
  orderIdContract,
  paymentAttemptIdContract,
} from "@sevo/contracts/platform/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { eventCorrelationId } from "../../event-correlation-id";
import {
  readIdentitySessionToken,
  readPlatformSessionToken,
  requireIdentity,
} from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
  PlatformAgentSessionUnauthorizedError,
  PlatformPermissionRequiredError,
  PlatformAccessError,
  type PlatformAgentSessionAuthorizer,
} from "../identity-access/public";
import { DevDirectPaymentProvider } from "./testing/dev-direct-payment-provider";
import {
  DIRECT_PAYMENT_PROVIDER,
  DIRECT_PAYMENT_SERVICE,
  DIRECT_REFUND_SERVICE,
  PAYMENT_REVIEW_AUTHORIZER,
} from "./payments.tokens";
import type {
  DirectPaymentProvider,
  DirectPaymentService,
  DirectRefundRequest,
  DirectRefundService,
} from "./public";
import { PaymentRecoveryRunner } from "./application/payment-recovery.runner";
import {
  DirectPaymentAmountMismatchError,
  DirectPaymentAttemptNotFoundError,
  DirectPaymentDispatchInProgressError,
  DirectPaymentIdempotencyConflictError,
  DirectPaymentOrderNotPayableError,
  InvalidProviderCallbackError,
  DirectRefundFault,
  PaymentReconciliationNotAvailableError,
  PaymentReviewNotFoundError,
} from "./public";

@ApiExcludeController()
@Controller("v1/seller/orders")
export class DirectRefundController {
  constructor(
    @Inject(DIRECT_REFUND_SERVICE) private readonly refunds: DirectRefundService,
  ) {}

  @Post(":orderId/direct-refund")
  @HttpCode(HttpStatus.OK)
  request(
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    return this.respond(request, () =>
      this.refunds.request(this.context(request), orderId, body, key),
    );
  }

  @Get(":orderId/direct-refund")
  read(
    @Param("orderId") orderId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    return this.respond(request, () =>
      this.refunds.read(this.context(request), orderId),
    );
  }

  private context(request: FastifyRequest): DirectRefundRequest {
    request.id = eventCorrelationId(request.id);
    return {
      sessionToken: readIdentitySessionToken(request),
      correlationId: request.id,
    };
  }

  private async respond(request: FastifyRequest, operation: () => Promise<unknown>) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof DirectRefundFault)) throw error;
      const status =
        error.code === "UNAUTHENTICATED"
          ? HttpStatus.UNAUTHORIZED
          : error.code === "FORBIDDEN"
            ? HttpStatus.FORBIDDEN
            : error.code === "REFUND_NOT_FOUND"
              ? HttpStatus.NOT_FOUND
              : error.code === "IDEMPOTENCY_CONFLICT" ||
                  error.code === "DUPLICATE_RESULT" ||
                  error.code === "IDEMPOTENCY_IN_PROGRESS"
                ? HttpStatus.CONFLICT
                : error.code === "PRECONDITION_REQUIRED"
                  ? HttpStatus.PRECONDITION_REQUIRED
                  : HttpStatus.UNPROCESSABLE_ENTITY;
      const messages: Record<string, string> = {
        UNAUTHENTICATED: "برای ادامه دوباره وارد شوید.",
        FORBIDDEN: "اجازه ثبت بازپرداخت این سفارش را ندارید.",
        REFUND_NOT_FOUND: "بازپرداخت این سفارش پیدا نشد.",
        CANCELLATION_NOT_ALLOWED: "پس از ارسال، لغو و بازپرداخت از این مسیر ممکن نیست.",
        INVALID_REFUND_TRANSITION: "نتیجه بازپرداخت با وضعیت فعلی سازگار نیست.",
        REFUND_AMOUNT_MISMATCH: "مبلغ یا شناسه پرداخت بازپرداخت سازگار نیست.",
        REFUND_EVIDENCE_REQUIRED: "نتیجه معتبر درگاه یا تأیید خریدار لازم است.",
        DUPLICATE_RESULT: "این نتیجه بازپرداخت قبلاً با اطلاعات دیگری ثبت شده است.",
        IDEMPOTENCY_CONFLICT:
          "این شناسه درخواست قبلاً با اطلاعات دیگری استفاده شده است.",
        IDEMPOTENCY_IN_PROGRESS: "درخواست مشابه هنوز در حال انجام است.",
        PRECONDITION_REQUIRED: "شناسه یکتای درخواست را ارسال کنید.",
        VALIDATION_ERROR: "دلیل یا شناسه نتیجه بازپرداخت کامل و معتبر نیست.",
      };
      throw new HttpException(
        {
          code: error.code,
          message: messages[error.code],
          correlationId: request.id,
        },
        status,
      );
    }
  }
}

@ApiExcludeController()
@Controller("v1/orders")
export class BuyerDirectRefundController {
  constructor(
    @Inject(DIRECT_REFUND_SERVICE) private readonly refunds: DirectRefundService,
  ) {}

  @Get(":orderId/direct-refund")
  async read(
    @Param("orderId") orderId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    request.id = eventCorrelationId(request.id);
    try {
      return await this.refunds.readBuyer(
        {
          sessionToken: readIdentitySessionToken(request),
          correlationId: request.id,
        },
        orderId,
      );
    } catch (error) {
      if (!(error instanceof DirectRefundFault)) throw error;
      const unauthenticated = error.code === "UNAUTHENTICATED";
      throw new HttpException(
        {
          code: unauthenticated ? "UNAUTHENTICATED" : "REFUND_NOT_FOUND",
          message: unauthenticated
            ? "برای دیدن بازپرداخت دوباره وارد شوید."
            : "برای این سفارش بازپرداختی ثبت نشده یا سفارش به شما تعلق ندارد.",
          correlationId: request.id,
        },
        unauthenticated ? HttpStatus.UNAUTHORIZED : HttpStatus.NOT_FOUND,
      );
    }
  }
}

function requireIdempotencyKey(correlationId: string, value: string | undefined) {
  const key = paymentIdempotencyKeyContract.safeParse(value);
  if (!key.success) {
    throw new HttpException(
      {
        code: "PRECONDITION_REQUIRED",
        message: "شناسه یکتای درخواست لازم است.",
        correlationId,
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  return key.data;
}

@ApiExcludeController()
@Controller("v1")
export class PaymentController {
  constructor(
    @Inject(DIRECT_PAYMENT_SERVICE) private readonly payments: DirectPaymentService,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
  ) {}

  @Post("orders/:orderId/payment-attempts")
  async createAttempt(
    @Param("orderId") orderId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    const identityId = await requireIdentity(request, this.sessions);
    try {
      return await this.payments.createAttempt({
        identityId: identityIdContract.parse(identityId),
        orderId: orderIdContract.parse(orderId),
        idempotencyKey: requireIdempotencyKey(request.id, rawKey),
        correlationId: request.id,
      });
    } catch (error) {
      if (error instanceof DirectPaymentDispatchInProgressError) {
        response.header("retry-after", "1");
        throw new HttpException(
          {
            code: "IDEMPOTENCY_IN_PROGRESS",
            message: "درخواست پرداخت هنوز در حال انجام است؛ کمی بعد دوباره تلاش کنید.",
            correlationId: request.id,
          },
          HttpStatus.CONFLICT,
        );
      }
      if (error instanceof DirectPaymentOrderNotPayableError) {
        throw paymentError(
          "ORDER_NOT_PAYABLE",
          "مهلت یا وضعیت سفارش برای پرداخت آماده نیست؛ وضعیت سفارش را تازه کنید.",
          request.id,
          HttpStatus.CONFLICT,
        );
      }
      if (error instanceof DirectPaymentIdempotencyConflictError) {
        throw paymentError(
          "IDEMPOTENCY_CONFLICT",
          "این شناسه درخواست قبلاً برای پرداخت دیگری استفاده شده است.",
          request.id,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  @Get("payment-attempts/:attemptId")
  async readAttempt(
    @Param("attemptId") attemptId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    const identityId = await requireIdentity(request, this.sessions);
    try {
      return await this.payments.readAttempt(
        identityIdContract.parse(identityId),
        paymentAttemptIdContract.parse(attemptId),
      );
    } catch (error) {
      if (error instanceof DirectPaymentAttemptNotFoundError) {
        throw new HttpException(
          {
            code: "NOT_FOUND",
            message: "رسید پرداخت پیدا نشد.",
            correlationId: request.id,
          },
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }
}

@ApiExcludeController()
@Controller("v2/platform/payment-reviews")
export class PlatformPaymentReviewController {
  constructor(
    @Inject(DIRECT_PAYMENT_SERVICE) private readonly payments: DirectPaymentService,
    @Inject(PAYMENT_REVIEW_AUTHORIZER)
    private readonly sessions: PlatformAgentSessionAuthorizer,
  ) {}

  @Get()
  async list(@Req() request: FastifyRequest) {
    try {
      await this.sessions.authorizePaymentReview(
        readPlatformSessionToken(request) ?? "",
      );
      return paymentReviewQueueV2Contract.parse({
        items: await this.payments.listReviewRequiredV2(),
      });
    } catch (error) {
      if (error instanceof PlatformAgentSessionUnauthorizedError) {
        throw new HttpException(
          {
            code: "UNAUTHORIZED",
            message: "برای دیدن بررسی‌های پرداخت با نشست عامل پلتفرم وارد شوید.",
            correlationId: request.id,
          },
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (error instanceof PlatformPermissionRequiredError) {
        throw new HttpException(
          {
            code: "PLATFORM_PERMISSION_REQUIRED",
            message: "مجوز بررسی عملیاتی برای این نشست فعال نیست.",
            correlationId: request.id,
          },
          HttpStatus.FORBIDDEN,
        );
      }
      throw error;
    }
  }

  @Post(":reviewId/reveal")
  @HttpCode(HttpStatus.OK)
  async reveal(
    @Param("reviewId") rawReviewId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const reviewId = paymentAttemptIdContract.safeParse(rawReviewId);
    const input = paymentReviewRevealInputV2Contract.safeParse(body);
    if (!reviewId.success || !input.success) {
      throw paymentReviewHttpError(
        "VALIDATION_ERROR",
        "شناسه پرونده، اجازه دسترسی و دلیل بررسی را کامل کنید.",
        request.id,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const actor = await this.authorize(request);
    try {
      return paymentReviewDetailV2Contract.parse(
        await this.payments.revealReview({
          reviewId: reviewId.data,
          actorIdentityId: actor.identityId,
          grantId: input.data.grantId,
          reason: input.data.reason,
          correlationId: request.id,
        }),
      );
    } catch (error) {
      this.handleReviewError(error, request.id);
    }
  }

  @Post(":reviewId/reconciliation")
  @HttpCode(HttpStatus.ACCEPTED)
  async reconcile(
    @Param("reviewId") rawReviewId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const reviewId = paymentAttemptIdContract.safeParse(rawReviewId);
    const input = paymentReconciliationRequestInputV2Contract.safeParse(body);
    if (!reviewId.success || !input.success) {
      throw paymentReviewHttpError(
        "VALIDATION_ERROR",
        "شناسه پرونده و دلیل تطبیق دوباره را کامل کنید.",
        request.id,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const actor = await this.authorize(request);
    try {
      return paymentReconciliationRequestV2Contract.parse(
        await this.payments.requestReconciliation({
          reviewId: reviewId.data,
          actorIdentityId: actor.identityId,
          grantId: input.data.grantId,
          reason: input.data.reason,
          correlationId: request.id,
        }),
      );
    } catch (error) {
      this.handleReviewError(error, request.id);
    }
  }

  private async authorize(request: FastifyRequest) {
    try {
      return await this.sessions.authorizePaymentReview(
        readPlatformSessionToken(request) ?? "",
      );
    } catch (error) {
      this.handleReviewError(error, request.id);
    }
  }

  private handleReviewError(error: unknown, correlationId: string): never {
    if (error instanceof PlatformAgentSessionUnauthorizedError) {
      throw paymentReviewHttpError(
        "PLATFORM_PERMISSION_REQUIRED",
        "برای ادامه با نشست عامل پلتفرم وارد شوید.",
        correlationId,
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (error instanceof PlatformPermissionRequiredError) {
      throw paymentReviewHttpError(
        "PLATFORM_PERMISSION_REQUIRED",
        "مجوز بررسی پرداخت برای این نشست فعال نیست.",
        correlationId,
        HttpStatus.FORBIDDEN,
      );
    }
    if (error instanceof PlatformAccessError) {
      const responsibilityMissing = error.code === "RESPONSIBILITY_REQUIRED";
      throw paymentReviewHttpError(
        responsibilityMissing ? "RESPONSIBILITY_REQUIRED" : "SENSITIVE_SCOPE_REQUIRED",
        responsibilityMissing
          ? "مسئولیت بررسی پرداخت لغو شده است."
          : "اجازه زمان‌دار این پرونده فعال نیست یا با این پرونده سازگار نیست.",
        correlationId,
        HttpStatus.FORBIDDEN,
      );
    }
    if (error instanceof PaymentReviewNotFoundError) {
      throw paymentReviewHttpError(
        "REVIEW_NOT_FOUND",
        "این پرونده دیگر در صف مجاز شما نیست.",
        correlationId,
        HttpStatus.NOT_FOUND,
      );
    }
    if (error instanceof PaymentReconciliationNotAvailableError) {
      throw paymentReviewHttpError(
        "RECONCILIATION_NOT_AVAILABLE",
        "این پرونده دیگر نتیجه مبهمی برای تطبیق دوباره ندارد.",
        correlationId,
        HttpStatus.CONFLICT,
      );
    }
    throw error;
  }
}

function paymentReviewHttpError(
  code: string,
  message: string,
  correlationId: string,
  status: HttpStatus,
) {
  return new HttpException({ code, message, correlationId }, status);
}

@ApiExcludeController()
@Controller("v1/internal/payment-recoveries")
export class InternalPaymentRecoveryController {
  constructor(
    @Inject(PaymentRecoveryRunner)
    private readonly recovery: PaymentRecoveryRunner,
    @Inject("PAYMENTS_RUNTIME_ENVIRONMENT")
    private readonly environment: RuntimeEnvironment,
  ) {}

  @Post("run")
  async run(
    @Headers("x-sevo-worker-secret") secret: string | undefined,
  ): Promise<{ recovered: number; reconciliationClaimed: boolean }> {
    if (!sameSecret(secret, this.environment.PAYMENT_RECOVERY_SECRET)) {
      throw new HttpException("Forbidden", HttpStatus.FORBIDDEN);
    }
    return this.recovery.runOnce();
  }
}

@ApiExcludeController()
@Controller("internal/v1/payment-providers")
export class ProviderCallbackController {
  constructor(
    @Inject(DIRECT_PAYMENT_SERVICE) private readonly payments: DirectPaymentService,
    @Inject(DIRECT_REFUND_SERVICE) private readonly refunds: DirectRefundService,
    @Inject(DIRECT_PAYMENT_PROVIDER)
    private readonly provider: DirectPaymentProvider,
  ) {}

  @Post(":provider/direct-refunds")
  @HttpCode(HttpStatus.OK)
  async refund(
    @Param("provider") provider: string,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    try {
      return await this.refunds.applyProviderResult(
        provider,
        request.body,
        key,
        eventCorrelationId(request.id),
      );
    } catch (error) {
      if (!(error instanceof DirectRefundFault)) throw error;
      const status =
        error.code === "REFUND_NOT_FOUND"
          ? HttpStatus.NOT_FOUND
          : error.code === "DUPLICATE_RESULT" ||
              error.code === "IDEMPOTENCY_IN_PROGRESS"
            ? HttpStatus.CONFLICT
            : error.code === "PRECONDITION_REQUIRED"
              ? HttpStatus.PRECONDITION_REQUIRED
              : HttpStatus.UNPROCESSABLE_ENTITY;
      const messages: Record<string, string> = {
        REFUND_NOT_FOUND: "بازپرداخت این سفارش پیدا نشد.",
        REFUND_AMOUNT_MISMATCH: "مبلغ یا شناسه پرداخت بازپرداخت سازگار نیست.",
        REFUND_EVIDENCE_REQUIRED: "نتیجه بازپرداخت امضای معتبر ندارد.",
        DUPLICATE_RESULT: "این نتیجه بازپرداخت قبلاً ثبت شده است.",
        IDEMPOTENCY_IN_PROGRESS: "نتیجه مشابه هنوز در حال ثبت است.",
        PRECONDITION_REQUIRED: "شناسه یکتای نتیجه لازم است.",
        INVALID_REFUND_TRANSITION: "نتیجه بازپرداخت با وضعیت فعلی سازگار نیست.",
      };
      throw new HttpException(
        { code: error.code, message: messages[error.code], correlationId: request.id },
        status,
      );
    }
  }

  @Post(":provider/callbacks")
  @HttpCode(HttpStatus.OK)
  async callback(@Param("provider") provider: string, @Req() request: FastifyRequest) {
    if (provider.toUpperCase() !== this.provider.providerKey) {
      throw new HttpException("Unknown payment provider", HttpStatus.NOT_FOUND);
    }
    try {
      return providerCallbackResultContract.parse(
        await this.payments.applyCallback(request.body, request.id),
      );
    } catch (error) {
      if (error instanceof InvalidProviderCallbackError) {
        throw new HttpException(
          {
            code: "INVALID_CALLBACK",
            message: "نتیجه پرداخت معتبر نیست.",
            correlationId: request.id,
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (error instanceof DirectPaymentAmountMismatchError) {
        throw paymentError(
          "AMOUNT_MISMATCH",
          "مبلغ نتیجه پرداخت با سفارش یکسان نیست.",
          request.id,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (error instanceof DirectPaymentAttemptNotFoundError) {
        throw paymentError(
          "ATTEMPT_NOT_FOUND",
          "تلاش پرداخت با این نتیجه سازگار نیست.",
          request.id,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw error;
    }
  }
}

function sameSecret(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function paymentError(
  code: string,
  message: string,
  correlationId: string,
  status: HttpStatus,
) {
  return new HttpException({ code, message, correlationId }, status);
}

@ApiExcludeController()
@Controller("v1/payment-providers/dev")
export class DevPaymentController {
  constructor(
    @Inject(DIRECT_PAYMENT_SERVICE) private readonly payments: DirectPaymentService,
    @Inject(DIRECT_PAYMENT_PROVIDER)
    private readonly provider: DevDirectPaymentProvider,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
    @Inject("PAYMENTS_RUNTIME_ENVIRONMENT")
    private readonly environment: RuntimeEnvironment,
  ) {}

  @Get("pay/:attemptId")
  async completeDevPayment(
    @Param("attemptId") attemptId: string,
    @Query("scenario") scenario: string | undefined,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const attempt = await this.payments.readAttempt(
      identityIdContract.parse(identityId),
      paymentAttemptIdContract.parse(attemptId),
    );
    if (!scenario || !["success", "failure", "pending"].includes(scenario)) {
      throw paymentError(
        "DEV_PAYMENT_SCENARIO_REQUIRED",
        "برای پرداخت نمایشی یکی از نتیجه‌های success، failure یا pending را انتخاب کنید.",
        request.id,
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.payments.applyCallback(
      this.provider.scenarioCallback({
        attemptId: attempt.attemptId,
        orderId: attempt.orderId,
        amount: attempt.amount.amount,
        providerEventId: `dev-${scenario}-${attempt.attemptId}`,
        scenario: scenario as "success" | "failure" | "pending",
      }),
      request.id,
    );
    return response.redirect(
      `${this.environment.WEB_ORIGIN}/orders/${attempt.orderId}?attemptId=${attempt.attemptId}`,
      303,
    );
  }
}
