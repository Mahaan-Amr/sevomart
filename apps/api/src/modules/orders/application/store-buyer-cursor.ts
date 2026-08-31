import { createHmac, timingSafeEqual } from "node:crypto";

import type { IdentityId, OrderId, StoreId } from "@sevo/contracts/platform/v1";

export type StoreBuyerCursorValue = Readonly<{
  createdAt: string;
  buyerId: IdentityId;
}>;

type CursorPayload = StoreBuyerCursorValue & {
  version: 1;
  storeId: StoreId;
  search: string | null;
};

export class InvalidStoreBuyerCursorError extends Error {
  readonly code = "INVALID_CURSOR";
}

export class StoreBuyerCursorCodec {
  readonly #key: Buffer;

  constructor(secret: string) {
    this.#key = createHmac("sha256", secret)
      .update("sevo:orders:store-buyers:v1")
      .digest();
  }

  encode(
    scope: { storeId: StoreId; search?: string },
    value: StoreBuyerCursorValue,
  ): string {
    const body = Buffer.from(
      JSON.stringify({
        version: 1,
        storeId: scope.storeId,
        search: scope.search ?? null,
        ...value,
      } satisfies CursorPayload),
    ).toString("base64url");
    return `${body}.${this.#sign(body).toString("base64url")}`;
  }

  decode(
    scope: { storeId: StoreId; search?: string },
    cursor: string,
  ): StoreBuyerCursorValue {
    try {
      const [body, signature, extra] = cursor.split(".");
      if (!body || !signature || extra) throw new InvalidStoreBuyerCursorError();
      const supplied = Buffer.from(signature, "base64url");
      const expected = this.#sign(body);
      if (
        supplied.length !== expected.length ||
        supplied.toString("base64url") !== signature ||
        !timingSafeEqual(supplied, expected)
      ) {
        throw new InvalidStoreBuyerCursorError();
      }
      const payload = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      ) as Partial<CursorPayload>;
      if (
        payload.version !== 1 ||
        payload.storeId !== scope.storeId ||
        payload.search !== (scope.search ?? null) ||
        typeof payload.createdAt !== "string" ||
        Number.isNaN(Date.parse(payload.createdAt)) ||
        typeof payload.buyerId !== "string"
      ) {
        throw new InvalidStoreBuyerCursorError();
      }
      return { createdAt: payload.createdAt, buyerId: payload.buyerId as IdentityId };
    } catch (error) {
      if (error instanceof InvalidStoreBuyerCursorError) throw error;
      throw new InvalidStoreBuyerCursorError();
    }
  }

  #sign(body: string): Buffer {
    return createHmac("sha256", this.#key).update(body).digest();
  }
}

export type StoreBuyerOrderCursorValue = Readonly<{
  createdAt: string;
  orderId: OrderId;
}>;

type OrderCursorPayload = StoreBuyerOrderCursorValue & {
  version: 1;
  storeId: StoreId;
  contextOrderId: OrderId;
};

export class StoreBuyerOrderCursorCodec {
  readonly #key: Buffer;

  constructor(secret: string) {
    this.#key = createHmac("sha256", secret)
      .update("sevo:orders:store-buyer-orders:v1")
      .digest();
  }

  encode(
    scope: { storeId: StoreId; contextOrderId: OrderId },
    value: StoreBuyerOrderCursorValue,
  ): string {
    const body = Buffer.from(
      JSON.stringify({ version: 1, ...scope, ...value } satisfies OrderCursorPayload),
    ).toString("base64url");
    return `${body}.${this.#sign(body).toString("base64url")}`;
  }

  decode(
    scope: { storeId: StoreId; contextOrderId: OrderId },
    cursor: string,
  ): StoreBuyerOrderCursorValue {
    try {
      const [body, signature, extra] = cursor.split(".");
      if (!body || !signature || extra) throw new InvalidStoreBuyerCursorError();
      const supplied = Buffer.from(signature, "base64url");
      const expected = this.#sign(body);
      if (
        supplied.length !== expected.length ||
        supplied.toString("base64url") !== signature ||
        !timingSafeEqual(supplied, expected)
      ) {
        throw new InvalidStoreBuyerCursorError();
      }
      const payload = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      ) as Partial<OrderCursorPayload>;
      if (
        payload.version !== 1 ||
        payload.storeId !== scope.storeId ||
        payload.contextOrderId !== scope.contextOrderId ||
        typeof payload.createdAt !== "string" ||
        Number.isNaN(Date.parse(payload.createdAt)) ||
        typeof payload.orderId !== "string"
      ) {
        throw new InvalidStoreBuyerCursorError();
      }
      return { createdAt: payload.createdAt, orderId: payload.orderId as OrderId };
    } catch (error) {
      if (error instanceof InvalidStoreBuyerCursorError) throw error;
      throw new InvalidStoreBuyerCursorError();
    }
  }

  #sign(body: string): Buffer {
    return createHmac("sha256", this.#key).update(body).digest();
  }
}
