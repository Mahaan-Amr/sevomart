import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { sellerActionableOrderListContract } from "@sevo/contracts/orders/v1";
import { identityIdContract, storeIdContract } from "@sevo/contracts/platform/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { requireIdentity } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  SELLER_ACCESS_READ,
  type IdentitySessionReader,
  type SellerAccessRead,
} from "../identity-access/public";
import { CHECKOUT_REPOSITORY, SELLER_ORDER_STORE_RESOLVER } from "./orders.tokens";
import type { OrderPaymentWorkflow } from "./public";

type SellerStoreResolver = (identityId: string) => Promise<string | undefined>;

@ApiExcludeController()
@Controller("v1/seller/orders")
export class SellerOrderController {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly orders: OrderPaymentWorkflow,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
    @Inject(SELLER_ACCESS_READ) private readonly sellerAccess: SellerAccessRead,
    @Inject(SELLER_ORDER_STORE_RESOLVER)
    private readonly resolveSellerStore: SellerStoreResolver,
  ) {}

  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "no-store");
    const identityId = identityIdContract.parse(
      await requireIdentity(request, this.sessions),
    );
    if (!(await this.sellerAccess.isActiveSeller(identityId))) {
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
      orders: await this.orders.listActionableByStore(storeIdContract.parse(storeId)),
    });
  }
}
