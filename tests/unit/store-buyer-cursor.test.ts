import { identityIdContract, storeIdContract } from "@sevo/contracts/platform/v1";
import { describe, expect, it } from "vitest";

import {
  InvalidStoreBuyerCursorError,
  StoreBuyerCursorCodec,
} from "../../apps/api/src/modules/orders/application/store-buyer-cursor";

const storeId = storeIdContract.parse("20000000-0000-4000-8000-000000000136");
const buyerId = identityIdContract.parse("10000000-0000-4000-8000-000000000136");

describe("store buyer cursor", () => {
  it("round-trips only in the same store and search scope", () => {
    const codec = new StoreBuyerCursorCodec("test-secret-with-enough-entropy");
    const cursor = codec.encode(
      { storeId, search: "سارا" },
      { buyerId, createdAt: "2026-08-31T08:00:00.000Z" },
    );
    expect(codec.decode({ storeId, search: "سارا" }, cursor)).toEqual({
      buyerId,
      createdAt: "2026-08-31T08:00:00.000Z",
    });
    expect(() => codec.decode({ storeId }, cursor)).toThrow(
      InvalidStoreBuyerCursorError,
    );
    expect(() => codec.decode({ storeId, search: "سارا" }, `${cursor}x`)).toThrow(
      InvalidStoreBuyerCursorError,
    );
  });
});
