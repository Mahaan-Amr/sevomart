import { buyerDisputeMediaContextIdContract } from "@sevo/contracts/media/v1";
import { orderIdContract } from "@sevo/contracts/platform/v1";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import { describe, expect, it, vi } from "vitest";

import { BuyerDisputeMediaService } from "./buyer-dispute-media";
import { BuyerDisputeMediaAccessDeniedError } from "./public";
import { FakeObjectStorage } from "./testing/fake-object-storage";

const buyerId = identityIdContract.parse("00000000-0000-4000-8000-000000000101");
const orderId = orderIdContract.parse("00000000-0000-4000-8000-000000000201");

describe("buyer dispute media interface", () => {
  it("issues an opaque upload context that expires after thirty minutes", async () => {
    const storage = new FakeObjectStorage();
    const access = vi.fn().mockResolvedValue(true);
    const media = new BuyerDisputeMediaService(
      storage,
      access,
      () => new Date("2099-09-02T08:00:00.000Z"),
    );

    const context = await media.issueUploadContext({ identityId: buyerId, orderId });

    expect(buyerDisputeMediaContextIdContract.parse(context.contextId)).toBe(
      context.contextId,
    );
    expect(context.expiresAt).toBe("2099-09-02T08:30:00.000Z");
    expect(access).toHaveBeenCalledWith({ identityId: buyerId, orderId });
    await expect(media.readUploadContext(context.contextId)).resolves.toMatchObject({
      identityId: buyerId,
      orderId,
    });
  });

  it("does not issue a context without current ownership and hides expired contexts", async () => {
    const storage = new FakeObjectStorage();
    const denied = new BuyerDisputeMediaService(storage, async () => false);
    await expect(
      denied.issueUploadContext({ identityId: buyerId, orderId }),
    ).rejects.toBeInstanceOf(BuyerDisputeMediaAccessDeniedError);

    const expired = await storage.issueBuyerDisputeUploadContext({
      identityId: buyerId,
      orderId,
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    await expect(denied.readUploadContext(expired.contextId)).resolves.toBeUndefined();
  });
});
