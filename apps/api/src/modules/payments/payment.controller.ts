import { timingSafeEqual } from "node:crypto";

import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  providerCallbackResultContract,
  paymentIdempotencyKeyContract,
  paymentReviewQueueContract,
} from "@sevo/contracts/payments/v1";
import type { RuntimeEnvironment } from "@sevo/config";
import {
  identityIdContract,
  orderIdContract,
  paymentAttemptIdContract,
} from "@sevo/contracts/platform/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { readPlatformSessionToken, requireIdentity } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
  PlatformAgentSessionUnauthorizedError,
  PlatformPermissionRequiredError,
  type PlatformAgentSessionAuthorizer,
} from "../identity-access/public";
import { DevDirectPaymentProvider } from "./testing/dev-direct-payment-provider";
import {
  DIRECT_PAYMENT_PROVIDER,
  DIRECT_PAYMENT_SERVICE,
  PAYMENT_REVIEW_AUTHORIZER,
} from "./payments.tokens";
import type { DirectPaymentProvider, DirectPaymentService } from "./public";
import { PaymentRecoveryRunner } from "./application/payment-recovery.runner";
import {
  DirectPaymentAmountMismatchError,
  DirectPaymentAttemptNotFoundError,
  DirectPaymentDispatchInProgressError,
  DirectPaymentIdempotencyConflictError,
  DirectPaymentOrderNotPayableError,
  InvalidProviderCallbackError,
} from "./public";

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
@Controller("v1/platform/payment-reviews")
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
      return paymentReviewQueueContract.parse({
        items: await this.payments.listReviewRequired(),
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
    @Inject(DIRECT_PAYMENT_PROVIDER)
    private readonly provider: DirectPaymentProvider,
  ) {}

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
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const attempt = await this.payments.readAttempt(
      identityIdContract.parse(identityId),
      paymentAttemptIdContract.parse(attemptId),
    );
    await this.payments.applyCallback(
      this.provider.successCallback({
        attemptId: attempt.attemptId,
        orderId: attempt.orderId,
        amount: attempt.amount.amount,
        providerEventId: `dev-${attempt.attemptId}`,
      }),
      request.id,
    );
    return response.redirect(
      `${this.environment.WEB_ORIGIN}/orders/${attempt.orderId}?attemptId=${attempt.attemptId}`,
      303,
    );
  }
}
