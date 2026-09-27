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
import type { RuntimeEnvironment } from "@sevo/config";
import {
  createPurchaseGroupInputContract,
  devPurchaseGroupPaymentInputContract,
  prepareCheckoutInputV2Contract,
  purchaseGroupIdContract,
} from "@sevo/contracts/orders/v2";
import type { FastifyReply, FastifyRequest } from "fastify";

import { requireIdentity } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
} from "../identity-access/public";
import { InventoryReservationUnavailableError } from "../inventory/public";
import { MultiStoreCheckoutService } from "./application/multi-store-checkout.service";
import { checkoutError, checkoutValidationError } from "./checkout.controller";
import { requireIdempotencyKey } from "./orders-http";

export const MULTI_STORE_CHECKOUT_SERVICE = Symbol("MULTI_STORE_CHECKOUT_SERVICE");

@ApiExcludeController()
@Controller("v2")
export class MultiStoreCheckoutController {
  constructor(
    @Inject(MULTI_STORE_CHECKOUT_SERVICE)
    private readonly checkout: MultiStoreCheckoutService,
    @Inject(IDENTITY_SESSION_READER) private readonly sessions: IdentitySessionReader,
    @Inject("ORDERS_RUNTIME_ENVIRONMENT")
    private readonly environment: RuntimeEnvironment,
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
    const input = prepareCheckoutInputV2Contract.safeParse(body);
    if (!input.success) throw checkoutValidationError(request.id);
    const identityId = await requireIdentity(request, this.sessions);
    try {
      return await this.checkout.prepare(identityId, input.data);
    } catch (error) {
      throw checkoutError(error, request.id);
    }
  }

  @Post("purchase-groups")
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    if (this.environment.SEVO_RUNTIME_ENV === "production") {
      throw new HttpException(
        {
          code: "PAYMENT_PROVIDER_UNAVAILABLE",
          message: "پرداخت یک‌جای این خرید هنوز آماده نیست.",
          correlationId: request.id,
        },
        HttpStatus.CONFLICT,
      );
    }
    const input = createPurchaseGroupInputContract.safeParse(body);
    if (!input.success) throw checkoutValidationError(request.id);
    const identityId = await requireIdentity(request, this.sessions);
    try {
      return await this.checkout.createGroup(
        identityId,
        input.data,
        requireIdempotencyKey(request.id, rawKey),
        request.id,
      );
    } catch (error) {
      if (error instanceof InventoryReservationUnavailableError) {
        throw new HttpException(
          {
            code: "OUT_OF_STOCK",
            message:
              "موجودی یکی از کالاها تغییر کرده است؛ کل خرید را دوباره بررسی کنید.",
            correlationId: request.id,
          },
          HttpStatus.CONFLICT,
        );
      }
      throw checkoutError(error, request.id);
    }
  }

  @Get("purchase-groups/:groupId")
  async read(
    @Param("groupId") rawGroupId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    const groupId = purchaseGroupIdContract.safeParse(rawGroupId);
    if (!groupId.success) throw checkoutValidationError(request.id);
    const identityId = await requireIdentity(request, this.sessions);
    const group = await this.checkout.readGroup(identityId, groupId.data);
    if (group) return group;
    throw new HttpException(
      {
        code: "PURCHASE_NOT_FOUND",
        message: "این خرید پیدا نشد یا متعلق به شما نیست.",
        correlationId: request.id,
      },
      HttpStatus.NOT_FOUND,
    );
  }

  @Get("purchase-groups")
  async listGroups(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    return this.checkout.listGroups(await requireIdentity(request, this.sessions));
  }

  @Post("purchase-groups/:groupId/dev-payment")
  @HttpCode(HttpStatus.OK)
  async payDev(
    @Param("groupId") rawGroupId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    if (this.environment.SEVO_RUNTIME_ENV === "production") {
      throw new HttpException(
        {
          code: "PAYMENT_PROVIDER_UNAVAILABLE",
          message: "پرداخت این خرید هنوز آماده نیست.",
          correlationId: request.id,
        },
        HttpStatus.CONFLICT,
      );
    }
    const groupId = purchaseGroupIdContract.safeParse(rawGroupId);
    const input = devPurchaseGroupPaymentInputContract.safeParse(body);
    if (!groupId.success || !input.success) throw checkoutValidationError(request.id);
    const identityId = await requireIdentity(request, this.sessions);
    try {
      return await this.checkout.payGroupDev(
        identityId,
        groupId.data,
        input.data,
        requireIdempotencyKey(request.id, rawKey),
        request.id,
      );
    } catch (error) {
      throw checkoutError(error, request.id);
    }
  }
}
