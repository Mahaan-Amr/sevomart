import { randomUUID } from "node:crypto";

import {
  buyerDisputeMediaContextIdContract,
  purchaseExperienceMediaContextIdContract,
  type BuyerDisputeMediaContextId,
  type MediaUploadIdempotencyKey,
  type MediaVariant,
  type PurchaseExperienceMediaContextId,
} from "@sevo/contracts/media/v1";
import type { OrderItemId } from "@sevo/contracts/orders/v1";
import type { IdentityId, OrderId } from "@sevo/contracts/platform/v1";
import {
  BuyerDisputeMediaIdempotencyConflictError,
  BuyerDisputeMediaLimitError,
  type ObjectStoragePort,
  PurchaseExperienceMediaIdempotencyConflictError,
  PurchaseExperienceMediaLimitError,
  type StoredMedia,
} from "../public";
import { mediaPurposePolicy } from "../media-purpose-policy";

export class FakeObjectStorage implements ObjectStoragePort {
  readonly #objects = new Map<string, StoredMedia>();
  readonly #purchaseContexts = new Map<
    PurchaseExperienceMediaContextId,
    { identityId: IdentityId; orderItemId: OrderItemId; expiresAt: Date }
  >();
  readonly #purchaseIdempotency = new Map<
    string,
    { requestHash: string; mediaId: string }
  >();
  readonly #buyerDisputeContexts = new Map<
    BuyerDisputeMediaContextId,
    { identityId: IdentityId; orderId: OrderId; expiresAt: Date }
  >();
  readonly #buyerDisputeIdempotency = new Map<
    string,
    { requestHash: string; mediaId: string }
  >();

  async put(object: StoredMedia): Promise<void> {
    if (
      mediaPurposePolicy(object.purpose).requiresOwnerReference &&
      (object.visibility !== "PRIVATE" || !object.ownerReferenceId)
    )
      throw new Error("Private media must be bound to its owning context");
    this.#objects.set(object.key, {
      ...object,
      bytes: object.bytes.slice(),
      variants: object.variants.map((variant) => ({
        ...variant,
        bytes: variant.bytes.slice(),
      })),
    });
  }

  async get(key: string, requestedVariant?: MediaVariant) {
    const object = this.#objects.get(key);
    if (!object) return undefined;
    const canonical = mediaPurposePolicy(object.purpose).canonicalVariant;
    const variant = object.variants.find(
      (candidate) => candidate.name === (requestedVariant ?? canonical),
    );
    if (!variant) return undefined;
    return {
      ...object,
      contentType: variant.contentType,
      bytes: variant.bytes.slice(),
      variant: variant.name,
      variants: undefined,
    };
  }

  async inspect(key: string) {
    const object = this.#objects.get(key);
    if (!object) return undefined;
    return {
      key: object.key,
      purpose: object.purpose,
      contentType: object.contentType,
      checksum: object.checksum,
      width: object.width,
      height: object.height,
      ownerIdentityId: object.ownerIdentityId,
      ownerReferenceId: object.ownerReferenceId,
      visibility: object.visibility,
    };
  }

  async makePublic(key: string, ownerIdentityId: IdentityId): Promise<void> {
    const object = this.#objects.get(key);
    if (
      !object ||
      object.ownerIdentityId !== ownerIdentityId ||
      !mediaPurposePolicy(object.purpose).visibilityCanChange
    ) {
      throw new Error("Media is not owned by the publishing seller");
    }
    this.#objects.set(key, { ...object, visibility: "PUBLIC" });
  }

  async makePrivate(key: string, ownerIdentityId: IdentityId): Promise<void> {
    const object = this.#objects.get(key);
    if (!object || object.ownerIdentityId !== ownerIdentityId) {
      throw new Error("Media is not owned by the editing seller");
    }
    this.#objects.set(key, { ...object, visibility: "PRIVATE" });
  }

  async issuePurchaseExperienceUploadContext(input: {
    identityId: IdentityId;
    orderItemId: OrderItemId;
    expiresAt: Date;
  }) {
    const contextId = purchaseExperienceMediaContextIdContract.parse(randomUUID());
    this.#purchaseContexts.set(contextId, input);
    return { contextId, expiresAt: input.expiresAt };
  }

  async issueBuyerDisputeUploadContext(input: {
    identityId: IdentityId;
    orderId: OrderId;
    expiresAt: Date;
  }) {
    const contextId = buyerDisputeMediaContextIdContract.parse(randomUUID());
    this.#buyerDisputeContexts.set(contextId, input);
    return { contextId, expiresAt: input.expiresAt };
  }

  async readBuyerDisputeUploadContext(
    contextId: BuyerDisputeMediaContextId,
    options: { includeExpired?: boolean } = {},
  ) {
    const context = this.#buyerDisputeContexts.get(contextId);
    return context && (options.includeExpired || context.expiresAt > new Date())
      ? context
      : undefined;
  }

  async readPurchaseExperienceUploadContext(
    contextId: PurchaseExperienceMediaContextId,
    options: { includeExpired?: boolean } = {},
  ) {
    const context = this.#purchaseContexts.get(contextId);
    return context && (options.includeExpired || context.expiresAt > new Date())
      ? context
      : undefined;
  }

  async putPurchaseExperienceMedia(input: {
    object: StoredMedia;
    contextId: PurchaseExperienceMediaContextId;
    idempotencyKey: MediaUploadIdempotencyKey;
    requestHash: string;
    maxItems: number;
  }) {
    const replayKey = `${input.contextId}:${input.idempotencyKey}`;
    const replay = this.#purchaseIdempotency.get(replayKey);
    if (replay) {
      if (replay.requestHash !== input.requestHash) {
        throw new PurchaseExperienceMediaIdempotencyConflictError();
      }
      return (await this.inspect(replay.mediaId))!;
    }
    const count = [...this.#objects.values()].filter(
      (item) =>
        item.purpose === "PURCHASE_EXPERIENCE_IMAGE" &&
        item.ownerReferenceId === input.contextId,
    ).length;
    if (count >= input.maxItems) throw new PurchaseExperienceMediaLimitError();
    await this.put(input.object);
    this.#purchaseIdempotency.set(replayKey, {
      requestHash: input.requestHash,
      mediaId: input.object.key,
    });
    return (await this.inspect(input.object.key))!;
  }

  async putBuyerDisputeMedia(input: {
    object: StoredMedia;
    contextId: BuyerDisputeMediaContextId;
    idempotencyKey: MediaUploadIdempotencyKey;
    requestHash: string;
    maxItems: number;
  }) {
    const context = await this.readBuyerDisputeUploadContext(input.contextId);
    if (!context || context.identityId !== input.object.ownerIdentityId) {
      throw new Error("Buyer dispute media context is unavailable");
    }
    const replayKey = `${input.contextId}:${input.idempotencyKey}`;
    const replay = this.#buyerDisputeIdempotency.get(replayKey);
    if (replay) {
      if (replay.requestHash !== input.requestHash) {
        throw new BuyerDisputeMediaIdempotencyConflictError();
      }
      return (await this.inspect(replay.mediaId))!;
    }
    const count = [...this.#objects.values()].filter(
      (item) =>
        item.purpose === "BUYER_DISPUTE_EVIDENCE" &&
        item.ownerReferenceId === input.contextId,
    ).length;
    if (count >= input.maxItems) throw new BuyerDisputeMediaLimitError();
    await this.put(input.object);
    this.#buyerDisputeIdempotency.set(replayKey, {
      requestHash: input.requestHash,
      mediaId: input.object.key,
    });
    return (await this.inspect(input.object.key))!;
  }
}
