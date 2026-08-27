import { inventoryAvailabilityReadV1Contract } from "@sevo/contracts/inventory/v1";
import { describe, expect, it } from "vitest";

describe("inventory authoritative availability read v1", () => {
  it("preserves reserved stock and requires available to equal on-hand minus reserved", () => {
    for (const snapshot of [
      { onHand: 4, reserved: 1, available: 3, revision: 2 },
      { onHand: 1, reserved: 1, available: 0, revision: 2 },
      { onHand: 0, reserved: 1, available: -1, revision: 3 },
    ]) {
      expect(inventoryAvailabilityReadV1Contract.parse(snapshot)).toEqual(snapshot);
    }
    for (const snapshot of [
      { onHand: 4, reserved: 1, available: 4, revision: 2 },
      { onHand: -1, reserved: 0, available: -1, revision: 2 },
      { onHand: 1, reserved: -1, available: 2, revision: 2 },
      { onHand: 1, reserved: 0, available: 1, revision: -1 },
      { onHand: 1.5, reserved: 0, available: 1.5, revision: 2 },
    ]) {
      expect(inventoryAvailabilityReadV1Contract.safeParse(snapshot).success).toBe(
        false,
      );
    }
  });
});
