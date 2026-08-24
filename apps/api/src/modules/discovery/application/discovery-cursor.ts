import { createHmac, timingSafeEqual } from "node:crypto";

export type DiscoveryCursorPayload = Readonly<{
  feedKind: "DISCOVERY";
  cursorVersion: 1;
  rankingVersion: number;
  snapshotAt: string;
  expiresAt: string;
  pageSize: number;
  seedDay: string;
  seek: Readonly<{
    bucket: 0 | 1 | 2;
    storeOrdinal: number;
    storeHmac: string;
    storeId: string;
    firstPublishedAt: string;
    productId: string;
  }>;
}>;

export class DiscoveryCursorInvalidError extends Error {}
export class DiscoveryCursorExpiredError extends Error {}
export class DiscoveryCursorStaleError extends Error {}

export class DiscoveryCursorCodec {
  readonly #activeKeyId: string;
  readonly #keys: Readonly<Record<string, string>>;

  constructor(options: {
    activeKeyId: string;
    keys: Readonly<Record<string, string>>;
  }) {
    if (!options.keys[options.activeKeyId]) {
      throw new Error("Active discovery cursor key is missing from the keyring");
    }
    if (Object.values(options.keys).some((key) => key.length < 32)) {
      throw new Error("Discovery cursor keys must contain at least 32 characters");
    }
    this.#activeKeyId = options.activeKeyId;
    this.#keys = options.keys;
  }

  encode(payloadInput: DiscoveryCursorPayload): string {
    const payload = parsePayload(payloadInput);
    const body = Buffer.from(
      JSON.stringify({ kid: this.#activeKeyId, payload }),
      "utf8",
    ).toString("base64url");
    return `${body}.${this.#sign(body, this.#keys[this.#activeKeyId]!)}`;
  }

  decode(
    cursor: string,
    context: { now: Date; pageSize?: number; rankingVersion: number },
  ): DiscoveryCursorPayload {
    try {
      const [body, suppliedSignature, extra] = cursor.split(".");
      if (!body || !suppliedSignature || extra) throw new DiscoveryCursorInvalidError();
      const envelope = parseEnvelope(
        JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
      );
      const key = this.#keys[envelope.kid];
      if (!key || !safeEqual(suppliedSignature, this.#sign(body, key))) {
        throw new DiscoveryCursorInvalidError();
      }
      if (
        context.pageSize !== undefined &&
        envelope.payload.pageSize !== context.pageSize
      ) {
        throw new DiscoveryCursorInvalidError();
      }
      if (new Date(envelope.payload.expiresAt).getTime() < context.now.getTime()) {
        throw new DiscoveryCursorExpiredError();
      }
      if (envelope.payload.rankingVersion !== context.rankingVersion) {
        throw new DiscoveryCursorStaleError();
      }
      return envelope.payload;
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

  #sign(body: string, key: string): string {
    return createHmac("sha256", key).update(body).digest("base64url");
  }
}

function parseEnvelope(value: unknown): {
  kid: string;
  payload: DiscoveryCursorPayload;
} {
  if (!isPlainObject(value) || Object.keys(value).length !== 2) {
    throw new DiscoveryCursorInvalidError();
  }
  if (typeof value.kid !== "string" || value.kid.length < 1 || value.kid.length > 64) {
    throw new DiscoveryCursorInvalidError();
  }
  return { kid: value.kid, payload: parsePayload(value.payload) };
}

function parsePayload(value: unknown): DiscoveryCursorPayload {
  if (!isPlainObject(value) || Object.keys(value).length !== 8) {
    throw new DiscoveryCursorInvalidError();
  }
  const seek = value.seek;
  if (
    value.feedKind !== "DISCOVERY" ||
    value.cursorVersion !== 1 ||
    !isPositiveInteger(value.rankingVersion) ||
    !isIsoTimestamp(value.snapshotAt) ||
    !isIsoTimestamp(value.expiresAt) ||
    !Number.isInteger(value.pageSize) ||
    (value.pageSize as number) < 1 ||
    (value.pageSize as number) > 30 ||
    typeof value.seedDay !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.seedDay) ||
    !isPlainObject(seek) ||
    Object.keys(seek).length !== 6 ||
    ![0, 1, 2].includes(seek.bucket as number) ||
    !Number.isInteger(seek.storeOrdinal) ||
    (seek.storeOrdinal as number) < 0 ||
    typeof seek.storeHmac !== "string" ||
    !/^[0-9a-f]{64}$/.test(seek.storeHmac) ||
    !isUuid(seek.storeId) ||
    !isIsoTimestamp(seek.firstPublishedAt) ||
    !isUuid(seek.productId)
  ) {
    throw new DiscoveryCursorInvalidError();
  }
  return value as unknown as DiscoveryCursorPayload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
  );
}
