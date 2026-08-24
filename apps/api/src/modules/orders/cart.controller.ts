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
  attachCartInputContract,
  cartGuestScopeContract,
  cartItemRemovalInputContract,
  cartMutationInputContract,
  cartReviewInputContract,
  replaceCartStoreInputContract,
} from "@sevo/contracts/orders/v1";
import { variantIdContract } from "@sevo/contracts/platform/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { readIdentitySessionToken, requireIdentity } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
} from "../identity-access/public";
import { CartService } from "./application/cart.service";
import { requireIdempotencyKey } from "./orders-http";
import {
  CartIdempotencyConflictError,
  CartIdempotencyInProgressError,
  CartLineLimitError,
  CartQuantityLimitError,
  CartResolutionRequiredError,
  CartRevisionConflictError,
  CartStoreReplacementRequiredError,
  CartVariantUnavailableError,
} from "./public";
import { CART_SERVICE } from "./orders.tokens";

@ApiExcludeController()
@Controller("v1/cart")
export class CartController {
  constructor(
    @Inject(CART_SERVICE) private readonly carts: CartService,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
    @Inject("ORDERS_RUNTIME_ENVIRONMENT")
    private readonly environment: RuntimeEnvironment,
  ) {}

  @Get()
  async read(@Req() request: FastifyRequest) {
    const identityId = await this.optionalIdentity(request);
    return this.carts.read(identityId, readCookie(request, "sevo_cart"));
  }

  @Put("items/:variantId")
  async mutate(
    @Param("variantId") rawVariantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Headers("x-sevo-guest-scope") guestScope: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const variant = variantIdContract.safeParse(rawVariantId);
    const input = cartMutationInputContract.safeParse(body);
    if (!variant.success || !input.success || variant.data !== input.data.variantId) {
      throw validationError(request.id);
    }
    const key = requireIdempotencyKey(request.id, rawKey);
    const identityId = await this.optionalIdentity(request);
    const guestSecret = readCookie(request, "sevo_cart");
    const parsedGuestScope = cartGuestScopeContract.safeParse(guestScope);
    if (!identityId && !guestSecret && !parsedGuestScope.success) {
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
      const result = await this.carts.mutate(
        identityId,
        guestSecret,
        input.data,
        key,
        request.id,
        parsedGuestScope.success ? parsedGuestScope.data : undefined,
      );
      if (result.guestSecret) {
        response.header("set-cookie", this.cartCookie(result.guestSecret));
      }
      return result.cart;
    } catch (error) {
      return cartError(
        error,
        request.id,
        this.carts,
        identityId,
        readCookie(request, "sevo_cart"),
      );
    }
  }

  @Delete("items/:variantId")
  async removeItem(
    @Param("variantId") rawVariantId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const variant = variantIdContract.safeParse(rawVariantId);
    const input = cartItemRemovalInputContract.safeParse(body);
    if (!variant.success || !input.success) throw validationError(request.id);
    const key = requireIdempotencyKey(request.id, rawKey);
    const identityId = await this.optionalIdentity(request);
    try {
      return await this.carts.removeItem(
        identityId,
        readCookie(request, "sevo_cart"),
        variant.data,
        input.data,
        key,
        request.id,
      );
    } catch (error) {
      return cartError(
        error,
        request.id,
        this.carts,
        identityId,
        readCookie(request, "sevo_cart"),
      );
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
    if (!input.success) throw validationError(request.id);
    const key = requireIdempotencyKey(request.id, rawKey);
    const identityId = await this.optionalIdentity(request);
    try {
      return await this.carts.confirmReview(
        identityId,
        readCookie(request, "sevo_cart"),
        input.data,
        key,
        request.id,
      );
    } catch (error) {
      return cartError(
        error,
        request.id,
        this.carts,
        identityId,
        readCookie(request, "sevo_cart"),
      );
    }
  }

  @Post("attach")
  @HttpCode(HttpStatus.OK)
  async attach(
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const key = requireIdempotencyKey(request.id, rawKey);
    const identityId = await requireIdentity(request, this.sessions);
    const guestSecret = readCookie(request, "sevo_cart");
    let result: Awaited<ReturnType<CartService["inspectAttachment"]>>;
    try {
      result = await this.carts.inspectAttachment(
        identityId,
        guestSecret,
        key,
        request.id,
      );
    } catch (error) {
      return cartError(error, request.id, this.carts, identityId, guestSecret);
    }
    if (result.status === "RESOLUTION_REQUIRED") {
      throw new HttpException(
        {
          ...result,
          code: "CART_RESOLUTION_REQUIRED",
          message: "پیش از ادامه، تکلیف دو سبد را روشن کنید.",
          correlationId: request.id,
        },
        HttpStatus.CONFLICT,
      );
    }
    if (result.status === "ATTACHED")
      response.header("set-cookie", this.clearCartCookie());
    return result;
  }

  @Post("store-replacement")
  @HttpCode(HttpStatus.OK)
  async replaceStore(
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const input = replaceCartStoreInputContract.safeParse(body);
    if (!input.success) throw validationError(request.id);
    const key = requireIdempotencyKey(request.id, rawKey);
    const identityId = await this.optionalIdentity(request);
    try {
      const result = await this.carts.replaceStore(
        identityId,
        readCookie(request, "sevo_cart"),
        input.data,
        key,
        request.id,
      );
      if (result.guestSecret) {
        response.header("set-cookie", this.cartCookie(result.guestSecret));
      }
      return result.cart;
    } catch (error) {
      return cartError(
        error,
        request.id,
        this.carts,
        identityId,
        readCookie(request, "sevo_cart"),
      );
    }
  }

  @Post("resolve")
  @HttpCode(HttpStatus.OK)
  async resolve(
    @Body() body: unknown,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const input = attachCartInputContract.safeParse(body);
    if (!input.success) throw validationError(request.id);
    const key = requireIdempotencyKey(request.id, rawKey);
    const identityId = await requireIdentity(request, this.sessions);
    try {
      const result = await this.carts.resolveAttachment(
        identityId,
        readCookie(request, "sevo_cart"),
        input.data,
        key,
        request.id,
      );
      response.header("set-cookie", this.clearCartCookie());
      return result;
    } catch (error) {
      return cartError(
        error,
        request.id,
        this.carts,
        identityId,
        readCookie(request, "sevo_cart"),
      );
    }
  }

  private async optionalIdentity(request: FastifyRequest) {
    const token = readIdentitySessionToken(request);
    if (!token) return undefined;
    return (await this.sessions.readActiveIdentitySession(token))?.actor.identityId;
  }

  private cartCookie(secret: string) {
    return `sevo_cart=${secret}; Path=/api/cart; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${this.secureCookieSuffix()}`;
  }

  private clearCartCookie() {
    return `sevo_cart=; Path=/api/cart; HttpOnly; SameSite=Lax; Max-Age=0${this.secureCookieSuffix()}`;
  }

  private secureCookieSuffix() {
    return this.environment.SEVO_RUNTIME_ENV === "production" ? "; Secure" : "";
  }
}

function readCookie(request: FastifyRequest, name: string) {
  return request.headers.cookie
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
}

function validationError(correlationId: string) {
  return new HttpException(
    {
      code: "VALIDATION_ERROR",
      message: "گونه و تعداد انتخاب‌شده را بررسی کنید.",
      correlationId,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

async function cartError(
  error: unknown,
  correlationId: string,
  carts: CartService,
  identityId: string | undefined,
  guestSecret: string | undefined,
): Promise<never> {
  correlationId = replayedCorrelationId(error) ?? correlationId;
  if (error instanceof CartRevisionConflictError) {
    const currentCart =
      error.currentCart !== undefined
        ? error.currentCart
        : error.current
          ? await carts.present(error.current)
          : (await carts.read(identityId, guestSecret)).cart;
    throw new HttpException(
      {
        code: "CART_REVISION_CONFLICT",
        message: "سبد در جای دیگری تغییر کرده است. نسخه تازه را ببینید.",
        correlationId,
        currentCart,
        ...(currentCart
          ? {
              resolution: {
                action: "REVIEW_AND_RETRY",
                expectedRevision: currentCart.revision,
              },
            }
          : {}),
      },
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof CartIdempotencyConflictError) {
    throw conflict(
      "IDEMPOTENCY_CONFLICT",
      "این شناسه درخواست قبلاً برای تغییر دیگری استفاده شده است.",
      correlationId,
    );
  }
  if (error instanceof CartIdempotencyInProgressError) {
    throw conflict(
      "IDEMPOTENCY_IN_PROGRESS",
      "این درخواست هنوز در حال انجام است. کمی بعد دوباره تلاش کنید.",
      correlationId,
    );
  }
  if (error instanceof CartStoreReplacementRequiredError) {
    throw new HttpException(
      {
        code: "STORE_REPLACEMENT_CONFIRMATION_REQUIRED",
        message:
          "سبد فعلی برای فروشگاه دیگری است. پیش از تغییر فروشگاه انتخاب خود را تأیید کنید.",
        correlationId,
        storeReplacement: {
          currentStoreName: error.currentStoreName ?? "فروشگاه فعلی",
          nextStoreName: error.nextStoreName ?? "فروشگاه تازه",
          removedItemCount: error.removedItemCount ?? 0,
        },
      },
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof CartResolutionRequiredError) {
    throw conflict(
      "CART_RESOLUTION_REQUIRED",
      "پیش از ادامه، یکی از دو سبد را انتخاب کنید.",
      correlationId,
    );
  }
  if (error instanceof CartVariantUnavailableError) {
    throw conflict(
      "VARIANT_UNAVAILABLE",
      "این گونه اکنون با این تعداد قابل خرید نیست.",
      correlationId,
    );
  }
  if (error instanceof CartQuantityLimitError) {
    throw new HttpException(
      {
        code: "INVALID_QUANTITY",
        message: "تعداد مجاز بین ۱ تا ۹۹ است.",
        correlationId,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (error instanceof CartLineLimitError) {
    throw new HttpException(
      {
        code: "CART_LIMIT_REACHED",
        message: "سبد حداکثر می‌تواند ۱۰۰ گونه داشته باشد.",
        correlationId,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  throw error;
}

function replayedCorrelationId(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    "replayedCorrelationId" in error &&
    typeof error.replayedCorrelationId === "string"
  ) {
    return error.replayedCorrelationId;
  }
  return undefined;
}

function conflict(code: string, message: string, correlationId: string) {
  return new HttpException({ code, message, correlationId }, HttpStatus.CONFLICT);
}
