import { createHmac, timingSafeEqual } from "node:crypto";

import {
  DiscoveryCursorExpiredError,
  DiscoveryCursorInvalidError,
  DiscoveryCursorStaleError,
} from "./discovery-cursor";
import type { FollowingFeedRankingKey } from "./following-feed-ranking";

export type FollowingFeedCursorPayload = Readonly<{
  feedKind: "FOLLOWING";
  cursorVersion: 1;
  rankingVersion: number;
  snapshotAt: string;
  expiresAt: string;
  pageSize: number;
  identityId: string;
  followSetRevision: number;
  seek: FollowingFeedRankingKey;
}>;

export class FollowingFeedCursorCodec {
  constructor(
    private readonly options: {
      activeKeyId: string;
      keys: Readonly<Record<string, string>>;
    },
  ) {
    if (!options.keys[options.activeKeyId]) {
      throw new Error("Active following-feed cursor key is missing from the keyring");
    }
    if (Object.values(options.keys).some((key) => key.length < 32)) {
      throw new Error("Following-feed cursor keys must contain at least 32 characters");
    }
  }

  encode(payloadInput: FollowingFeedCursorPayload) {
    const payload = parsePayload(payloadInput);
    const body = Buffer.from(
      JSON.stringify({ kid: this.options.activeKeyId, payload }),
      "utf8",
    ).toString("base64url");
    return `${body}.${this.#sign(body, this.options.keys[this.options.activeKeyId]!)}`;
  }

  decode(
    cursor: string,
    context: {
      now: Date;
      identityId: string;
      pageSize?: number;
      rankingVersion: number;
    },
  ) {
    try {
      const [body, suppliedSignature, extra] = cursor.split(".");
      if (!body || !suppliedSignature || extra) throw new DiscoveryCursorInvalidError();
      const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (!isObject(decoded) || Object.keys(decoded).length !== 2) {
        throw new DiscoveryCursorInvalidError();
      }
      const kid = decoded.kid;
      if (typeof kid !== "string") throw new DiscoveryCursorInvalidError();
      const key = this.options.keys[kid];
      if (!key || !safeEqual(suppliedSignature, this.#sign(body, key))) {
        throw new DiscoveryCursorInvalidError();
      }
      const payload = parsePayload(decoded.payload);
      if (
        payload.identityId !== context.identityId ||
        (context.pageSize !== undefined && payload.pageSize !== context.pageSize)
      ) {
        throw new DiscoveryCursorInvalidError();
      }
      if (new Date(payload.expiresAt).getTime() < context.now.getTime()) {
        throw new DiscoveryCursorExpiredError();
      }
      if (payload.rankingVersion !== context.rankingVersion) {
        throw new DiscoveryCursorStaleError();
      }
      return payload;
    } catch (error) {
      if (
        error instanceof DiscoveryCursorInvalidError ||
        error instanceof DiscoveryCursorExpiredError ||
        error instanceof DiscoveryCursorStaleError
      ) {
        throw error;
      }
      throw new DiscoveryCursorInvalidError();
    }
  }

  #sign(body: string, key: string) {
    return createHmac("sha256", key).update(body).digest("base64url");
  }
}

function parsePayload(value: unknown): FollowingFeedCursorPayload {
  if (!isObject(value) || Object.keys(value).length !== 9) {
    throw new DiscoveryCursorInvalidError();
  }
  const seek = value.seek;
  if (
    value.feedKind !== "FOLLOWING" ||
    value.cursorVersion !== 1 ||
    !positiveInteger(value.rankingVersion) ||
    !timestamp(value.snapshotAt) ||
    !timestamp(value.expiresAt) ||
    !positiveInteger(value.pageSize) ||
    (value.pageSize as number) > 30 ||
    !uuid(value.identityId) ||
    !nonnegativeInteger(value.followSetRevision) ||
    !isObject(seek) ||
    Object.keys(seek).length !== 5 ||
    typeof seek.publicationDayUtc !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(seek.publicationDayUtc) ||
    !nonnegativeInteger(seek.storeOrdinal) ||
    !uuid(seek.storeId) ||
    !timestamp(seek.firstPublishedAt) ||
    !uuid(seek.productId)
  ) {
    throw new DiscoveryCursorInvalidError();
  }
  return value as unknown as FollowingFeedCursorPayload;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function positiveInteger(value: unknown) {
  return Number.isInteger(value) && (value as number) > 0;
}
function nonnegativeInteger(value: unknown) {
  return Number.isInteger(value) && (value as number) >= 0;
}
function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function uuid(value: unknown) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
  );
}
