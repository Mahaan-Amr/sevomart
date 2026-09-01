import {
  discoveryFeedItemV1Contract,
  discoveryFeedPageV1Contract,
  discoveryV1Examples,
} from "@sevo/contracts/discovery/v1";
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
});
