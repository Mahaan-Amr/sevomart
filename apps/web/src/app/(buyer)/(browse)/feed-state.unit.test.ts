import {
  discoveryFeedItemV1Contract,
  discoveryFeedPageV1Contract,
  discoveryV1Examples,
} from "@sevo/contracts/discovery/v1";
import { publicSalesContentItemV2Contract } from "@sevo/contracts/content/v2";
import { describe, expect, it } from "vitest";

import { appendFeedPage, emptyFeedState, replaceFeedPage } from "./feed-state";

const firstItem = discoveryFeedItemV1Contract.parse(
  discoveryV1Examples.DiscoveryFeedItemV1,
);
const secondItem = discoveryFeedItemV1Contract.parse({
  ...firstItem,
  productId: "1d113616-5ad8-45d2-a126-b5b3412b3dd7",
});
const emptyPage = discoveryFeedPageV1Contract.parse(
  discoveryV1Examples.DiscoveryFeedPageV1,
);
const salesContent = publicSalesContentItemV2Contract.parse({
  contentId: "71fe87eb-6c0f-47ca-93ca-9f9a038ca270",
  source: "SELLER",
  storeId: firstItem.storeId,
  media: {
    mediaId: "807c619f-a989-4fd9-8b78-a437a07c7bc4",
    kind: "IMAGE",
  },
  products: [{ productId: firstItem.productId, active: true }],
  publishedAt: "2026-09-01T09:00:00.000Z",
});

describe("buyer feed state", () => {
  it("keeps earlier items while following the cursor and removes duplicates", () => {
    const first = replaceFeedPage(
      emptyFeedState,
      discoveryFeedPageV1Contract.parse({
        ...discoveryV1Examples.DiscoveryFeedPageV1,
        emptyState: undefined,
        items: [firstItem],
        nextCursor: "next",
      }),
    );

    const next = appendFeedPage(
      first,
      discoveryFeedPageV1Contract.parse({
        ...discoveryV1Examples.DiscoveryFeedPageV1,
        emptyState: undefined,
        items: [firstItem, secondItem],
      }),
    );

    expect(next.items.map((item) => item.productId)).toEqual([
      firstItem.productId,
      secondItem.productId,
    ]);
    expect(next.nextCursor).toBeUndefined();
  });

  it("replaces the whole snapshot after a stale personal-feed cursor", () => {
    const old = appendFeedPage(
      replaceFeedPage(
        emptyFeedState,
        discoveryFeedPageV1Contract.parse({
          ...discoveryV1Examples.DiscoveryFeedPageV1,
          emptyState: undefined,
          items: [firstItem],
          nextCursor: "old-next",
        }),
      ),
      discoveryFeedPageV1Contract.parse({
        ...discoveryV1Examples.DiscoveryFeedPageV1,
        emptyState: undefined,
        items: [secondItem],
      }),
    );

    const refreshed = replaceFeedPage(old, emptyPage);

    expect(refreshed.items).toEqual([]);
    expect(refreshed.emptyState?.message).toContain("فعلاً");
    expect(refreshed.snapshotAt).toBe(
      discoveryV1Examples.DiscoveryFeedPageV1.snapshotAt,
    );
  });

  it("keeps projected sales content with the restored feed and deduplicates pages", () => {
    const first = replaceFeedPage(emptyFeedState, emptyPage, [salesContent]);
    const next = appendFeedPage(first, emptyPage, [salesContent]);

    expect(next.salesContent).toEqual([salesContent]);
  });
});
