import type {
  DiscoveryFeedItemV1,
  DiscoveryFeedPageV1,
  FollowingFeedPageV1,
} from "@sevo/contracts/discovery/v1";
import type { PublicSalesContentItemV2 } from "@sevo/contracts/content/v2";

export type FeedPage = DiscoveryFeedPageV1 | FollowingFeedPageV1;

export type FeedState = {
  items: DiscoveryFeedItemV1[];
  salesContent: PublicSalesContentItemV2[];
  nextCursor?: string;
  snapshotAt?: string;
  projectionUpdatedAt?: string;
  emptyState?: FeedPage["emptyState"];
  visibleFollowedStoreCount?: number;
  followSetRevision?: number;
  scrollY: number;
};

export const emptyFeedState: FeedState = { items: [], salesContent: [], scrollY: 0 };

export function replaceFeedPage(
  _current: FeedState,
  page: FeedPage,
  salesContent: PublicSalesContentItemV2[] = [],
): FeedState {
  return pageToState(page, page.items, salesContent, 0);
}

export function appendFeedPage(
  current: FeedState,
  page: FeedPage,
  salesContent: PublicSalesContentItemV2[] = [],
): FeedState {
  const known = new Set(current.items.map((item) => item.productId));
  const items = [
    ...current.items,
    ...page.items.filter((item) => !known.has(item.productId)),
  ];
  const currentSalesContent = current.salesContent ?? [];
  const knownContent = new Set(currentSalesContent.map((content) => content.contentId));
  return pageToState(
    page,
    items,
    [
      ...currentSalesContent,
      ...salesContent.filter((content) => !knownContent.has(content.contentId)),
    ],
    current.scrollY,
  );
}

function pageToState(
  page: FeedPage,
  items: DiscoveryFeedItemV1[],
  salesContent: PublicSalesContentItemV2[],
  scrollY: number,
): FeedState {
  return {
    items,
    salesContent,
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
