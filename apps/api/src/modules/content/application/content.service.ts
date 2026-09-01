import { createHash } from "node:crypto";

import {
  createPurchaseExperienceMediaContextInputContract,
  contentIdempotencyKeyContract,
  productPurchaseExperiencesContract,
  publicSalesContentStoreIdsV2Contract,
  publishPurchaseExperienceInputV2Contract,
  publishSalesContentInputV2Contract,
} from "@sevo/contracts/content/v2";
import { orderItemIdContract } from "@sevo/contracts/orders/v1";
import { identityIdContract, productIdContract } from "@sevo/contracts/platform/v1";

import { StoreNotSellableError, StoreOwnershipRequiredError } from "../../store/public";

import {
  ContentFault,
  type ContentMediaRead,
  type ContentProductRead,
  type ContentRepository,
  type ContentRequest,
  type ContentSellerAccessRead,
  type ContentSessionRead,
  type ContentStoreRead,
  type PurchaseEligibilityRead,
} from "../public";

export class ContentService {
  constructor(
    private readonly repository: ContentRepository,
    private readonly sessions: ContentSessionRead,
    private readonly sellerAccess: ContentSellerAccessRead,
    private readonly stores: ContentStoreRead,
    private readonly products: ContentProductRead,
    private readonly media: ContentMediaRead,
    private readonly purchases: PurchaseEligibilityRead,
  ) {}

  async publishSalesContent(request: ContentRequest, body: unknown, key: unknown) {
    const actorId = await this.requireIdentity(request);
    const parsedInput = publishSalesContentInputV2Contract.safeParse(body);
    if (!parsedInput.success) throw new ContentFault("NOT_ELIGIBLE");
    const input = parsedInput.data;
    const idempotencyKey = this.requireKey(key);
    const mutation = {
      actorId,
      correlationId: request.correlationId,
      idempotencyKey,
      requestHash: hash(input),
    };
    const replay = await this.repository.replaySalesContent(mutation);
    if (replay) return replay;
    if (!(await this.sellerAccess.isActiveSeller(actorId))) {
      throw new ContentFault("FORBIDDEN");
    }
    try {
      await this.stores.requireOwnedSellable(actorId, input.storeId);
    } catch (error) {
      if (
        error instanceof StoreOwnershipRequiredError ||
        error instanceof StoreNotSellableError
      ) {
        throw new ContentFault("FORBIDDEN");
      }
      throw error;
    }
    if (
      (await this.media.readOwnedKind(input.media.mediaId, actorId)) !==
      input.media.kind
    ) {
      throw new ContentFault("FORBIDDEN");
    }
    const products = await Promise.all(
      input.productIds.map(async (productId) => {
        const product = await this.products.readPublishedProduct(
          productId,
          input.storeId,
        );
        if (!product) throw new ContentFault("NO_ACTIVE_PRODUCT");
        return { productId, publicationVersion: product.publicationVersion };
      }),
    );
    return this.repository.publishSalesContent({
      ...mutation,
      input,
      products,
    });
  }

  async publishPurchaseExperience(
    request: ContentRequest,
    body: unknown,
    key: unknown,
  ) {
    const actorId = await this.requireIdentity(request);
    const parsedInput = publishPurchaseExperienceInputV2Contract.safeParse(body);
    if (!parsedInput.success) throw new ContentFault("NOT_ELIGIBLE");
    const input = parsedInput.data;
    if (input.buyerId !== actorId) throw new ContentFault("FORBIDDEN");
    const idempotencyKey = this.requireKey(key);
    const mutation = {
      actorId,
      correlationId: request.correlationId,
      idempotencyKey,
      requestHash: hash(input),
    };
    const replay = await this.repository.replayPurchaseExperience(mutation);
    if (replay) return replay;
    const eligibility = await this.purchases.readEligibility({
      buyerId: actorId,
      orderItemId: input.orderItemId,
    });
    if (!eligibility.eligible) throw new ContentFault(eligibility.reason);
    if (
      !(await this.media.arePurchaseExperienceImagesReady({
        identityId: actorId,
        orderItemId: input.orderItemId,
        mediaIds: input.mediaIds,
      }))
    ) {
      throw new ContentFault("FORBIDDEN");
    }
    return this.repository.publishPurchaseExperience({
      ...mutation,
      input,
      storeId: eligibility.storeId,
      productId: eligibility.productId,
    });
  }

  async readPurchaseExperienceEligibility(
    request: ContentRequest,
    rawOrderItemId: unknown,
  ) {
    const buyerId = await this.requireIdentity(request);
    const parsedOrderItemId = orderItemIdContract.safeParse(rawOrderItemId);
    if (!parsedOrderItemId.success) throw new ContentFault("NOT_ELIGIBLE");
    const eligibility = await this.purchases.readEligibility({
      buyerId,
      orderItemId: parsedOrderItemId.data,
    });
    if (!eligibility.eligible) return eligibility;
    if (await this.repository.hasPurchaseExperience(parsedOrderItemId.data)) {
      return { eligible: false, reason: "ALREADY_SUBMITTED" } as const;
    }
    return eligibility;
  }

  async readProductPurchaseExperiences(rawProductId: unknown) {
    const productId = productIdContract.safeParse(rawProductId);
    if (!productId.success) throw new ContentFault("NOT_ELIGIBLE");
    return productPurchaseExperiencesContract.parse(
      await this.repository.readProductPurchaseExperiences(productId.data),
    );
  }

  async createPurchaseExperienceMediaContext(
    request: ContentRequest,
    body: unknown,
    key: unknown,
  ) {
    const actorId = await this.requireIdentity(request);
    this.requireKey(key);
    const parsed = createPurchaseExperienceMediaContextInputContract.safeParse(body);
    if (!parsed.success) throw new ContentFault("NOT_ELIGIBLE");
    const eligibility = await this.purchases.readEligibility({
      buyerId: actorId,
      orderItemId: parsed.data.orderItemId,
    });
    if (!eligibility.eligible) throw new ContentFault(eligibility.reason);
    if (await this.repository.hasPurchaseExperience(parsed.data.orderItemId)) {
      throw new ContentFault("ALREADY_SUBMITTED");
    }
    return this.media.issuePurchaseExperienceUploadContext({
      identityId: actorId,
      orderItemId: parsed.data.orderItemId,
    });
  }

  async readPublicSalesContent(rawStoreIds: unknown) {
    const parsed = publicSalesContentStoreIdsV2Contract.safeParse(rawStoreIds);
    if (!parsed.success) throw new ContentFault("INVALID_QUERY");
    return this.repository.readPublicSalesContent(parsed.data);
  }

  private async requireIdentity(request: ContentRequest) {
    if (!request.sessionToken) throw new ContentFault("UNAUTHENTICATED");
    const session = await this.sessions.readActiveIdentitySession(request.sessionToken);
    if (!session) throw new ContentFault("UNAUTHENTICATED");
    return identityIdContract.parse(session.identityId);
  }

  private requireKey(value: unknown) {
    const parsed = contentIdempotencyKeyContract.safeParse(value);
    if (!parsed.success) throw new ContentFault("PRECONDITION_REQUIRED");
    return parsed.data;
  }
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
