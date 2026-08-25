import type {
  DiscoveryFeedProjectionCandidate,
  FollowingFeedRankingKey,
  RankedFollowingFeedCandidate,
} from "../public";

export type { FollowingFeedRankingKey, RankedFollowingFeedCandidate } from "../public";

export function rankFollowingFeedCandidates(
  candidates: readonly DiscoveryFeedProjectionCandidate[],
): RankedFollowingFeedCandidate[] {
  const groups = new Map<string, DiscoveryFeedProjectionCandidate[]>();
  for (const candidate of candidates) {
    const publicationDayUtc = candidate.firstPublishedAt.toISOString().slice(0, 10);
    const key = `${publicationDayUtc}:${candidate.storeId}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const ranked: RankedFollowingFeedCandidate[] = [];
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        right.firstPublishedAt.getTime() - left.firstPublishedAt.getTime() ||
        left.productId.localeCompare(right.productId),
    );
    for (const [storeOrdinal, candidate] of group.entries()) {
      ranked.push({
        candidate,
        key: {
          publicationDayUtc: candidate.firstPublishedAt.toISOString().slice(0, 10),
          storeOrdinal,
          storeId: candidate.storeId,
          firstPublishedAt: candidate.firstPublishedAt.toISOString(),
          productId: candidate.productId,
        },
      });
    }
  }
  return ranked.sort((left, right) => compareFollowingFeedKeys(left.key, right.key));
}

export function compareFollowingFeedKeys(
  left: FollowingFeedRankingKey,
  right: FollowingFeedRankingKey,
) {
  return (
    right.publicationDayUtc.localeCompare(left.publicationDayUtc) ||
    left.storeOrdinal - right.storeOrdinal ||
    left.storeId.localeCompare(right.storeId) ||
    right.firstPublishedAt.localeCompare(left.firstPublishedAt) ||
    left.productId.localeCompare(right.productId)
  );
}
