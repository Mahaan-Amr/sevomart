import {
  inventoryAvailabilityReadV1Contract,
  inventoryErrorContract,
  replaceSellerInventoryBatchContract,
  sellerInventoryListContract,
} from "@sevo/contracts/inventory/v1";
import { describe, expect, it } from "vitest";

describe("inventory authoritative availability read v1", () => {
  it("preserves reserved stock and requires available to equal on-hand minus reserved", () => {
    for (const snapshot of [
      { onHand: 4, reserved: 1, available: 3, revision: 2 },
      { onHand: 1, reserved: 1, available: 0, revision: 2 },
    ]) {
      expect(inventoryAvailabilityReadV1Contract.parse(snapshot)).toEqual(snapshot);
    }
    for (const snapshot of [
      { onHand: 4, reserved: 1, available: 4, revision: 2 },
      { onHand: -1, reserved: 0, available: -1, revision: 2 },
      { onHand: 1, reserved: -1, available: 2, revision: 2 },
      { onHand: 1, reserved: 0, available: 1, revision: -1 },
      { onHand: 1.5, reserved: 0, available: 1.5, revision: 2 },
      { onHand: 0, reserved: 1, available: -1, revision: 3 },
    ]) {
      expect(inventoryAvailabilityReadV1Contract.safeParse(snapshot).success).toBe(
        false,
      );
    }
  });
});

describe("inventory seller authoring v1", () => {
  it("keeps versioned validation details and row identity in the error envelope", () => {
    expect(
      inventoryErrorContract.parse({
        version: 1,
        code: "VALIDATION_ERROR",
        message: "اطلاعات موجودی را بررسی کنید.",
        correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
        details: {
          issues: [
            {
              path: "rows.0.onHand",
              code: "INVALID_FORMAT",
              variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
            },
          ],
        },
      }),
    ).toMatchObject({ version: 1, details: { issues: [{ path: "rows.0.onHand" }] } });

    expect(
      inventoryErrorContract.parse({
        version: 1,
        code: "UNAUTHORIZED",
        message: "برای ادامه دوباره وارد شوید.",
        correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
        details: { issues: [] },
      }),
    ).toMatchObject({ version: 1, code: "UNAUTHORIZED" });

    expect(
      inventoryErrorContract.parse({
        version: 1,
        code: "REVISION_CONFLICT",
        message: "موجودی بعضی ردیف‌ها تغییر کرده است.",
        correlationId: "7609f906-c921-490c-a793-84398fb67e0c",
        details: {
          issues: [
            {
              path: "rows.0.expectedRevision",
              code: "REVISION_CONFLICT",
              variantId: "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7",
            },
          ],
        },
      }),
    ).toMatchObject({
      version: 1,
      code: "REVISION_CONFLICT",
      details: { issues: [{ code: "REVISION_CONFLICT" }] },
    });
  });

  it("keeps exact counts private in a seller-only list and validates destination batches", () => {
    const variantId = "a3991ca0-50f6-44b9-a4b2-5ae917e5dac7";
    expect(
      sellerInventoryListContract.parse({
        items: [
          {
            productId: "a78fdcc0-caad-4315-a7cd-b22834fe76d4",
            variantId,
            productName: "پیراهن روزمره",
            onHand: 6,
            reserved: 1,
            available: 5,
            availability: "AVAILABLE",
            revision: 2,
          },
        ],
        nextCursor: null,
      }),
    ).toMatchObject({ items: [{ variantId, availability: "AVAILABLE" }] });

    expect(
      replaceSellerInventoryBatchContract.parse({
        reasonCode: "MANUAL_COUNT",
        note: "شمارش پایان روز",
        rows: [{ variantId, onHand: 7, expectedRevision: 2 }],
      }),
    ).toMatchObject({ rows: [{ onHand: 7, expectedRevision: 2 }] });

    expect(
      replaceSellerInventoryBatchContract.safeParse({
        reasonCode: "MANUAL_COUNT",
        rows: [
          { variantId, onHand: 7, expectedRevision: 2 },
          { variantId, onHand: 8, expectedRevision: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      replaceSellerInventoryBatchContract.safeParse({
        reasonCode: "MANUAL_COUNT",
        rows: [{ variantId, onHand: -1, expectedRevision: 2 }],
      }).success,
    ).toBe(false);
  });
});
