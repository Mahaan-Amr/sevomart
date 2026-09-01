import type {
  DiscoveryFeedItemV1,
  DiscoveryFeedPageV1,
  FollowingFeedPageV1,
} from "@sevo/contracts/discovery/v1";

export type FeedPage = DiscoveryFeedPageV1 | FollowingFeedPageV1;

export type FeedState = {
  items: DiscoveryFeedItemV1[];
  nextCursor?: string;
  snapshotAt?: string;
  projectionUpdatedAt?: string;
  emptyState?: FeedPage["emptyState"];
  visibleFollowedStoreCount?: number;
  followSetRevision?: number;
  scrollY: number;
};

export const emptyFeedState: FeedState = { items: [], scrollY: 0 };

export function replaceFeedPage(_current: FeedState, page: FeedPage): FeedState {
  return pageToState(page, page.items, 0);
}

export function appendFeedPage(current: FeedState, page: FeedPage): FeedState {
  const known = new Set(current.items.map((item) => item.productId));
  const items = [
    ...current.items,
    ...page.items.filter((item) => !known.has(item.productId)),
  ];
  return pageToState(page, items, current.scrollY);
}

function pageToState(
  page: FeedPage,
  items: DiscoveryFeedItemV1[],
  scrollY: number,
): FeedState {
  return {
    items,
    scrollY,
    nextCursor: page.nextCursor,
    snapshotAt: page.snapshotAt,
    projectionUpdatedAt: page.projectionUpdatedAt,
    emptyState: items.length === 0 ? page.emptyState : undefined,
    ...("visibleFollowedStoreCount" in page
      ? {
          visibleFollowedStoreCount: page.visibleFollowedStoreCount,
          followSetRevision: page.followSetRevision,
        }
      : {}),
  };
}
