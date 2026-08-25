import { describe, expect, it } from "vitest";

import {
  rankDiscoveryCandidates,
  type DiscoveryRankingCandidate,
} from "../../apps/api/src/modules/discovery/application/discovery-ranking";
import {
  DiscoveryCursorCodec,
  DiscoveryCursorExpiredError,
  DiscoveryCursorInvalidError,
  DiscoveryCursorStaleError,
} from "../../apps/api/src/modules/discovery/application/discovery-cursor";
import { FollowingFeedCursorCodec } from "../../apps/api/src/modules/discovery/application/following-feed-cursor";
import { rankFollowingFeedCandidates } from "../../apps/api/src/modules/discovery/application/following-feed-ranking";

const snapshotAt = new Date("2026-08-24T12:00:00.000Z");
const stores = {
  a: "00000000-0000-4000-8000-000000000001",
  b: "00000000-0000-4000-8000-000000000002",
};

function candidate(
  productSuffix: number,
  storeId: string,
  firstPublishedAt: string,
): DiscoveryRankingCandidate {
  return {
    productId: `00000000-0000-4000-9000-${String(productSuffix).padStart(12, "0")}`,
    storeId,
    firstPublishedAt: new Date(firstPublishedAt),
  };
}

describe("deterministic discovery ranking", () => {
  it("keeps the exact UTC freshness boundaries stable", () => {
    const result = rankDiscoveryCandidates(
      [
        candidate(31, stores.a, "2026-07-24T23:59:59.000Z"),
        candidate(30, stores.a, "2026-07-25T00:00:00.000Z"),
        candidate(8, stores.a, "2026-08-16T23:59:59.000Z"),
        candidate(7, stores.a, "2026-08-17T00:00:00.000Z"),
      ],
      { snapshotAt, dailySeed: "fixed-test-seed" },
    );

    expect(
      result.map(({ productId, key }) => [productId.slice(-2), key.bucket]),
    ).toEqual([
      ["07", 0],
      ["08", 1],
      ["30", 1],
      ["31", 2],
    ]);
  });

  it("round-robins stores before showing a second product from one store", () => {
    const result = rankDiscoveryCandidates(
      [
        candidate(1, stores.a, "2026-08-24T10:00:00.000Z"),
        candidate(2, stores.a, "2026-08-24T09:00:00.000Z"),
        candidate(3, stores.b, "2026-08-24T08:00:00.000Z"),
      ],
      { snapshotAt, dailySeed: "fixed-test-seed" },
    );

    expect(
      result
        .slice(0, 2)
        .map(({ storeId }) => storeId)
        .sort(),
    ).toEqual([stores.a, stores.b]);
    expect(result[2]).toMatchObject({ storeId: stores.a, key: { storeOrdinal: 1 } });
    expect(
      rankDiscoveryCandidates(result, {
        snapshotAt,
        dailySeed: "fixed-test-seed",
      }).map(({ productId }) => productId),
    ).toEqual(result.map(({ productId }) => productId));
  });
});

describe("discovery cursor", () => {
  const oldKey = "old-key-that-is-at-least-thirty-two-characters";
  const currentKey = "current-key-that-is-at-least-thirty-two-chars";
  const codec = new DiscoveryCursorCodec({
    activeKeyId: "current",
    keys: { old: oldKey, current: currentKey },
  });
  const payload = {
    feedKind: "DISCOVERY" as const,
    cursorVersion: 1 as const,
    rankingVersion: 1,
    snapshotAt: snapshotAt.toISOString(),
    expiresAt: "2026-08-25T12:00:00.000Z",
    pageSize: 18,
    seedDay: "2026-08-24",
    seek: {
      bucket: 0,
      storeOrdinal: 0,
      storeHmac: "a".repeat(64),
      storeId: stores.a,
      firstPublishedAt: "2026-08-24T10:00:00.000Z",
      productId: "00000000-0000-4000-9000-000000000001",
    },
  };

  it("round-trips an authenticated cursor and verifies retained rotated keys", () => {
    const current = codec.encode(payload);
    const old = new DiscoveryCursorCodec({
      activeKeyId: "old",
      keys: { old: oldKey },
    }).encode(payload);

    expect(
      codec.decode(current, { now: snapshotAt, pageSize: 18, rankingVersion: 1 }),
    ).toEqual(payload);
    expect(
      codec.decode(old, { now: snapshotAt, pageSize: 18, rankingVersion: 1 }),
    ).toEqual(payload);
  });

  it("rejects tampering, another page size, expiry, and an old ranking version", () => {
    const cursor = codec.encode(payload);
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;

    expect(() =>
      codec.decode(tampered, { now: snapshotAt, pageSize: 18, rankingVersion: 1 }),
    ).toThrow(DiscoveryCursorInvalidError);
    expect(() =>
      codec.decode(cursor, { now: snapshotAt, pageSize: 12, rankingVersion: 1 }),
    ).toThrow(DiscoveryCursorInvalidError);
    expect(() =>
      codec.decode(cursor, {
        now: new Date("2026-08-25T12:00:00.001Z"),
        pageSize: 18,
        rankingVersion: 1,
      }),
    ).toThrow(DiscoveryCursorExpiredError);
    expect(() =>
      codec.decode(cursor, { now: snapshotAt, pageSize: 18, rankingVersion: 2 }),
    ).toThrow(DiscoveryCursorStaleError);
  });
});

describe("following-feed ranking and cursor", () => {
  const oldKey = "old-key-that-is-at-least-thirty-two-characters";
  const currentKey = "current-key-that-is-at-least-thirty-two-chars";
  const codec = new FollowingFeedCursorCodec({
    activeKeyId: "current",
    keys: { old: oldKey, current: currentKey },
  });
  const identityId = "00000000-0000-4000-8000-000000000010";
  const payload = {
    feedKind: "FOLLOWING" as const,
    cursorVersion: 1 as const,
    rankingVersion: 1,
    snapshotAt: snapshotAt.toISOString(),
    expiresAt: "2026-08-25T12:00:00.000Z",
    pageSize: 18,
    identityId,
    followSetRevision: 4,
    seek: {
      publicationDayUtc: "2026-08-24",
      storeOrdinal: 0,
      storeId: stores.a,
      firstPublishedAt: "2026-08-24T10:00:00.000Z",
      productId: "00000000-0000-4000-9000-000000000001",
    },
  };

  it("orders publication days deterministically and round-robins stores", () => {
    const result = rankFollowingFeedCandidates(
      [
        candidate(1, stores.a, "2026-08-24T10:00:00.000Z"),
        candidate(2, stores.a, "2026-08-24T09:00:00.000Z"),
        candidate(3, stores.b, "2026-08-24T08:00:00.000Z"),
        candidate(4, stores.b, "2026-08-23T12:00:00.000Z"),
      ].map((item) => ({
        ...item,
        eligibleSince: item.firstPublishedAt,
        storePublicationVersion: 1,
        publicationVersion: 1,
        offerVersion: 1,
        availabilityVersion: 1,
      })),
    );

    expect(result.map(({ candidate }) => candidate.productId.slice(-2))).toEqual([
      "01",
      "03",
      "02",
      "04",
    ]);
  });

  it("binds authenticated cursors to identity and rejects tampering and expiry", () => {
    const cursor = codec.encode(payload);
    const rotated = new FollowingFeedCursorCodec({
      activeKeyId: "old",
      keys: { old: oldKey },
    }).encode(payload);
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;
    const context = {
      now: snapshotAt,
      identityId,
      pageSize: 18,
      rankingVersion: 1,
    };

    expect(codec.decode(cursor, context)).toEqual(payload);
    expect(codec.decode(rotated, context)).toEqual(payload);
    expect(() => codec.decode(tampered, context)).toThrow(DiscoveryCursorInvalidError);
    expect(() =>
      codec.decode(cursor, {
        ...context,
        identityId: "00000000-0000-4000-8000-000000000011",
      }),
    ).toThrow(DiscoveryCursorInvalidError);
    expect(() => codec.decode(cursor, { ...context, pageSize: 12 })).toThrow(
      DiscoveryCursorInvalidError,
    );
    const discoveryCursor = new DiscoveryCursorCodec({
      activeKeyId: "current",
      keys: { current: currentKey },
    }).encode({
      feedKind: "DISCOVERY",
      cursorVersion: 1,
      rankingVersion: 1,
      snapshotAt: payload.snapshotAt,
      expiresAt: payload.expiresAt,
      pageSize: 18,
      seedDay: "2026-08-24",
      seek: {
        bucket: 0,
        storeOrdinal: 0,
        storeHmac: "a".repeat(64),
        storeId: stores.a,
        firstPublishedAt: payload.seek.firstPublishedAt,
        productId: payload.seek.productId,
      },
    });
    expect(() => codec.decode(discoveryCursor, context)).toThrow(
      DiscoveryCursorInvalidError,
    );
    expect(() =>
      codec.decode(cursor, {
        ...context,
        now: new Date("2026-08-25T12:00:00.001Z"),
      }),
    ).toThrow(DiscoveryCursorExpiredError);
    expect(() => codec.decode(cursor, { ...context, rankingVersion: 2 })).toThrow(
      DiscoveryCursorStaleError,
    );
  });
});
