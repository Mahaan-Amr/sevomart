import type { OpenApiContributor } from "../public";
import {
  createInventoryV1JsonSchemas,
  inventoryV1Examples,
} from "@sevo/contracts/inventory/v1";
import { addModuleOpenApiContract } from "../module-contract";

export const contribute_inventory_openApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(
    document,
    createInventoryV1JsonSchemas(),
    inventoryV1Examples,
    [
      {
        operationId: "listSellerInventory",
        method: "get",
        path: "/v1/seller/inventory",
        tag: "inventory",
        auth: "identity-session",
        queryParameters: [
          {
            name: "cursor",
            schema: "VariantId",
            example: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
            required: false,
          },
          { name: "limit", schema: "InventoryPageLimit", example: 20, required: false },
          {
            name: "availability",
            schema: "InventoryAvailability",
            example: "AVAILABLE",
            required: false,
          },
        ],
        responses: [
          { status: 200, schema: "SellerInventoryList" },
          { status: 401, schema: "InventoryError" },
          { status: 403, schema: "InventoryError" },
        ],
      },
      {
        operationId: "replaceInventoryBatch",
        method: "put",
        path: "/v1/seller/inventory",
        tag: "inventory",
        auth: "identity-session",
        headerParameters: [
          {
            name: "Idempotency-Key",
            schema: "InventoryIdempotencyKey",
            example: "inventory-adjust-01",
            required: true,
          },
        ],
        request: {
          schema: "ReplaceSellerInventoryBatch",
          example: inventoryV1Examples.ReplaceSellerInventoryBatch,
        },
        responses: [
          { status: 200, schema: "SellerInventoryBatchResult" },
          { status: 401, schema: "InventoryError" },
          { status: 403, schema: "InventoryError" },
          { status: 404, schema: "InventoryError" },
          { status: 409, schema: "InventoryError" },
          { status: 422, schema: "InventoryError" },
          { status: 428, schema: "InventoryError" },
        ],
      },
    ],
    {
      descriptions: {
        200: "نتیجه موجودی فروشنده",
        401: "نشست معتبر نیست",
        403: "فروشندگی فعال نیست",
        404: "گونه قابل مدیریت نیست",
        409: "تعارض revision، idempotency یا رزرو",
        422: "ورودی نامعتبر است",
        428: "شناسه یکتای درخواست لازم است",
      },
    },
  );
