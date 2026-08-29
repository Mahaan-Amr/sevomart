import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  inventoryAvailabilityContract,
  inventoryIdempotencyKeyContract,
  inventoryPageLimitContract,
  replaceSellerInventoryBatchContract,
} from "@sevo/contracts/inventory/v1";
import { variantIdContract } from "@sevo/contracts/platform/v1";
import type { FastifyRequest } from "fastify";

import { requireIdentity } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
} from "../identity-access/public";
import { SellerInventoryService } from "./application/seller-inventory.service";
import {
  InventoryIdempotencyConflictError,
  InventoryNotFoundError,
  InventoryReservedStockConflictError,
  InventoryRevisionConflictError,
  InventorySellerAccessInactiveError,
} from "./public";
import { INVENTORY_SELLER_SERVICE } from "./inventory.tokens";

@ApiExcludeController()
@Controller("v1/seller/inventory")
export class InventoryController {
  constructor(
    @Inject(INVENTORY_SELLER_SERVICE)
    private readonly inventory: SellerInventoryService,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
  ) {}

  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Query("cursor") rawCursor?: string,
    @Query("limit") rawLimit?: string,
    @Query("availability") rawAvailability?: string,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const cursor = rawCursor ? variantIdContract.safeParse(rawCursor) : undefined;
    const limit = inventoryPageLimitContract.safeParse(rawLimit ?? 20);
    const availability = rawAvailability
      ? inventoryAvailabilityContract.safeParse(rawAvailability)
      : undefined;
    if (cursor && !cursor.success) throw validationError(request.id);
    if (!limit.success || (availability && !availability.success)) {
      throw validationError(request.id);
    }
    return this.#handle(request, () =>
      this.inventory.list(identityId, {
        ...(cursor?.success ? { cursor: cursor.data } : {}),
        limit: limit.data,
        ...(availability?.success ? { availability: availability.data } : {}),
      }),
    );
  }

  @Put()
  async replaceBatch(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") rawIdempotencyKey?: string,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const input = replaceSellerInventoryBatchContract.safeParse(body);
    if (!input.success) throw validationError(request.id);
    const idempotencyKey = inventoryIdempotencyKeyContract.safeParse(rawIdempotencyKey);
    if (!idempotencyKey.success) throw preconditionError(request.id);
    return this.#handle(request, () =>
      this.inventory.replaceBatch(identityId, input.data, {
        idempotencyKey: idempotencyKey.data,
        correlationId: request.id,
      }),
    );
  }

  async #handle<T>(request: FastifyRequest, operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof InventoryNotFoundError) {
        throw inventoryError(
          request.id,
          HttpStatus.NOT_FOUND,
          "INVENTORY_NOT_FOUND",
          "گونه برای این فروشگاه پیدا نشد.",
        );
      }
      if (error instanceof InventorySellerAccessInactiveError) {
        throw inventoryError(
          request.id,
          HttpStatus.FORBIDDEN,
          "SELLER_ACCESS_INACTIVE",
          "دسترسی فروشندگی شما فعال نیست.",
        );
      }
      if (error instanceof InventoryRevisionConflictError) {
        throw inventoryError(
          request.id,
          HttpStatus.CONFLICT,
          "REVISION_CONFLICT",
          "موجودی در جای دیگری تغییر کرده است. نسخه تازه را ببینید.",
        );
      }
      if (error instanceof InventoryIdempotencyConflictError) {
        throw inventoryError(
          request.id,
          HttpStatus.CONFLICT,
          "IDEMPOTENCY_CONFLICT",
          "این شناسه درخواست قبلاً برای تغییر دیگری استفاده شده است.",
        );
      }
      if (error instanceof InventoryReservedStockConflictError) {
        throw inventoryError(
          request.id,
          HttpStatus.CONFLICT,
          "RESERVED_STOCK_CONFLICT",
          "موجودی را نمی‌توان کمتر از تعداد رزروشده ثبت کرد.",
        );
      }
      throw error;
    }
  }
}

function inventoryError(
  correlationId: string,
  status: HttpStatus,
  code: string,
  message: string,
) {
  return new HttpException({ code, message, correlationId }, status);
}

function validationError(correlationId: string) {
  return inventoryError(
    correlationId,
    HttpStatus.UNPROCESSABLE_ENTITY,
    "VALIDATION_ERROR",
    "اطلاعات موجودی را بررسی کنید.",
  );
}

function preconditionError(correlationId: string) {
  return inventoryError(
    correlationId,
    HttpStatus.PRECONDITION_REQUIRED,
    "PRECONDITION_REQUIRED",
    "شناسه یکتای درخواست لازم است.",
  );
}
