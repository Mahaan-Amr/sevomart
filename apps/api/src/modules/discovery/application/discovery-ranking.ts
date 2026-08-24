import { createHmac } from "node:crypto";

export type DiscoveryRankingCandidate = Readonly<{
  productId: string;
  storeId: string;
  firstPublishedAt: Date;
}>;

export type DiscoveryRankingKey = Readonly<{
  bucket: 0 | 1 | 2;
  storeOrdinal: number;
  storeHmac: string;
  storeId: string;
  firstPublishedAt: string;
  productId: string;
}>;

export type RankedDiscoveryCandidate<
  TCandidate extends DiscoveryRankingCandidate = DiscoveryRankingCandidate,
> = TCandidate & Readonly<{ candidate: TCandidate; key: DiscoveryRankingKey }>;

export function rankDiscoveryCandidates<TCandidate extends DiscoveryRankingCandidate>(
  candidates: readonly TCandidate[],
  options: Readonly<{ snapshotAt: Date; dailySeed: string }>,
): RankedDiscoveryCandidate<TCandidate>[] {
  const grouped = new Map<string, TCandidate[]>();
  for (const candidate of candidates) {
    const bucket = freshnessBucket(candidate.firstPublishedAt, options.snapshotAt);
    const groupKey = `${bucket}:${candidate.storeId}`;
    const group = grouped.get(groupKey) ?? [];
    group.push(candidate);
    grouped.set(groupKey, group);
  }

  const ranked: RankedDiscoveryCandidate<TCandidate>[] = [];
  for (const group of grouped.values()) {
    group.sort((left, right) => {
      const time = right.firstPublishedAt.getTime() - left.firstPublishedAt.getTime();
      return time || left.productId.localeCompare(right.productId);
    });
    for (const [storeOrdinal, candidate] of group.entries()) {
      ranked.push({
        ...candidate,
        candidate,
        key: {
          bucket: freshnessBucket(candidate.firstPublishedAt, options.snapshotAt),
          storeOrdinal,
          storeHmac: createHmac("sha256", options.dailySeed)
            .update(candidate.storeId)
            .digest("hex"),
          storeId: candidate.storeId,
          firstPublishedAt: candidate.firstPublishedAt.toISOString(),
          productId: candidate.productId,
        },
      });
    }
  }
  return ranked.sort((left, right) => compareDiscoveryKeys(left.key, right.key));
}

export function compareDiscoveryKeys(
  left: DiscoveryRankingKey,
  right: DiscoveryRankingKey,
): number {
  return (
    left.bucket - right.bucket ||
    left.storeOrdinal - right.storeOrdinal ||
    left.storeHmac.localeCompare(right.storeHmac) ||
    left.storeId.localeCompare(right.storeId) ||
    right.firstPublishedAt.localeCompare(left.firstPublishedAt) ||
    left.productId.localeCompare(right.productId)
  );
}

function freshnessBucket(firstPublishedAt: Date, snapshotAt: Date): 0 | 1 | 2 {
  const publishedDay = Date.UTC(
    firstPublishedAt.getUTCFullYear(),
    firstPublishedAt.getUTCMonth(),
    firstPublishedAt.getUTCDate(),
  );
  const snapshotDay = Date.UTC(
    snapshotAt.getUTCFullYear(),
    snapshotAt.getUTCMonth(),
    snapshotAt.getUTCDate(),
  );
  const ageDays = Math.max(0, Math.floor((snapshotDay - publishedDay) / 86_400_000));
  if (ageDays <= 7) return 0;
  if (ageDays <= 30) return 1;
  return 2;
}
