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
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";

import { eventCorrelationId } from "../../event-correlation-id";
import { readIdentitySessionToken } from "../../http/identity-session";
import { FulfillmentService } from "./application/fulfillment.service";
import {
  FULFILLMENT_SERVICE,
  FulfillmentFault,
  type FulfillmentRequest,
} from "./public";

@ApiExcludeController()
@Controller("v1")
export class FulfillmentController {
  constructor(
    @Inject(FULFILLMENT_SERVICE)
    private readonly fulfillment: FulfillmentService,
  ) {}

  @Get("seller/orders/:orderId/fulfillment")
  readSeller(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
    @Param("orderId") orderId: string,
  ) {
    response.header("cache-control", "no-store");
    return this.respond(request, () =>
      this.fulfillment.readSeller(this.context(request), orderId),
    );
  }

  @Get("orders/:orderId/fulfillment")
  readBuyer(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
    @Param("orderId") orderId: string,
  ) {
    response.header("cache-control", "no-store");
    return this.respond(request, () =>
      this.fulfillment.readBuyer(this.context(request), orderId),
    );
  }

  @Post("seller/orders/:orderId/fulfillment/advance")
  @HttpCode(HttpStatus.OK)
  advance(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    response.header("cache-control", "no-store");
    return this.respond(request, () =>
      this.fulfillment.advance(this.context(request), orderId, body, key),
    );
  }

  private context(request: FastifyRequest): FulfillmentRequest {
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
      if (!(error instanceof FulfillmentFault)) throw error;
      const status =
        error.code === "UNAUTHENTICATED"
          ? HttpStatus.UNAUTHORIZED
          : error.code === "FORBIDDEN"
            ? HttpStatus.FORBIDDEN
            : error.code === "FULFILLMENT_NOT_FOUND"
              ? HttpStatus.NOT_FOUND
              : error.code === "IDEMPOTENCY_CONFLICT" ||
                  error.code === "IDEMPOTENCY_IN_PROGRESS"
                ? HttpStatus.CONFLICT
                : error.code === "PRECONDITION_REQUIRED"
                  ? HttpStatus.PRECONDITION_REQUIRED
                  : HttpStatus.UNPROCESSABLE_ENTITY;
      throw fulfillmentHttpError(request.id, error.code, status);
    }
  }
}

function fulfillmentHttpError(correlationId: string, code: string, status: number) {
  const messages: Record<string, string> = {
    UNAUTHENTICATED: "برای ادامه دوباره وارد شوید.",
    FORBIDDEN: "اجازه انجام این سفارش را ندارید.",
    FULFILLMENT_NOT_FOUND: "انجام سفارش پیدا نشد.",
    INVALID_TRANSITION: "این تغییر با وضعیت فعلی سفارش سازگار نیست.",
    IDEMPOTENCY_CONFLICT: "این شناسه درخواست قبلاً با اطلاعات دیگری استفاده شده است.",
    IDEMPOTENCY_IN_PROGRESS: "درخواست مشابه هنوز در حال انجام است.",
    PRECONDITION_REQUIRED: "شناسه یکتای درخواست را ارسال کنید.",
    VALIDATION_ERROR: "اطلاعات تغییر وضعیت کامل یا معتبر نیست.",
  };
  return new HttpException(
    { code, message: messages[code] ?? messages.VALIDATION_ERROR, correlationId },
    status,
  );
}
