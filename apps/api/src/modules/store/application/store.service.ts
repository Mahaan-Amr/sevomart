import { randomUUID } from "node:crypto";

import type {
  PublicStore,
  StoreDraft,
  StoreDraftInput,
  StorePreview,
  StorePublication,
} from "@sevo/contracts/store/v1";
import type { MediaId } from "@sevo/contracts/media/v1";

import type {
  SettlementDestination,
  StoreRepository,
  StoreRow,
  VerifiedSettlementDestination,
} from "../public";

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

export class StoreService {
  constructor(
    private readonly repository: StoreRepository,
    private readonly verifySettlement: VerifySettlement,
    private readonly now: () => Date = () => new Date(),
    private readonly resolveMedia: ResolveMedia = async () => undefined,
    private readonly publishMedia: PublishMedia = async () => undefined,
    private readonly unpublishMedia: UnpublishMedia = async () => undefined,
  ) {}

  async readDraft(sellerId: string): Promise<StoreDraft> {
    const row = await this.repository.findBySellerId(sellerId);
    if (!row) throw new StoreNotFoundError();
    return toDraft(row);
  }

  async saveDraft(sellerId: string, input: StoreDraftInput): Promise<StoreDraft> {
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
    const saved = await this.repository.saveDraft({
      id: current?.id ?? randomUUID(),
      sellerId,
      name: input.name ?? current?.name,
      slug: input.slug ?? current?.slug,
      bio: input.bio ?? current?.bio,
      shippingMethods: input.shippingMethods ?? current?.shippingMethods,
      returnPolicy: input.returnPolicy ?? current?.returnPolicy,
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
      updatedAt,
    });
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

  async publish(sellerId: string): Promise<StorePublication> {
    const row = await this.repository.findBySellerId(sellerId);
    if (!row) throw new StoreNotFoundError();
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
      published = await this.repository.publish(row.id, this.now());
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
    name: row.name,
    slug: row.slug as StoreDraft["slug"],
    bio: row.bio,
    shippingMethods: row.shippingMethods,
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
    name: row.name!,
    slug: row.slug as PublicStore["slug"],
    bio: row.bio!,
    shippingMethods: row.shippingMethods!,
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
