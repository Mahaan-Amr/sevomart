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
  Put,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  createSimpleProductInputContract,
  productIdempotencyKeyContract,
  productRevisionTagContract,
  publishSimpleProductInputContract,
  replaceSimpleProductWorkingCopyContract,
} from "@sevo/contracts/product/v1";
import { productIdContract } from "@sevo/contracts/platform/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { requireIdentity } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
} from "../identity-access/public";
import { InventoryRevisionConflictError } from "../inventory/public";
import { StoreNotSellableError } from "../store/public";
import { ProductService } from "./application/product.service";
import {
  ProductIdempotencyConflictError,
  ProductNotFoundError,
  ProductNotReadyError,
  ProductRevisionConflictError,
  SellerAccessInactiveError,
} from "./public";
import { PRODUCT_SERVICE } from "./product.tokens";

@ApiExcludeController()
@Controller("v1")
export class ProductController {
  constructor(
    @Inject(PRODUCT_SERVICE) private readonly products: ProductService,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
  ) {}

  @Post("seller/products")
  async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const parsed = createSimpleProductInputContract.safeParse(body);
    if (!parsed.success) throw validationError(request.id);
    const write = requireWrite(request.id, idempotencyKey, ifMatch);
    const product = await this.handle(request, () =>
      this.products.create(identityId, { correlationId: request.id, ...write }),
    );
    response.header("etag", `"${product.revision}"`);
    return product;
  }

  @Put("seller/products/:productId/working-copy")
  async replaceWorkingCopy(
    @Param("productId") rawProductId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const productId = parseProductId(rawProductId, request.id);
    const parsed = replaceSimpleProductWorkingCopyContract.safeParse(body);
    if (!parsed.success) throw validationError(request.id);
    const write = requireWrite(request.id, idempotencyKey, ifMatch);
    if (parsed.data.expectedRevision !== write.expectedRevision) {
      throw preconditionError(request.id);
    }
    const product = await this.handle(request, () =>
      this.products.replaceWorkingCopy(identityId, productId, parsed.data, {
        correlationId: request.id,
        ...write,
      }),
    );
    response.header("etag", `"${product.revision}"`);
    return product;
  }

  @Get("seller/products/:productId/preview")
  async preview(
    @Param("productId") rawProductId: string,
    @Req() request: FastifyRequest,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const productId = parseProductId(rawProductId, request.id);
    return this.handle(request, () => this.products.preview(identityId, productId));
  }

  @Post("seller/products/:productId/publications")
  @HttpCode(HttpStatus.OK)
  async publish(
    @Param("productId") rawProductId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const productId = parseProductId(rawProductId, request.id);
    const parsed = publishSimpleProductInputContract.safeParse(body);
    if (!parsed.success) throw validationError(request.id);
    const write = requireWrite(request.id, idempotencyKey, ifMatch);
    if (parsed.data.expectedRevision !== write.expectedRevision) {
      throw preconditionError(request.id);
    }
    return this.handle(request, () =>
      this.products.publish(identityId, productId, {
        correlationId: request.id,
        ...write,
      }),
    );
  }

  @Get("stores/:storeSlug/products")
  async listPublic(
    @Param("storeSlug") storeSlug: string,
    @Req() request: FastifyRequest,
  ) {
    return this.handle(request, () => this.products.listPublic(storeSlug));
  }

  @Get("stores/:storeSlug/products/:productId")
  async readPublic(
    @Param("storeSlug") storeSlug: string,
    @Param("productId") rawProductId: string,
    @Req() request: FastifyRequest,
  ) {
    const productId = parseProductId(rawProductId, request.id);
    return this.handle(request, () => this.products.readPublic(storeSlug, productId));
  }

  private async handle<T>(request: FastifyRequest, operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ProductNotFoundError) return productNotFound(request.id);
      if (error instanceof SellerAccessInactiveError) {
        throw new HttpException(
          {
            code: "SELLER_ACCESS_INACTIVE",
            message: "دسترسی فروشندگی شما فعال نیست.",
            correlationId: request.id,
          },
          HttpStatus.FORBIDDEN,
        );
      }
      if (error instanceof ProductNotReadyError) {
        throw new HttpException(
          {
            code: "PUBLICATION_NOT_READY",
            message: "برای انتشار، اطلاعات و تصویر کالا را کامل کنید.",
            correlationId: request.id,
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (error instanceof StoreNotSellableError) {
        throw new HttpException(
          {
            code: "STORE_NOT_PUBLISHED",
            message: "ابتدا فروشگاه را منتشر کنید.",
            correlationId: request.id,
          },
          HttpStatus.CONFLICT,
        );
      }
      if (
        error instanceof ProductRevisionConflictError ||
        error instanceof InventoryRevisionConflictError
      ) {
        throw new HttpException(
          {
            code: "REVISION_CONFLICT",
            message: "اطلاعات در جای دیگری تغییر کرده است. نسخه تازه را ببینید.",
            correlationId: request.id,
          },
          HttpStatus.CONFLICT,
        );
      }
      if (error instanceof ProductIdempotencyConflictError) {
        throw new HttpException(
          {
            code: "IDEMPOTENCY_CONFLICT",
            message: "این شناسه درخواست قبلاً برای تغییر دیگری استفاده شده است.",
            correlationId: request.id,
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }
}

function parseProductId(value: string, correlationId: string) {
  const parsed = productIdContract.safeParse(value);
  if (!parsed.success) productNotFound(correlationId);
  return parsed.data;
}

function requireWrite(
  correlationId: string,
  idempotencyKey: string | undefined,
  ifMatch: string | undefined,
) {
  const key = productIdempotencyKeyContract.safeParse(idempotencyKey);
  const tag = productRevisionTagContract.safeParse(ifMatch);
  if (!key.success || !tag.success) throw preconditionError(correlationId);
  return {
    idempotencyKey: key.data,
    expectedRevision: Number(tag.data.slice(1, -1)),
  };
}

function preconditionError(correlationId: string) {
  return new HttpException(
    {
      code: "PRECONDITION_REQUIRED",
      message: "نسخه کالا و شناسه یکتای درخواست لازم است.",
      correlationId,
    },
    HttpStatus.PRECONDITION_REQUIRED,
  );
}

function validationError(correlationId: string) {
  return new HttpException(
    {
      code: "VALIDATION_ERROR",
      message: "اطلاعات کالا را بررسی کنید.",
      correlationId,
      details: { issues: [{ field: "product", code: "INVALID_FORMAT" }] },
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function productNotFound(correlationId: string): never {
  throw new HttpException(
    {
      code: "PRODUCT_NOT_FOUND",
      message: "کالا پیدا نشد.",
      correlationId,
    },
    HttpStatus.NOT_FOUND,
  );
}
