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
import { getMeter } from "@sevo/observability";
import {
  inventoryAvailabilityContract,
  inventoryIdempotencyKeyContract,
  inventoryPageLimitContract,
  replaceSellerInventoryBatchContract,
} from "@sevo/contracts/inventory/v1";
import { variantIdContract, type VariantId } from "@sevo/contracts/platform/v1";
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

const inventoryMeter = getMeter("sevo.inventory.authoring");
const inventoryConflictMetric = inventoryMeter.createCounter(
  "sevo.inventory.authoring.conflicts",
  { description: "Inventory authoring conflicts by conflict kind" },
);
const inventoryBatchRejectedMetric = inventoryMeter.createCounter(
  "sevo.inventory.authoring.batch_rejected",
  { description: "Rejected seller inventory batches by rejection kind" },
);

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
    if (cursor && !cursor.success) {
      throw validationError(request.id, cursor.error.issues, "cursor");
    }
    if (!limit.success) {
      throw validationError(request.id, limit.error.issues, "limit");
    }
    if (availability && !availability.success) {
      throw validationError(request.id, availability.error.issues, "availability");
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
    if (!input.success) {
      inventoryBatchRejectedMetric.add(1, { kind: "validation" });
      throw validationError(request.id, input.error.issues, undefined, body);
    }
    const idempotencyKey = inventoryIdempotencyKeyContract.safeParse(rawIdempotencyKey);
    if (!idempotencyKey.success) {
      inventoryBatchRejectedMetric.add(1, { kind: "precondition" });
      throw preconditionError(request.id);
    }
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
        inventoryBatchRejectedMetric.add(1, { kind: "not_found" });
        throw inventoryError(
          request.id,
          HttpStatus.NOT_FOUND,
          "INVENTORY_NOT_FOUND",
          "گونه برای این فروشگاه پیدا نشد.",
        );
      }
      if (error instanceof InventorySellerAccessInactiveError) {
        inventoryBatchRejectedMetric.add(1, { kind: "seller_access" });
        throw inventoryError(
          request.id,
          HttpStatus.FORBIDDEN,
          "SELLER_ACCESS_INACTIVE",
          "دسترسی فروشندگی شما فعال نیست.",
        );
      }
      if (error instanceof InventoryRevisionConflictError) {
        inventoryConflictMetric.add(1, { kind: "revision" });
        inventoryBatchRejectedMetric.add(1, { kind: "revision_conflict" });
        throw inventoryError(
          request.id,
          HttpStatus.CONFLICT,
          "REVISION_CONFLICT",
          "موجودی در جای دیگری تغییر کرده است. نسخه تازه را ببینید.",
        );
      }
      if (error instanceof InventoryIdempotencyConflictError) {
        inventoryConflictMetric.add(1, { kind: "idempotency" });
        inventoryBatchRejectedMetric.add(1, { kind: "idempotency_conflict" });
        throw inventoryError(
          request.id,
          HttpStatus.CONFLICT,
          "IDEMPOTENCY_CONFLICT",
          "این شناسه درخواست قبلاً برای تغییر دیگری استفاده شده است.",
        );
      }
      if (error instanceof InventoryReservedStockConflictError) {
        inventoryBatchRejectedMetric.add(1, { kind: "reserved_stock" });
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
  return new HttpException(
    { version: 1, code, message, correlationId, details: { issues: [] } },
    status,
  );
}

function validationError(
  correlationId: string,
  issues: readonly { path: PropertyKey[]; code: string }[],
  pathPrefix?: string,
  body?: unknown,
) {
  const rows = isRecord(body) && Array.isArray(body.rows) ? body.rows : [];
  type InventoryValidationIssue = {
    path: string;
    code: "INVALID_FORMAT" | "DUPLICATE";
    variantId?: VariantId;
  };
  return new HttpException(
    {
      version: 1,
      code: "VALIDATION_ERROR",
      message: "اطلاعات موجودی را بررسی کنید.",
      correlationId,
      details: {
        issues: issues.flatMap<InventoryValidationIssue>((issue) => {
          if (issue.code === "custom" && issue.path.at(-1) === "rows") {
            const variantIds = rows.map((row) =>
              isRecord(row) ? variantIdContract.safeParse(row.variantId) : undefined,
            );
            const frequencies = new Map<string, number>();
            for (const parsed of variantIds) {
              if (parsed?.success) {
                frequencies.set(parsed.data, (frequencies.get(parsed.data) ?? 0) + 1);
              }
            }
            return variantIds.flatMap((parsed, index) =>
              parsed?.success && (frequencies.get(parsed.data) ?? 0) > 1
                ? [
                    {
                      path: `rows.${index}.variantId`,
                      code: "DUPLICATE" as const,
                      variantId: parsed.data,
                    },
                  ]
                : [],
            );
          }
          const path = pathPrefix
            ? [pathPrefix, ...issue.path.map(String)].join(".")
            : issue.path.map(String).join(".") || "inventory";
          const rowIndex = issue.path[0] === "rows" ? issue.path[1] : undefined;
          const row = typeof rowIndex === "number" ? rows[rowIndex] : undefined;
          const parsedVariantId = isRecord(row)
            ? variantIdContract.safeParse(row.variantId)
            : undefined;
          return {
            path,
            code: "INVALID_FORMAT" as const,
            ...(parsedVariantId?.success ? { variantId: parsedVariantId.data } : {}),
          };
        }),
      },
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
