import { discoveryFollowingFeedPageV1Contract } from "@sevo/contracts/discovery/v1";
import type { IdentityId } from "@sevo/contracts/platform/v1";

import type { ProductAuthoritativeRead } from "../../product/public";
import type { StoreAuthoritativeRead } from "../../store/public";
import { DiscoveryCursorStaleError } from "./discovery-cursor";
import { enrichDiscoveryFeedCandidate } from "./discovery-feed-item";
import {
  FollowingFeedCursorCodec,
  type FollowingFeedCursorPayload,
} from "./following-feed-cursor";
import {
  DiscoveryProjectionUnavailableError,
  type FollowingFeed,
  type FollowingFeedRepository,
} from "../public";

const RANKING_VERSION = 1;
const DEFAULT_PAGE_SIZE = 18;
const CURSOR_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export class FollowingFeedService implements FollowingFeed {
  readonly #cursor: FollowingFeedCursorCodec;

  constructor(
    private readonly repository: FollowingFeedRepository,
    private readonly stores: StoreAuthoritativeRead,
    private readonly products: ProductAuthoritativeRead,
    cursorKeys: {
      activeKeyId: string;
      keys: Readonly<Record<string, string>>;
    },
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#cursor = new FollowingFeedCursorCodec(cursorKeys);
  }

  async read(input: { identityId: IdentityId; cursor?: string; limit?: number }) {
    const now = this.now();
    const continuation = input.cursor
      ? this.#cursor.decode(input.cursor, {
          now,
          identityId: input.identityId,
          ...(input.limit ? { pageSize: input.limit } : {}),
          rankingVersion: RANKING_VERSION,
        })
      : undefined;
    const pageSize = continuation?.pageSize ?? input.limit ?? DEFAULT_PAGE_SIZE;
    const snapshotAt = continuation ? new Date(continuation.snapshotAt) : now;
    const batchSize = pageSize + 1;
    const enriched = [];
    let seek = continuation?.seek;
    let expectedFollowSetRevision = continuation?.followSetRevision;
    let projection;
    while (enriched.length <= pageSize) {
      projection = await this.repository.readFollowingSnapshot(
        input.identityId,
        snapshotAt,
        { ...(seek ? { seek } : {}), limit: batchSize },
      );
      if (!projection.healthy) throw new DiscoveryProjectionUnavailableError();
      if (
        expectedFollowSetRevision !== undefined &&
        expectedFollowSetRevision !== projection.followSetRevision
      ) {
        throw new DiscoveryCursorStaleError();
      }
      expectedFollowSetRevision = projection.followSetRevision;
      for (const candidate of projection.candidates) {
        const item = await enrichDiscoveryFeedCandidate(
          candidate.candidate,
          this.stores,
          this.products,
        );
        if (item) enriched.push({ item, key: candidate.key });
        if (enriched.length > pageSize) break;
      }
      const lastCandidate = projection.candidates.at(-1);
      if (enriched.length > pageSize || projection.candidates.length < batchSize) break;
      seek = lastCandidate?.key;
    }
    if (!projection) throw new DiscoveryProjectionUnavailableError();
    const selected = enriched.slice(0, pageSize);
    const last = selected.at(-1);
    const nextCursor =
      enriched.length > pageSize && last
        ? this.#cursor.encode(
            this.#nextPayload(
              continuation,
              input.identityId,
              snapshotAt,
              pageSize,
              projection.followSetRevision,
              last.key,
            ),
          )
        : undefined;
    const page = discoveryFollowingFeedPageV1Contract.parse({
      version: 1,
      items: selected.map(({ item }) => item),
      ...(nextCursor ? { nextCursor } : {}),
      snapshotAt: snapshotAt.toISOString(),
      projectionUpdatedAt: projection.projectionUpdatedAt.toISOString(),
      visibleFollowedStoreCount: projection.visibleFollowedStoreCount,
      followSetRevision: projection.followSetRevision,
      ...(selected.length === 0
        ? projection.visibleFollowedStoreCount === 0
          ? {
              emptyState: {
                message: "برای دیدن کالاهای فروشگاه‌ها، چند فروشگاه را دنبال کنید.",
                nextAction: "رفتن به کشف",
              },
            }
          : {
              emptyState: {
                message: "فعلاً کالای تازه‌ای نیست.",
                nextAction: "بعداً دوباره سر بزنید.",
              },
            }
        : {}),
    });
    return {
      page,
      projectionLagMs: Math.max(
        0,
        now.getTime() - projection.projectionUpdatedAt.getTime(),
      ),
    };
  }

  #nextPayload(
    continuation: FollowingFeedCursorPayload | undefined,
    identityId: IdentityId,
    snapshotAt: Date,
    pageSize: number,
    followSetRevision: number,
    seek: FollowingFeedCursorPayload["seek"],
  ): FollowingFeedCursorPayload {
    return {
      feedKind: "FOLLOWING",
      cursorVersion: 1,
      rankingVersion: RANKING_VERSION,
      snapshotAt: snapshotAt.toISOString(),
      expiresAt:
        continuation?.expiresAt ??
        new Date(snapshotAt.getTime() + CURSOR_LIFETIME_MS).toISOString(),
      pageSize,
      identityId,
      followSetRevision,
      seek,
    };
  }
}
