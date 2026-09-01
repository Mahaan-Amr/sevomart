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

export class InvalidRelatedBuyerCursorError extends Error {
  readonly code = "INVALID_CURSOR";
}

class SignedCursorEnvelope {
  readonly #key: Buffer;

  constructor(secret: string, namespace: string) {
    this.#key = createHmac("sha256", secret).update(namespace).digest();
  }

  encode(payload: object): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.#sign(body).toString("base64url")}`;
  }

  decode(cursor: string): Record<string, unknown> {
    try {
      const [body, signature, extra] = cursor.split(".");
      if (!body || !signature || extra) throw new InvalidRelatedBuyerCursorError();
      const supplied = Buffer.from(signature, "base64url");
      const expected = this.#sign(body);
      if (
        supplied.length !== expected.length ||
        supplied.toString("base64url") !== signature ||
        !timingSafeEqual(supplied, expected)
      ) {
        throw new InvalidRelatedBuyerCursorError();
      }
      const payload: unknown = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      );
      if (typeof payload !== "object" || payload === null) {
        throw new InvalidRelatedBuyerCursorError();
      }
      return payload as Record<string, unknown>;
    } catch (error) {
      if (error instanceof InvalidRelatedBuyerCursorError) throw error;
      throw new InvalidRelatedBuyerCursorError();
    }
  }

  #sign(body: string): Buffer {
    return createHmac("sha256", this.#key).update(body).digest();
  }
}

export class StoreBuyerCursorCodec {
  readonly #envelope: SignedCursorEnvelope;

  constructor(secret: string) {
    this.#envelope = new SignedCursorEnvelope(secret, "sevo:orders:store-buyers:v1");
  }

  encode(
    scope: { storeId: StoreId; search?: string },
    value: StoreBuyerCursorValue,
  ): string {
    return this.#envelope.encode({
      version: 1,
      storeId: scope.storeId,
      search: scope.search ?? null,
      ...value,
    } satisfies CursorPayload);
  }

  decode(
    scope: { storeId: StoreId; search?: string },
    cursor: string,
  ): StoreBuyerCursorValue {
    const payload = this.#envelope.decode(cursor) as Partial<CursorPayload>;
    if (
      payload.version !== 1 ||
      payload.storeId !== scope.storeId ||
      payload.search !== (scope.search ?? null) ||
      typeof payload.createdAt !== "string" ||
      Number.isNaN(Date.parse(payload.createdAt)) ||
      typeof payload.buyerId !== "string"
    ) {
      throw new InvalidRelatedBuyerCursorError();
    }
    return { createdAt: payload.createdAt, buyerId: payload.buyerId as IdentityId };
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
  readonly #envelope: SignedCursorEnvelope;

  constructor(secret: string) {
    this.#envelope = new SignedCursorEnvelope(
      secret,
      "sevo:orders:store-buyer-orders:v1",
    );
  }

  encode(
    scope: { storeId: StoreId; contextOrderId: OrderId },
    value: StoreBuyerOrderCursorValue,
  ): string {
    return this.#envelope.encode({
      version: 1,
      ...scope,
      ...value,
    } satisfies OrderCursorPayload);
  }

  decode(
    scope: { storeId: StoreId; contextOrderId: OrderId },
    cursor: string,
  ): StoreBuyerOrderCursorValue {
    const payload = this.#envelope.decode(cursor) as Partial<OrderCursorPayload>;
    if (
      payload.version !== 1 ||
      payload.storeId !== scope.storeId ||
      payload.contextOrderId !== scope.contextOrderId ||
      typeof payload.createdAt !== "string" ||
      Number.isNaN(Date.parse(payload.createdAt)) ||
      typeof payload.orderId !== "string"
    ) {
      throw new InvalidRelatedBuyerCursorError();
    }
    return { createdAt: payload.createdAt, orderId: payload.orderId as OrderId };
  }
}
