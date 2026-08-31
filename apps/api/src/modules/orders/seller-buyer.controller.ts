import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpCode,
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
  listStoreBuyersQueryContract,
  revealOrderDeliveryDetailsInputContract,
} from "@sevo/contracts/orders/v1";
import {
  identityIdContract,
  orderIdContract,
  storeIdContract,
} from "@sevo/contracts/platform/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { eventCorrelationId } from "../../event-correlation-id";
import { requireIdentity } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  SELLER_ACCESS_READ,
  type IdentitySessionReader,
  type SellerAccessRead,
} from "../identity-access/public";
import { RELATED_STORE_BUYER_READ, SELLER_ORDER_STORE_RESOLVER } from "./orders.tokens";
import { StoreBuyerFault, type RelatedStoreBuyerRead } from "./public";

type SellerStoreResolver = (identityId: string) => Promise<string | undefined>;

@ApiExcludeController()
@Controller("v1/seller")
export class SellerBuyerController {
  constructor(
    @Inject(RELATED_STORE_BUYER_READ)
    private readonly buyers: RelatedStoreBuyerRead,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
    @Inject(SELLER_ACCESS_READ) private readonly sellerAccess: SellerAccessRead,
    @Inject(SELLER_ORDER_STORE_RESOLVER)
    private readonly resolveSellerStore: SellerStoreResolver,
  ) {}

  @Get("buyers")
  async list(
    @Query() rawQuery: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    const { storeId } = await this.#requireSeller(request);
    const query = listStoreBuyersQueryContract.safeParse(rawQuery);
    if (!query.success) throw buyerHttpError(request.id, "VALIDATION_ERROR", 422);
    try {
      return await this.buyers.listStoreBuyers({ storeId, query: query.data });
    } catch (error) {
      throw mapBuyerFault(request.id, error);
    }
  }

  @Post("orders/:orderId/delivery-details/reveal")
  @HttpCode(HttpStatus.OK)
  async reveal(
    @Param("orderId") rawOrderId: string,
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    const { identityId, storeId } = await this.#requireSeller(request);
    const orderId = orderIdContract.safeParse(rawOrderId);
    const body = revealOrderDeliveryDetailsInputContract.safeParse(rawBody);
    if (!orderId.success) {
      throw buyerHttpError(request.id, "VALIDATION_ERROR", 422);
    }
    if (!body.success) {
      const hasReason =
        typeof rawBody === "object" && rawBody !== null && "reason" in rawBody;
      const reason = hasReason ? rawBody.reason : undefined;
      throw buyerHttpError(
        request.id,
        !hasReason || (typeof reason === "string" && reason.trim() === "")
          ? "REVEAL_REASON_REQUIRED"
          : "VALIDATION_ERROR",
        422,
      );
    }
    try {
      return await this.buyers.revealOrderDeliveryDetails({
        actorId: identityId,
        storeId,
        orderId: orderId.data,
        ...body.data,
        correlationId: eventCorrelationId(request.id),
        occurredAt: new Date(),
      });
    } catch (error) {
      throw mapBuyerFault(request.id, error);
    }
  }

  async #requireSeller(request: FastifyRequest) {
    const identityId = identityIdContract.parse(
      await requireIdentity(request, this.sessions),
    );
    if (!(await this.sellerAccess.isActiveSeller(identityId))) {
      throw buyerHttpError(request.id, "FORBIDDEN", 403);
    }
    const rawStoreId = await this.resolveSellerStore(identityId);
    if (!rawStoreId) throw buyerHttpError(request.id, "ORDER_NOT_FOUND", 404);
    return { identityId, storeId: storeIdContract.parse(rawStoreId) };
  }
}

function mapBuyerFault(correlationId: string, error: unknown): HttpException {
  if (!(error instanceof StoreBuyerFault)) throw error;
  const status = error.code === "ORDER_NOT_FOUND" ? 404 : 422;
  return buyerHttpError(correlationId, error.code, status);
}

function buyerHttpError(correlationId: string, code: string, status: number) {
  const messages: Record<string, string> = {
    FORBIDDEN: "دسترسی فروشندگی فعال نیست.",
    ORDER_NOT_FOUND: "سفارش مرتبطی پیدا نشد.",
    DELIVERY_DETAILS_NOT_AVAILABLE: "اطلاعات تحویل برای این سفارش در دسترس نیست.",
    REVEAL_REASON_REQUIRED: "برای مشاهده دوباره، دلیل این پیگیری را بنویسید.",
    INVALID_CURSOR: "صفحه درخواستی معتبر نیست؛ فهرست را از ابتدا باز کنید.",
    VALIDATION_ERROR: "اطلاعات درخواست را بررسی کنید.",
  };
  return new HttpException(
    { code, message: messages[code] ?? messages.VALIDATION_ERROR, correlationId },
    status,
  );
}
