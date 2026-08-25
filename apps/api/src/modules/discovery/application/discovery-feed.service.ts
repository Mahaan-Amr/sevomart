import { createHmac } from "node:crypto";

import { discoveryFeedPageV1Contract } from "@sevo/contracts/discovery/v1";

import type { StoreAuthoritativeRead } from "../../store/public";
import type { ProductAuthoritativeRead } from "../../product/public";
import { DiscoveryCursorCodec, type DiscoveryCursorPayload } from "./discovery-cursor";
import { enrichDiscoveryFeedCandidate } from "./discovery-feed-item";
import { compareDiscoveryKeys, rankDiscoveryCandidates } from "./discovery-ranking";
import {
  DiscoveryProjectionUnavailableError,
  type DiscoveryFeed,
  type DiscoveryFeedRepository,
} from "../public";

const RANKING_VERSION = 1;
const DEFAULT_PAGE_SIZE = 18;
const CURSOR_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export class DiscoveryFeedService implements DiscoveryFeed {
  readonly #cursor: DiscoveryCursorCodec;

  constructor(
    private readonly repository: DiscoveryFeedRepository,
    private readonly stores: StoreAuthoritativeRead,
    private readonly products: ProductAuthoritativeRead,
    cursorKeys: {
      activeKeyId: string;
      keys: Readonly<Record<string, string>>;
    },
    private readonly rankingSecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#cursor = new DiscoveryCursorCodec(cursorKeys);
  }

  async read(input: { cursor?: string; limit?: number }) {
    const now = this.now();
    const continuation = input.cursor
      ? this.#cursor.decode(input.cursor, {
          now,
          ...(input.limit ? { pageSize: input.limit } : {}),
          rankingVersion: RANKING_VERSION,
        })
      : undefined;
    const pageSize = continuation?.pageSize ?? input.limit ?? DEFAULT_PAGE_SIZE;
    const snapshotAt = continuation ? new Date(continuation.snapshotAt) : now;
    const seedDay = continuation?.seedDay ?? snapshotAt.toISOString().slice(0, 10);
    const projection = await this.repository.readPublicSnapshot(snapshotAt);
    if (!projection.healthy) throw new DiscoveryProjectionUnavailableError();

    const dailySeed = createHmac("sha256", this.rankingSecret)
      .update(`public-discovery:${seedDay}`)
      .digest("hex");
    const ranked = rankDiscoveryCandidates(projection.candidates, {
      snapshotAt,
      dailySeed,
    }).filter(
      ({ key }) => !continuation || compareDiscoveryKeys(key, continuation.seek) > 0,
    );
    const enriched = [];
    for (const candidate of ranked) {
      const item = await enrichDiscoveryFeedCandidate(
        candidate.candidate,
        this.stores,
        this.products,
      );
      if (item) enriched.push({ item, key: candidate.key });
    }
    const selected = enriched.slice(0, pageSize);
    const last = selected.at(-1);
    const nextCursor =
      enriched.length > pageSize && last
        ? this.#cursor.encode(
            this.#nextPayload(continuation, snapshotAt, seedDay, pageSize, last.key),
          )
        : undefined;
    const page = discoveryFeedPageV1Contract.parse({
      version: 1,
      items: selected.map(({ item }) => item),
      ...(nextCursor ? { nextCursor } : {}),
      snapshotAt: snapshotAt.toISOString(),
      projectionUpdatedAt: projection.projectionUpdatedAt.toISOString(),
      ...(selected.length === 0
        ? {
            emptyState: {
              message: "فعلاً کالایی برای دیدن نیست.",
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
    continuation: DiscoveryCursorPayload | undefined,
    snapshotAt: Date,
    seedDay: string,
    pageSize: number,
    seek: DiscoveryCursorPayload["seek"],
  ): DiscoveryCursorPayload {
    return {
      feedKind: "DISCOVERY",
      cursorVersion: 1,
      rankingVersion: RANKING_VERSION,
      snapshotAt: snapshotAt.toISOString(),
      expiresAt:
        continuation?.expiresAt ??
        new Date(snapshotAt.getTime() + CURSOR_LIFETIME_MS).toISOString(),
      pageSize,
      seedDay,
      seek,
    };
  }
}
