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
  Put,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  SELLER_SESSION_READER,
  type SellerSessionReader,
} from "../identity-access/public";
import { storeDraftInputContract, storeSlugContract } from "@sevo/contracts/store/v1";
import type { FastifyRequest } from "fastify";

import {
  IncompleteStoreError,
  StoreNotFoundError,
  StoreService,
  StoreSlugConflictError,
} from "./application/store.service";
import { STORE_SERVICE } from "./store.tokens";

@ApiExcludeController()
@Controller("v1")
export class StoreController {
  constructor(
    @Inject(STORE_SERVICE) private readonly service: StoreService,
    @Inject(SELLER_SESSION_READER)
    private readonly sessions: SellerSessionReader,
  ) {}

  @Get("seller/store/draft")
  async readDraft(@Req() request: FastifyRequest) {
    const sellerId = await this.requireSeller(request);
    return this.handle(request, () => this.service.readDraft(sellerId));
  }

  @Put("seller/store/draft")
  async saveDraft(@Body() body: unknown, @Req() request: FastifyRequest) {
    const sellerId = await this.requireSeller(request);
    const parsed = storeDraftInputContract.safeParse(body);
    if (!parsed.success) {
      throw validationError(
        request.id,
        "اطلاعات فروشگاه را بررسی کنید.",
        parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "store",
          code: issue.code === "too_small" ? "TOO_SHORT" : "INVALID_FORMAT",
        })),
      );
    }
    return this.handle(request, () => this.service.saveDraft(sellerId, parsed.data));
  }

  @Get("store-slugs/:slug/availability")
  async checkSlug(@Param("slug") value: string, @Req() request: FastifyRequest) {
    const sellerId = await this.requireSeller(request);
    const parsed = storeSlugContract.safeParse(value);
    if (!parsed.success) {
      throw validationError(request.id, "شناسه لینک معتبر نیست.", [
        { field: "slug", code: "INVALID_FORMAT" },
      ]);
    }
    return this.service.checkSlug(parsed.data, sellerId);
  }

  @Get("seller/store/preview")
  async preview(@Req() request: FastifyRequest) {
    const sellerId = await this.requireSeller(request);
    return this.handle(request, () => this.service.preview(sellerId));
  }

  @Post("seller/store/publication")
  @HttpCode(HttpStatus.OK)
  async publish(@Req() request: FastifyRequest) {
    const sellerId = await this.requireSeller(request);
    return this.handle(request, () => this.service.publish(sellerId));
  }

  @Get("stores/:slug")
  async readPublished(@Param("slug") value: string, @Req() request: FastifyRequest) {
    const parsed = storeSlugContract.safeParse(value);
    if (!parsed.success) return this.notFound(request.id);
    return this.handle(request, () => this.service.readPublished(parsed.data));
  }

  private async requireSeller(request: FastifyRequest) {
    const token = readCookie(request.headers.cookie, "sevo_seller_session") ?? "";
    const session = await this.sessions.readActiveSellerSession(token);
    if (!session) {
      throw new HttpException(
        {
          code: "UNAUTHORIZED",
          message: "برای ادامه دوباره وارد شوید.",
          correlationId: request.id,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return session.seller.id;
  }

  private async handle<T>(request: FastifyRequest, operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof StoreNotFoundError) return this.notFound(request.id);
      if (error instanceof StoreSlugConflictError) {
        throw new HttpException(
          {
            code: "SLUG_CONFLICT",
            message: "این شناسه لینک قبلاً استفاده شده است.",
            correlationId: request.id,
            details: { slug: error.slug },
          },
          HttpStatus.CONFLICT,
        );
      }
      if (error instanceof IncompleteStoreError) {
        throw validationError(
          request.id,
          "برای انتشار، اطلاعات ضروری فروشگاه را کامل کنید.",
          error.missingFields.map((field) => ({
            field: field.toLowerCase(),
            code: "REQUIRED",
          })),
        );
      }
      throw error;
    }
  }

  private notFound(correlationId: string): never {
    throw new HttpException(
      {
        code: "STORE_NOT_FOUND",
        message: "فروشگاه پیدا نشد.",
        correlationId,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
}

function validationError(
  correlationId: string,
  message: string,
  issues: Array<{
    field: string;
    code: "REQUIRED" | "INVALID_FORMAT" | "TOO_SHORT" | "TOO_LONG";
  }>,
) {
  return new HttpException(
    {
      code: "VALIDATION_ERROR",
      message,
      correlationId,
      details: { issues },
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}
