import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { RuntimeEnvironment } from "@sevo/config";
import {
  cartGuestScopeContract,
  cartItemRemovalInputContract,
  cartMutationInputContract,
  cartReviewInputContract,
} from "@sevo/contracts/orders/v1";
import { variantIdContract } from "@sevo/contracts/platform/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { readIdentitySessionToken, requireIdentity } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
} from "../identity-access/public";
import { CartService } from "./application/cart.service";
import { readCookie, validationError } from "./cart.controller";
import { requireIdempotencyKey } from "./orders-http";
import {
  CartIdempotencyConflictError,
  CartIdempotencyInProgressError,
  CartLineLimitError,
  CartQuantityLimitError,
  CartResolutionRequiredError,
  CartRevisionConflictError,
  CartVariantUnavailableError,
} from "./public";
import { CART_SERVICE } from "./orders.tokens";

@ApiExcludeController()
@Controller("v2/cart")
export class CartV2Controller {
  constructor(
    @Inject(CART_SERVICE) private readonly carts: CartService,
    @Inject(IDENTITY_SESSION_READER) private readonly sessions: IdentitySessionReader,
    @Inject("ORDERS_RUNTIME_ENVIRONMENT")
    private readonly environment: RuntimeEnvironment,
  ) {}

  @Get()
  async read(@Req() request: FastifyRequest) {
    return this.carts.readV2(
      await this.optionalIdentity(request),
      readCookie(request, "sevo_cart"),
    );
  }

  @Put("items/:variantId")
  async mutate(
    @Param("variantId") rawVariantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Headers("x-sevo-guest-scope") rawGuestScope: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const variant = variantIdContract.safeParse(rawVariantId);
    const input = cartMutationInputContract.safeParse(body);
    if (!variant.success || !input.success || variant.data !== input.data.variantId) {
      throw validationError(request.id);
    }
    const guestScope = cartGuestScopeContract.safeParse(rawGuestScope);
    const identityId = await this.optionalIdentity(request);
    const guestSecret = readCookie(request, "sevo_cart");
    if (!identityId && !guestSecret && !guestScope.success) {
      throw new HttpException(
        {
          code: "GUEST_SCOPE_REQUIRED",
          message: "شناسه مهمان برای ساخت سبد لازم است. صفحه را تازه کنید.",
          correlationId: request.id,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      const result = await this.carts.mutateV2(
        identityId,
        guestSecret,
        input.data,
        requireIdempotencyKey(request.id, rawKey),
        request.id,
        guestScope.success ? guestScope.data : undefined,
      );
      if (result.guestSecret)
        response.header("set-cookie", this.cartCookie(result.guestSecret));
      return result.cart;
    } catch (error) {
      return this.mapError(error, request.id, identityId, guestSecret);
    }
  }

  @Delete("items/:variantId")
  async remove(
    @Param("variantId") rawVariantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const variant = variantIdContract.safeParse(rawVariantId);
    const input = cartItemRemovalInputContract.safeParse(body);
    if (!variant.success || !input.success) throw validationError(request.id);
    const identityId = await this.optionalIdentity(request);
    const guestSecret = readCookie(request, "sevo_cart");
    try {
      return await this.carts.removeItemV2(
        identityId,
        guestSecret,
        variant.data,
        input.data,
        requireIdempotencyKey(request.id, rawKey),
        request.id,
      );
    } catch (error) {
      return this.mapError(error, request.id, identityId, guestSecret);
    }
  }

  @Post("attach")
  @HttpCode(HttpStatus.OK)
  async attach(
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const guestSecret = readCookie(request, "sevo_cart");
    try {
      const result = await this.carts.attachV2(
        identityId,
        guestSecret,
        requireIdempotencyKey(request.id, rawKey),
        request.id,
      );
      if (result.attached) response.header("set-cookie", this.clearCartCookie());
      return result;
    } catch (error) {
      return this.mapError(error, request.id, identityId, guestSecret);
    }
  }

  @Post("review")
  @HttpCode(HttpStatus.OK)
  async review(
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = cartReviewInputContract.safeParse(body);
    if (!input.success || !input.data.confirmed) throw validationError(request.id);
    const identityId = await this.optionalIdentity(request);
    const guestSecret = readCookie(request, "sevo_cart");
    try {
      return await this.carts.confirmReviewV2(
        identityId,
        guestSecret,
        input.data,
        requireIdempotencyKey(request.id, rawKey),
        request.id,
      );
    } catch (error) {
      return this.mapError(error, request.id, identityId, guestSecret);
    }
  }

  private async optionalIdentity(request: FastifyRequest) {
    const token = readIdentitySessionToken(request);
    if (!token) return undefined;
    return (await this.sessions.readActiveIdentitySession(token))?.actor.identityId;
  }

  private async mapError(
    error: unknown,
    correlationId: string,
    identityId: string | undefined,
    guestSecret: string | undefined,
  ): Promise<never> {
    if (error instanceof CartRevisionConflictError) {
      throw new HttpException(
        {
          code: "CART_REVISION_CONFLICT",
          message: "سبد تغییر کرده است. نسخه تازه را بررسی کنید.",
          correlationId,
          currentCart: (await this.carts.readV2(identityId, guestSecret)).cart,
        },
        HttpStatus.CONFLICT,
      );
    }
    const known =
      error instanceof CartVariantUnavailableError
        ? [
            "VARIANT_UNAVAILABLE",
            "این کالا با تعداد انتخاب‌شده در دسترس نیست.",
            HttpStatus.CONFLICT,
          ]
        : error instanceof CartResolutionRequiredError
          ? [
              "CART_RESOLUTION_REQUIRED",
              "سبد پیش از ورود را با سبد حساب خود ترکیب کنید.",
              HttpStatus.CONFLICT,
            ]
          : error instanceof CartQuantityLimitError
            ? [
                "INVALID_QUANTITY",
                "تعداد مجاز بین ۱ تا ۹۹ است.",
                HttpStatus.UNPROCESSABLE_ENTITY,
              ]
            : error instanceof CartLineLimitError
              ? [
                  "CART_LIMIT_REACHED",
                  "سبد حداکثر ۱۰۰ گونه کالا دارد.",
                  HttpStatus.UNPROCESSABLE_ENTITY,
                ]
              : error instanceof CartIdempotencyConflictError
                ? [
                    "IDEMPOTENCY_CONFLICT",
                    "این شناسه درخواست قبلاً استفاده شده است.",
                    HttpStatus.CONFLICT,
                  ]
                : error instanceof CartIdempotencyInProgressError
                  ? [
                      "IDEMPOTENCY_IN_PROGRESS",
                      "درخواست هنوز در حال انجام است.",
                      HttpStatus.CONFLICT,
                    ]
                  : undefined;
    if (known) {
      throw new HttpException(
        { code: known[0], message: known[1], correlationId },
        known[2] as number,
      );
    }
    throw error;
  }

  private cartCookie(secret: string) {
    return `sevo_cart=${secret}; Path=/api/cart; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${this.secureSuffix()}`;
  }

  private clearCartCookie() {
    return `sevo_cart=; Path=/api/cart; HttpOnly; SameSite=Lax; Max-Age=0${this.secureSuffix()}`;
  }

  private secureSuffix() {
    return this.environment.SEVO_RUNTIME_ENV === "production" ? "; Secure" : "";
  }
}
