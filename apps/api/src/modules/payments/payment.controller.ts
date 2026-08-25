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
  sellerActionableOrderListContract,
} from "@sevo/contracts/payments/v1";
import type { RuntimeEnvironment } from "@sevo/config";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { requireIdentity } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  SELLER_ACCESS_READ,
  type IdentitySessionReader,
  type SellerAccessRead,
} from "../identity-access/public";
import { DevDirectPaymentProvider } from "./testing/dev-direct-payment-provider";
import {
  DIRECT_PAYMENT_PROVIDER,
  DIRECT_PAYMENT_SERVICE,
  SELLER_STORE_RESOLVER,
} from "./payments.tokens";
import type { DirectPaymentService } from "./public";
import { DirectPaymentAttemptNotFoundError } from "./public";
import { InvalidProviderCallbackError } from "./public";

type SellerStoreResolver = (identityId: string) => Promise<string | undefined>;

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
    @Inject(DIRECT_PAYMENT_PROVIDER)
    private readonly provider: DevDirectPaymentProvider,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
    @Inject(SELLER_ACCESS_READ) private readonly sellerAccess: SellerAccessRead,
    @Inject(SELLER_STORE_RESOLVER)
    private readonly resolveSellerStore: SellerStoreResolver,
    @Inject("PAYMENTS_RUNTIME_ENVIRONMENT")
    private readonly environment: RuntimeEnvironment,
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
    return this.payments.createAttempt({
      identityId,
      orderId,
      idempotencyKey: requireIdempotencyKey(request.id, rawKey),
      correlationId: request.id,
    });
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
      return await this.payments.readAttempt(identityId, attemptId);
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

  @Post("payment-providers/dev/callbacks")
  @HttpCode(HttpStatus.OK)
  async callback(@Req() request: FastifyRequest) {
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
      throw error;
    }
  }

  @Get("payment-providers/dev/pay/:attemptId")
  async completeDevPayment(
    @Param("attemptId") attemptId: string,
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const attempt = await this.payments.readAttempt(identityId, attemptId);
    const callback = this.provider.successCallback({
      attemptId: attempt.attemptId,
      orderId: attempt.orderId,
      amount: attempt.amount.amount,
      providerEventId: `dev-${attempt.attemptId}`,
    });
    await this.payments.applyCallback(callback, request.id);
    return response.redirect(
      `${this.environment.WEB_ORIGIN}/orders/${attempt.orderId}?attemptId=${attempt.attemptId}`,
      303,
    );
  }

  @Get("seller/orders")
  async sellerOrders(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    const identityId = await requireIdentity(request, this.sessions);
    if (
      !(await this.sellerAccess.isActiveSeller(identityIdContract.parse(identityId)))
    ) {
      throw new HttpException(
        {
          code: "FORBIDDEN",
          message: "فروشندگی فعال نیست.",
          correlationId: request.id,
        },
        HttpStatus.FORBIDDEN,
      );
    }
    const storeId = await this.resolveSellerStore(identityId);
    if (!storeId) {
      throw new HttpException(
        { code: "NOT_FOUND", message: "فروشگاه پیدا نشد.", correlationId: request.id },
        HttpStatus.NOT_FOUND,
      );
    }
    return sellerActionableOrderListContract.parse({
      orders: await this.payments.listSellerActionable(storeId),
    });
  }
}
