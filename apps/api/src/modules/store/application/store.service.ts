import { createHash, randomUUID } from "node:crypto";

import { storeAuthoritativeSnapshotV1Contract } from "@sevo/contracts/store/v1";
import type {
  PublicStore,
  StoreDraft,
  StoreDraftInput,
  StorePreview,
  StorePublication,
  StoreAuthoritativeSnapshotV1,
  StoreSlug,
} from "@sevo/contracts/store/v1";
import type { MediaId } from "@sevo/contracts/media/v1";
import type { IdentityId, StoreId } from "@sevo/contracts/platform/v1";
import type { SellerAccessRead } from "../../identity-access/public";

import type {
  SettlementDestination,
  StoreAuthoritativeRead,
  StoreRepository,
  StoreRow,
  StoreShippingMethod,
  VerifiedSettlementDestination,
  OpaqueStoreTransactionContext,
} from "../public";
import { StoreNotSellableError, StoreOwnershipRequiredError } from "../public";

export type MissingStoreField =
  StorePreview["publicationReadiness"]["missingFields"][number];

export class StoreNotFoundError extends Error {}
export class InvalidStoreMediaError extends Error {
  constructor(readonly mediaId: string) {
    super("Store media is missing or belongs to another seller");
  }
}
export class StoreSlugConflictError extends Error {
  constructor(readonly slug: string) {
    super("Store slug is already in use");
  }
}
export class IncompleteStoreError extends Error {
  constructor(readonly missingFields: MissingStoreField[]) {
    super("Store draft is incomplete");
  }
}

type VerifySettlement = (
  destination: SettlementDestination,
) => Promise<VerifiedSettlementDestination>;
type ResolveMedia = (id: string) => Promise<
  | {
      contentType: "image/webp";
      ownerSellerId: string;
    }
  | undefined
>;
type PublishMedia = (id: string, sellerId: string) => Promise<void>;
type UnpublishMedia = (id: string, sellerId: string) => Promise<void>;

type StoreWriteRequest = {
  correlationId: string;
  idempotencyKey: string;
  expectedRevision: number;
};

export class StoreService implements StoreAuthoritativeRead {
  constructor(
    private readonly repository: StoreRepository,
    private readonly verifySettlement: VerifySettlement,
    private readonly now: () => Date = () => new Date(),
    private readonly resolveMedia: ResolveMedia = async () => undefined,
    private readonly publishMedia: PublishMedia = async () => undefined,
    private readonly unpublishMedia: UnpublishMedia = async () => undefined,
    private readonly sellerAccess?: SellerAccessRead,
  ) {}

  async readDraft(sellerId: string): Promise<StoreDraft> {
    const row = await this.repository.findBySellerId(sellerId);
    if (!row) throw new StoreNotFoundError();
    return toDraft(row);
  }

  async saveDraft(
    sellerId: string,
    input: StoreDraftInput,
    context: StoreWriteRequest,
  ): Promise<StoreDraft> {
    await this.assertOwnedMedia(sellerId, [input.logoMediaId, input.coverMediaId]);
    const current = await this.repository.findBySellerId(sellerId);
    if (input.slug) {
      const owner = await this.repository.findBySlug(input.slug);
      if (owner && owner.sellerId !== sellerId) {
        throw new StoreSlugConflictError(input.slug);
      }
    }

    const settlementDestination = input.settlementDestination
      ? await this.verifySettlement(input.settlementDestination)
      : current?.settlementDestination;
    const updatedAt = this.now();
    const shippingMethods = input.shippingMethods
      ? versionShippingMethods(input.shippingMethods, current?.shippingMethods)
      : current?.shippingMethods;
    const policyChanged =
      (input.returnPolicy !== undefined &&
        input.returnPolicy !== current?.returnPolicy) ||
      (input.shippingMethods !== undefined &&
        !sameShippingMethods(shippingMethods, current?.shippingMethods));
    const returnPolicyRevision =
      input.returnPolicy !== undefined && input.returnPolicy !== current?.returnPolicy
        ? (current?.returnPolicyRevision ?? 0) + 1
        : (current?.returnPolicyRevision ?? (current?.returnPolicy ? 1 : 0));
    const saved = await this.repository.saveDraft(
      {
        id: current?.id ?? randomUUID(),
        sellerId,
        name: input.name ?? current?.name,
        slug: input.slug ?? current?.slug,
        bio: input.bio ?? current?.bio,
        shippingMethods,
        returnPolicy: input.returnPolicy ?? current?.returnPolicy,
        returnPolicyRevision,
        settlementDestination,
        logoMediaId:
          input.logoMediaId !== undefined
            ? input.logoMediaId
            : (current?.logoMediaId ?? null),
        coverMediaId:
          input.coverMediaId !== undefined
            ? input.coverMediaId
            : (current?.coverMediaId ?? null),
        themeColor: input.themeColor ?? current?.themeColor ?? "#A41439",
        status: "DRAFT",
        publishedAt: undefined,
        publicationVersion: current?.publicationVersion ?? 0,
        revision: context.expectedRevision + 1,
        updatedAt,
      },
      {
        operation: "SAVE_STORE_DRAFT",
        actorId: sellerId,
        correlationId: context.correlationId,
        idempotencyKey: context.idempotencyKey,
        requestHash: hashParsedInput(input),
        expectedRevision: context.expectedRevision,
        policyChanged,
      },
    );
    if (current?.status === "PUBLISHED") {
      await Promise.all(
        [
          current.logoMediaId,
          current.coverMediaId,
          saved.logoMediaId,
          saved.coverMediaId,
        ]
          .filter((id): id is string => Boolean(id))
          .filter((id, index, ids) => ids.indexOf(id) === index)
          .map((id) => this.unpublishMedia(id, sellerId)),
      );
    }
    return toDraft(saved);
  }

  async checkSlug(slug: string, sellerId: string) {
    const owner = await this.repository.findBySlug(slug);
    return { slug, available: !owner || owner.sellerId === sellerId };
  }

  async preview(sellerId: string): Promise<StorePreview> {
    const row = await this.repository.findBySellerId(sellerId);
    if (!row) throw new StoreNotFoundError();
    const missingFields = publicationReadiness(row);
    return {
      store: toDraft(row),
      publicationReadiness: { ready: missingFields.length === 0, missingFields },
    };
  }

  async publish(
    sellerId: string,
    context: StoreWriteRequest,
  ): Promise<StorePublication> {
    const row = await this.repository.findBySellerId(sellerId);
    if (!row) throw new StoreNotFoundError();
    if (row.status === "PUBLISHED") {
      const published = await this.repository.publish(row.id, this.now(), {
        operation: "PUBLISH_STORE",
        correlationId: context.correlationId,
        actorId: sellerId,
        idempotencyKey: context.idempotencyKey,
        requestHash: hashParsedInput({ storeId: row.id }),
        expectedRevision: context.expectedRevision,
      });
      return {
        store: await this.toPublicStore(published),
        publicUrl: `/s/${published.slug!}`,
      };
    }
    const missingFields = publicationReadiness(row);
    if (missingFields.length > 0) throw new IncompleteStoreError(missingFields);
    const conflicting = await this.repository.findBySlug(row.slug!);
    if (conflicting && conflicting.sellerId !== sellerId) {
      throw new StoreSlugConflictError(row.slug!);
    }
    await this.assertOwnedMedia(sellerId, [row.logoMediaId, row.coverMediaId]);
    const mediaIds = [row.logoMediaId, row.coverMediaId].filter((id): id is string =>
      Boolean(id),
    );
    try {
      await Promise.all(mediaIds.map((id) => this.publishMedia(id, sellerId)));
    } catch (error) {
      await Promise.allSettled(mediaIds.map((id) => this.unpublishMedia(id, sellerId)));
      throw error;
    }
    let published: StoreRow;
    try {
      published = await this.repository.publish(row.id, this.now(), {
        operation: "PUBLISH_STORE",
        correlationId: context.correlationId,
        actorId: sellerId,
        idempotencyKey: context.idempotencyKey,
        requestHash: hashParsedInput({ storeId: row.id }),
        expectedRevision: context.expectedRevision,
      });
    } catch (error) {
      await Promise.allSettled(mediaIds.map((id) => this.unpublishMedia(id, sellerId)));
      throw error;
    }
    return {
      store: await this.toPublicStore(published),
      publicUrl: `/s/${published.slug!}`,
    };
  }

  async readPublished(slug: string): Promise<PublicStore> {
    const row = await this.repository.findBySlug(slug);
    if (!row || row.status !== "PUBLISHED") throw new StoreNotFoundError();
    return this.toPublicStore(row);
  }

  async readStore(storeId: StoreId): Promise<StoreAuthoritativeSnapshotV1 | undefined> {
    const row = await this.repository.findById(storeId);
    return row ? this.toAuthoritativeStore(row) : undefined;
  }

  async readStoreInTransaction(
    transaction: OpaqueStoreTransactionContext,
    storeId: StoreId,
  ): Promise<StoreAuthoritativeSnapshotV1 | undefined> {
    const row = await this.repository.findByIdInTransaction?.(transaction, storeId);
    return row ? this.toAuthoritativeStore(row) : undefined;
  }

  async readOwnedStore(
    identityId: IdentityId,
  ): Promise<StoreAuthoritativeSnapshotV1 | undefined> {
    const row = await this.repository.findBySellerId(identityId);
    return row ? this.toAuthoritativeStore(row) : undefined;
  }

  async readPublishedStoreBySlug(
    slug: StoreSlug,
  ): Promise<StoreAuthoritativeSnapshotV1 | undefined> {
    const row = await this.repository.findBySlug(slug);
    return row?.status === "PUBLISHED" ? this.toAuthoritativeStore(row) : undefined;
  }

  async requireOwnership(
    identityId: IdentityId,
    storeId: StoreId,
  ): Promise<StoreAuthoritativeSnapshotV1> {
    const store = await this.readStore(storeId);
    if (!store || store.owner.identityId !== identityId) {
      throw new StoreOwnershipRequiredError(storeId);
    }
    return store;
  }

  async requireSellable(storeId: StoreId): Promise<StoreAuthoritativeSnapshotV1> {
    const store = await this.readStore(storeId);
    if (!store || store.publicationStatus !== "PUBLISHED" || !store.settlement) {
      throw new StoreNotSellableError(storeId);
    }
    return store;
  }

  async requireOwnedSellable(
    identityId: IdentityId,
    storeId: StoreId,
  ): Promise<StoreAuthoritativeSnapshotV1> {
    const store = await this.readStore(storeId);
    if (!store || store.owner.identityId !== identityId) {
      throw new StoreOwnershipRequiredError(storeId);
    }
    if (store.publicationStatus !== "PUBLISHED" || !store.settlement) {
      throw new StoreNotSellableError(storeId);
    }
    return store;
  }

  private async toAuthoritativeStore(
    row: StoreRow,
  ): Promise<StoreAuthoritativeSnapshotV1> {
    const snapshot = toAuthoritativeStore(row);
    if (!this.sellerAccess) return snapshot;
    return {
      ...snapshot,
      sellerAccess: {
        active: await this.sellerAccess.isActiveSeller(snapshot.owner.identityId),
      },
    };
  }

  private async toPublicStore(row: StoreRow): Promise<PublicStore> {
    const [logo, cover] = await Promise.all([
      row.logoMediaId ? this.resolveMedia(row.logoMediaId) : undefined,
      row.coverMediaId ? this.resolveMedia(row.coverMediaId) : undefined,
    ]);
    return toPublicStore(row, logo?.contentType, cover?.contentType);
  }

  private async assertOwnedMedia(
    sellerId: string,
    mediaIds: Array<string | null | undefined>,
  ): Promise<void> {
    await Promise.all(
      mediaIds
        .filter((id): id is string => Boolean(id))
        .map(async (id) => {
          const media = await this.resolveMedia(id);
          if (!media || media.ownerSellerId !== sellerId) {
            throw new InvalidStoreMediaError(id);
          }
        }),
    );
  }
}

function publicationReadiness(row: StoreRow): MissingStoreField[] {
  const missing: MissingStoreField[] = [];
  if (!row.name) missing.push("NAME");
  if (!row.slug) missing.push("SLUG");
  if (!row.bio) missing.push("BIO");
  if (!row.shippingMethods?.length) missing.push("SHIPPING_METHOD");
  if (!row.returnPolicy) missing.push("RETURN_POLICY");
  if (!row.settlementDestination) missing.push("SETTLEMENT_DESTINATION");
  return missing;
}

function toDraft(row: StoreRow): StoreDraft {
  return {
    id: row.id,
    revision: row.revision ?? 1,
    publicationVersion: row.publicationVersion ?? 0,
    returnPolicyRevision: row.returnPolicyRevision ?? (row.returnPolicy ? 1 : 0),
    name: row.name,
    slug: row.slug as StoreDraft["slug"],
    bio: row.bio,
    shippingMethods: row.shippingMethods?.map(toShippingMethodSnapshot),
    returnPolicy: row.returnPolicy,
    settlementDestination: row.settlementDestination
      ? { kind: "TEST", status: "TEST_VERIFIED" }
      : undefined,
    logoMediaId: row.logoMediaId as StoreDraft["logoMediaId"],
    coverMediaId: row.coverMediaId as StoreDraft["coverMediaId"],
    themeColor: row.themeColor,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  } as StoreDraft;
}

function toPublicStore(
  row: StoreRow,
  logoContentType?: "image/webp",
  coverContentType?: "image/webp",
): PublicStore {
  return {
    id: row.id,
    revision: row.revision ?? 1,
    publicationVersion: row.publicationVersion ?? 1,
    returnPolicyRevision: row.returnPolicyRevision ?? 1,
    name: row.name!,
    slug: row.slug as PublicStore["slug"],
    bio: row.bio!,
    shippingMethods: row.shippingMethods!.map(toShippingMethodSnapshot),
    returnPolicy: row.returnPolicy!,
    settlementDestination: { kind: "TEST", status: "TEST_VERIFIED" },
    logo:
      row.logoMediaId && logoContentType
        ? {
            id: row.logoMediaId as MediaId,
            contentType: logoContentType,
            url: `/v1/media/${row.logoMediaId}`,
          }
        : null,
    cover:
      row.coverMediaId && coverContentType
        ? {
            id: row.coverMediaId as MediaId,
            contentType: coverContentType,
            url: `/v1/media/${row.coverMediaId}`,
          }
        : null,
    themeColor: row.themeColor ?? "#A41439",
    status: "PUBLISHED",
    publishedAt: row.publishedAt!.toISOString(),
    activeProductCount: 0,
    trust: {
      settlementStatus: "TEST_VERIFIED",
      platformBrandingRequired: true,
    },
  };
}

function versionShippingMethods(
  input: StoreDraftInput["shippingMethods"] & readonly unknown[],
  current: StoreShippingMethod[] | undefined,
): StoreShippingMethod[] {
  return input.map((method) => {
    const previous = current?.find((candidate) => candidate.code === method.code);
    const defaults = shippingDefaults(method.code);
    const unchanged = previous?.label === method.label;
    return {
      id: previous?.id ?? randomUUID(),
      revision: previous ? previous.revision + (unchanged ? 0 : 1) : 1,
      code: method.code,
      label: method.label,
      fixedFeeAmount: previous?.fixedFeeAmount ?? 0,
      currency: "IRR",
      estimatedDeliveryText:
        previous?.estimatedDeliveryText ??
        "زمان دقیق ارسال هنگام ثبت سفارش مشخص می‌شود.",
      enabled: previous?.enabled ?? true,
      requiresDeliveryAddress: defaults.requiresDeliveryAddress,
      requiresPostalCode: defaults.requiresPostalCode,
    };
  });
}

function shippingDefaults(code: StoreShippingMethod["code"]) {
  return {
    requiresDeliveryAddress: code !== "PICKUP",
    requiresPostalCode: code === "NATIONAL_POST",
  };
}

function sameShippingMethods(
  left: StoreShippingMethod[] | undefined,
  right: StoreShippingMethod[] | undefined,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toShippingMethodSnapshot(method: StoreShippingMethod) {
  return {
    id: method.id,
    revision: method.revision,
    code: method.code,
    label: method.label,
    fixedFee: { amount: method.fixedFeeAmount, currency: method.currency },
    estimatedDeliveryText: method.estimatedDeliveryText,
    enabled: method.enabled,
    requiresDeliveryAddress: method.requiresDeliveryAddress,
    requiresPostalCode: method.requiresPostalCode,
  };
}

function toAuthoritativeStore(row: StoreRow): StoreAuthoritativeSnapshotV1 {
  return storeAuthoritativeSnapshotV1Contract.parse({
    storeId: row.id,
    revision: row.revision ?? 1,
    publicationVersion: row.publicationVersion ?? 0,
    publicationStatus: row.status,
    owner: { identityId: row.sellerId },
    ...(row.slug ? { slug: row.slug } : {}),
    displayIdentity: {
      ...(row.name ? { name: row.name } : {}),
      ...(row.bio ? { bio: row.bio } : {}),
      logoMediaId: row.logoMediaId ?? null,
      coverMediaId: row.coverMediaId ?? null,
      themeColor: row.themeColor ?? "#A41439",
    },
    shippingMethods: (row.shippingMethods ?? []).map(toShippingMethodSnapshot),
    ...(row.returnPolicy
      ? {
          returnPolicy: {
            revision: row.returnPolicyRevision ?? 1,
            text: row.returnPolicy,
          },
        }
      : {}),
    ...(row.settlementDestination
      ? { settlement: { mode: "DIRECT", status: "TEST_VERIFIED" } }
      : {}),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.publishedAt ? { publishedAt: row.publishedAt.toISOString() } : {}),
  });
}

function hashParsedInput(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
