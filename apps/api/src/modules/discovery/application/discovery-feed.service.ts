import { createHmac } from "node:crypto";

import { discoveryFeedPageV1Contract } from "@sevo/contracts/discovery/v1";
import { productIdContract, storeIdContract } from "@sevo/contracts/platform/v1";

import type { StoreAuthoritativeRead } from "../../store/public";
import { DiscoveryCursorCodec, type DiscoveryCursorPayload } from "./discovery-cursor";
import {
  compareDiscoveryKeys,
  rankDiscoveryCandidates,
  type RankedDiscoveryCandidate,
} from "./discovery-ranking";
import {
  DiscoveryProjectionUnavailableError,
  type DiscoveryFeed,
  type DiscoveryFeedProjectionCandidate,
  type DiscoveryFeedRepository,
  type DiscoveryProductRead,
} from "../public";

const RANKING_VERSION = 1;
const DEFAULT_PAGE_SIZE = 18;
const CURSOR_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export class DiscoveryFeedService implements DiscoveryFeed {
  readonly #cursor: DiscoveryCursorCodec;

  constructor(
    private readonly repository: DiscoveryFeedRepository,
    private readonly stores: StoreAuthoritativeRead,
    private readonly products: DiscoveryProductRead,
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
      const item = await this.#enrich(candidate, projection.candidates);
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

  async #enrich(
    ranked: RankedDiscoveryCandidate,
    candidates: readonly DiscoveryFeedProjectionCandidate[],
  ) {
    const projection = candidates.find(
      ({ productId }) => productId === ranked.productId,
    );
    if (!projection) return undefined;
    const productId = productIdContract.parse(ranked.productId);
    const storeId = storeIdContract.parse(ranked.storeId);
    const [store, detailedProduct] = await Promise.all([
      this.stores.readStore(storeId),
      this.products.readPublishedProduct(productId, storeId),
    ]);
    const product =
      detailedProduct ?? (await this.products.readPublished(productId, storeId));
    const storeName = store?.displayIdentity.name;
    if (
      !store ||
      store.publicationStatus !== "PUBLISHED" ||
      !store.settlement ||
      !store.slug ||
      !storeName ||
      !product
    ) {
      return undefined;
    }
    const isDetailed = "priceRange" in product;
    const image = isDetailed ? product.images[0] : product.image;
    if (!image) return undefined;
    return {
      productId,
      storeId,
      storeSlug: store.slug,
      store: {
        name: storeName,
        logo: store.displayIdentity.logoMediaId
          ? {
              id: store.displayIdentity.logoMediaId,
              url: `/v1/media/${store.displayIdentity.logoMediaId}`,
            }
          : null,
      },
      product: { name: product.name, image: { id: image.id, url: image.url } },
      priceRange: isDetailed
        ? product.priceRange
        : { minimum: product.price, maximum: product.price },
      availability: product.availability,
      projectionVersions: {
        store: projection.storePublicationVersion,
        publication: projection.publicationVersion,
        offer: projection.offerVersion,
        availability: projection.availabilityVersion,
      },
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
