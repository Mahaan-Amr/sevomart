import {
  Body,
  Controller,
  Headers,
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
import {
  createOrderInputContract,
  prepareCheckoutInputContract,
} from "@sevo/contracts/orders/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { requireIdentity } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
} from "../identity-access/public";
import { InventoryReservationUnavailableError } from "../inventory/public";
import { CheckoutService } from "./application/checkout.service";
import { requireIdempotencyKey } from "./orders-http";
import { CHECKOUT_SERVICE } from "./orders.tokens";
import {
  CheckoutAddressInvalidError,
  CheckoutChangedError,
  CheckoutIdempotencyConflictError,
  CheckoutIdempotencyInProgressError,
  CheckoutNotReadyError,
  CheckoutRevisionExpiredError,
  CheckoutShippingUnavailableError,
} from "./public";

@ApiExcludeController()
@Controller("v1")
export class CheckoutController {
  constructor(
    @Inject(CHECKOUT_SERVICE) private readonly checkout: CheckoutService,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
  ) {}

  @Get("checkout/options")
  async options(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    const identityId = await requireIdentity(request, this.sessions);
    try {
      return await this.checkout.options(identityId);
    } catch (error) {
      throw checkoutError(error, request.id);
    }
  }

  @Post("checkout/prepare")
  @HttpCode(HttpStatus.OK)
  async prepare(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    const input = prepareCheckoutInputContract.safeParse(body);
    if (!input.success) throw checkoutValidationError(request.id);
    const identityId = await requireIdentity(request, this.sessions);
    try {
      return await this.checkout.prepare(identityId, input.data);
    } catch (error) {
      throw checkoutError(error, request.id);
    }
  }

  @Post("orders")
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    const input = createOrderInputContract.safeParse(body);
    if (!input.success) throw checkoutValidationError(request.id);
    const identityId = await requireIdentity(request, this.sessions);
    try {
      return await this.checkout.createOrder(
        identityId,
        input.data,
        requireIdempotencyKey(request.id, rawKey),
        request.id,
      );
    } catch (error) {
      if (error instanceof CheckoutIdempotencyInProgressError) {
        response.header("retry-after", "1");
      }
      throw checkoutError(error, request.id);
    }
  }
}

function checkoutValidationError(correlationId: string) {
  return new HttpException(
    {
      code: "VALIDATION_ERROR",
      message: "اطلاعات مرور سفارش کامل نیست.",
      correlationId,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function checkoutError(error: unknown, correlationId: string) {
  if (error instanceof CheckoutChangedError) {
    return new HttpException(
      {
        code: "CART_CHANGED",
        message: "اطلاعات سفارش تغییر کرده است؛ سبد را دوباره بررسی کنید.",
        correlationId,
        changes: error.changes,
      },
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof CheckoutRevisionExpiredError) {
    return conflict(
      "CHECKOUT_REVISION_EXPIRED",
      "مهلت مرور سفارش تمام شده است؛ مبلغ و موجودی را دوباره بررسی کنید.",
      correlationId,
    );
  }
  if (error instanceof InventoryReservationUnavailableError) {
    return conflict(
      "OUT_OF_STOCK",
      "موجودی یکی از کالاها تغییر کرده است؛ به سبد برگردید.",
      correlationId,
    );
  }
  if (error instanceof CheckoutAddressInvalidError) {
    return conflict(
      "ADDRESS_INVALID",
      "نشانی انتخاب‌شده تغییر کرده یا برای این روش ارسال کامل نیست.",
      correlationId,
    );
  }
  if (error instanceof CheckoutShippingUnavailableError) {
    return conflict(
      "SHIPPING_METHOD_UNAVAILABLE",
      "روش ارسال تغییر کرده است؛ یک روش تازه انتخاب کنید.",
      correlationId,
    );
  }
  if (error instanceof CheckoutIdempotencyConflictError) {
    return conflict(
      "IDEMPOTENCY_CONFLICT",
      "این شناسه درخواست قبلاً برای سفارش دیگری استفاده شده است.",
      correlationId,
    );
  }
  if (error instanceof CheckoutIdempotencyInProgressError) {
    return new HttpException(
      {
        code: "IDEMPOTENCY_IN_PROGRESS",
        message: "این درخواست هنوز در حال انجام است. کمی بعد دوباره تلاش کنید.",
        correlationId,
      },
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof CheckoutNotReadyError) {
    return conflict(
      "CHECKOUT_NOT_READY",
      "سبد هنوز برای ثبت سفارش آماده نیست.",
      correlationId,
    );
  }
  return new HttpException(
    { code: "INTERNAL_ERROR", message: "ثبت سفارش انجام نشد.", correlationId },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

function conflict(code: string, message: string, correlationId: string) {
  return new HttpException({ code, message, correlationId }, HttpStatus.CONFLICT);
}
