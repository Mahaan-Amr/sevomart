import { ConversationCursorCodec } from "./conversation-cursor";
import { createHash } from "node:crypto";
import {
  conversationLimitContract,
  conversationMessagePageV1Contract,
  conversationNeedsReplyV1Contract,
  conversationThreadPageV1Contract,
  sendConversationMessageInputV1Contract,
  conversationIdContract,
  conversationIdempotencyKeyContract,
  conversationThreadV1Contract,
  openConversationInputV1Contract,
  type ConversationContextV1,
} from "@sevo/contracts/conversations/v1";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import type {
  ConversationMediaAccess,
  ConversationAttachmentReader,
} from "../../media/public";
import { conversationAttachmentInputContract } from "@sevo/contracts/media/v1";
import type {
  IdentitySessionReader,
  SellerAccessRead,
} from "../../identity-access/public";
import type { StoreAuthoritativeRead } from "../../store/public";
import type { ProductAuthoritativeRead } from "../../product/public";
import type { OrderConversationEligibility } from "../../orders/public";
import {
  ConversationFault,
  type ConversationRepository,
  type ConversationRequest,
  type StoredConversation,
} from "../public";

export class ConversationService {
  private readonly cursor: ConversationCursorCodec;
  constructor(
    private readonly repository: ConversationRepository,
    private readonly sessions: IdentitySessionReader,
    private readonly stores: StoreAuthoritativeRead,
    private readonly sellers: SellerAccessRead,
    private readonly products: ProductAuthoritativeRead,
    private readonly orders: OrderConversationEligibility,
    private readonly media: ConversationAttachmentReader,
    cursorSecret: string,
  ) {
    this.cursor = new ConversationCursorCodec(cursorSecret);
  }
  private async actor(request: ConversationRequest) {
    const read = await this.sessions.readIdentitySession(request.sessionToken ?? "");
    if (!read) throw new ConversationFault("UNAUTHENTICATED");
    if (read.identityStatus !== "ACTIVE")
      throw new ConversationFault("IDENTITY_INACTIVE");
    return read.session.actor.identityId;
  }
  private async eligible(identityId: string, context: ConversationContextV1) {
    const store = await this.stores.readStore(context.storeId);
    if (!store) throw new ConversationFault("CONTEXT_NOT_FOUND");
    if (store.owner.identityId === identityId)
      throw new ConversationFault("FORBIDDEN_CONTEXT");
    if (!(await this.sellers.isActiveSeller(store.owner.identityId)))
      throw new ConversationFault("CONTEXT_UNAVAILABLE");
    if (context.kind !== "ORDER" && store.publicationStatus !== "PUBLISHED")
      throw new ConversationFault("CONTEXT_UNAVAILABLE");
    if (
      context.kind === "PRODUCT" &&
      !(await this.products.readPublishedProduct(context.productId, context.storeId))
    )
      throw new ConversationFault("CONTEXT_UNAVAILABLE");
    if (
      context.kind === "ORDER" &&
      !(await this.orders.checkConversationOrder({
        identityId: identityIdContract.parse(identityId),
        orderId: context.orderId,
        storeId: context.storeId,
      }))
    )
      throw new ConversationFault("FORBIDDEN_CONTEXT");
    return store.owner.identityId;
  }
  private async role(identityId: string, thread: StoredConversation) {
    if (thread.buyerIdentityId === identityId) return "BUYER" as const;
    if (thread.sellerIdentityId === identityId) {
      const store = await this.stores.readStore(thread.context.storeId);
      if (
        store?.owner.identityId === identityId &&
        (await this.sellers.isActiveSeller(identityIdContract.parse(identityId)))
      )
        return "SELLER" as const;
    }
    throw new ConversationFault("FORBIDDEN_CONVERSATION");
  }
  async open(request: ConversationRequest, value: unknown, key: unknown) {
    const identityId = await this.actor(request);
    const input = openConversationInputV1Contract.safeParse(value);
    const idempotency = conversationIdempotencyKeyContract.safeParse(key);
    if (!input.success || !idempotency.success)
      throw new ConversationFault("FORBIDDEN_CONTEXT");
    const context = canonicalContext(input.data.context);
    return this.repository.open(
      {
        identityId,
        context,
        key: idempotency.data,
        requestHash: createHash("sha256")
          .update(JSON.stringify({ context }))
          .digest("hex"),
        correlationId: request.correlationId,
      },
      async (existing) => {
        await this.actor(request);
        if (existing) {
          await this.role(identityId, existing);
          return existing.sellerIdentityId;
        }
        return this.eligible(identityId, context);
      },
    );
  }
  async send(
    request: ConversationRequest,
    value: unknown,
    content: unknown,
    key: unknown,
  ) {
    const identityId = await this.actor(request);
    const id = conversationIdContract.safeParse(
      typeof value === "string" ? value.toLowerCase() : value,
    );
    if (!id.success) throw new ConversationFault("CONVERSATION_NOT_FOUND");
    const input = sendConversationMessageInputV1Contract.safeParse(content);
    const idempotency = conversationIdempotencyKeyContract.safeParse(key);
    if (!input.success || !idempotency.success)
      throw new ConversationFault("MESSAGE_REJECTED");
    if (input.data.content.type === "MEDIA")
      input.data.content.mediaId =
        input.data.content.mediaId.toLowerCase() as typeof input.data.content.mediaId;
    return this.repository.send(
      {
        identityId,
        conversationId: id.data,
        content: input.data.content,
        key: idempotency.data,
        requestHash: createHash("sha256")
          .update(JSON.stringify(input.data))
          .digest("hex"),
        correlationId: request.correlationId,
      },
      async (thread) => {
        await this.actor(request);
        return this.role(identityId, thread);
      },
      async () => {
        if (input.data.content.type === "MEDIA") {
          const readiness = await this.media.checkConversationAttachment(
            conversationAttachmentInputContract.parse({
              identityId,
              conversationId: id.data,
              mediaId: input.data.content.mediaId,
            }),
          );
          if (readiness !== "READY") throw new ConversationFault(readiness);
        }
      },
    );
  }
  async list(
    request: ConversationRequest,
    query: { cursor?: unknown; limit?: unknown },
    value?: string,
  ) {
    const identityId = await this.actor(request);
    const operation = value === undefined ? "THREADS" : "MESSAGES";
    let conversationId: string | undefined;
    if (value !== undefined) {
      const id = conversationIdContract.safeParse(
        typeof value === "string" ? value.toLowerCase() : value,
      );
      const thread = id.success ? await this.repository.read(id.data) : undefined;
      if (!thread) throw new ConversationFault("CONVERSATION_NOT_FOUND");
      await this.role(identityId, thread);
      conversationId = thread.conversationId;
    }
    const limit = conversationLimitContract.safeParse(query.limit ?? 30);
    if (
      !limit.success ||
      (query.cursor !== undefined && typeof query.cursor !== "string")
    )
      throw new ConversationFault("INVALID_CURSOR");
    const continuation =
      typeof query.cursor === "string"
        ? this.cursor.decode(identityId, query.cursor, operation, conversationId)
        : undefined;
    const snapshot = continuation
      ? await this.repository.readSnapshot(continuation.snapshotId)
      : await this.repository.snapshot(identityId, operation, conversationId);
    if (!snapshot || snapshot.expiresAt.getTime() <= Date.now())
      throw new ConversationFault("CURSOR_EXPIRED");
    if (
      snapshot.identityId !== identityId ||
      snapshot.operation !== operation ||
      snapshot.conversationId !== conversationId
    )
      throw new ConversationFault("INVALID_CURSOR");
    const entries = await this.repository.entries(
      snapshot.snapshotId,
      limit.data + 1,
      continuation,
    );
    const page = entries.slice(0, limit.data);
    const items: unknown[] = [];
    for (const entry of page) {
      if (conversationId) {
        const message = await this.repository.readMessage(conversationId, entry.itemId);
        if (message) items.push(message);
      } else {
        const thread = await this.repository.read(entry.itemId);
        if (!thread) continue;
        try {
          items.push(
            conversationThreadV1Contract.parse({
              version: 1,
              conversationId: thread.conversationId,
              context: thread.context,
              viewerRole: await this.role(identityId, thread),
              createdAt: thread.createdAt.toISOString(),
              updatedAt: entry.sortAt.toISOString(),
            }),
          );
        } catch (error) {
          if (
            !(error instanceof ConversationFault) ||
            error.code !== "FORBIDDEN_CONVERSATION"
          )
            throw error;
        }
      }
    }
    const last = page.at(-1);
    const nextCursor =
      entries.length > limit.data && last
        ? this.cursor.encode(identityId, {
            snapshotId: snapshot.snapshotId,
            operation,
            conversationId,
            lastAt: last.sortAt.toISOString(),
            lastId: last.itemId,
            expiresAt: snapshot.expiresAt.toISOString(),
          })
        : undefined;
    await this.repository.audit(
      identityId,
      operation === "THREADS" ? "ListConversations.v1" : "ListConversationMessages.v1",
      "SUCCESS",
      request.correlationId,
      conversationId,
    );
    return (
      conversationId
        ? conversationMessagePageV1Contract
        : conversationThreadPageV1Contract
    ).parse({ version: 1, items, ...(nextCursor ? { nextCursor } : {}) });
  }
  async readNeedsReply(request: ConversationRequest) {
    const identityId = await this.actor(request);
    const thread = await this.repository.findNearestNeedingReply(identityId);
    if (!thread) {
      await this.repository.audit(
        identityId,
        "ReadConversationNeedsReply.v1",
        "SUCCESS",
        request.correlationId,
      );
      return conversationNeedsReplyV1Contract.parse({
        version: 1,
        status: "NONE",
      });
    }
    const viewerRole = await this.role(identityId, thread);
    await this.repository.audit(
      identityId,
      "ReadConversationNeedsReply.v1",
      "SUCCESS",
      request.correlationId,
      thread.conversationId,
    );
    return conversationNeedsReplyV1Contract.parse({
      version: 1,
      status: "ACTIONABLE",
      conversation: {
        version: 1,
        conversationId: thread.conversationId,
        context: thread.context,
        viewerRole,
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
      },
    });
  }
  async canAccessMedia(
    input: Parameters<ConversationMediaAccess>[0],
  ): Promise<boolean> {
    const id = conversationIdContract.safeParse(input.conversationId);
    if (!id.success) return false;
    const thread = await this.repository.read(id.data);
    if (!thread) return false;
    try {
      await this.role(input.identityId, thread);
    } catch (error) {
      if (error instanceof ConversationFault) return false;
      throw error;
    }
    return input.mediaId ? this.repository.hasAttachment(id.data, input.mediaId) : true;
  }
  async recordFailure(request: ConversationRequest, code: ConversationFault["code"]) {
    const session = await this.sessions.readIdentitySession(request.sessionToken ?? "");
    await this.repository.audit(
      session?.session.actor.identityId,
      "ConversationRequest.v1",
      code,
      request.correlationId,
    );
  }
  async read(request: ConversationRequest, value: unknown) {
    const identityId = await this.actor(request);
    const id = conversationIdContract.safeParse(
      typeof value === "string" ? value.toLowerCase() : value,
    );
    const thread = id.success ? await this.repository.read(id.data) : undefined;
    if (!thread) throw new ConversationFault("CONVERSATION_NOT_FOUND");
    const viewerRole = await this.role(identityId, thread);
    await this.repository.audit(
      identityId,
      "ReadConversation.v1",
      "SUCCESS",
      request.correlationId,
      thread.conversationId,
    );
    return conversationThreadV1Contract.parse({
      version: 1,
      conversationId: thread.conversationId,
      context: thread.context,
      viewerRole,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
    });
  }
}

function canonicalContext(context: ConversationContextV1): ConversationContextV1 {
  return openConversationInputV1Contract.parse({
    context: {
      ...context,
      storeId: context.storeId.toLowerCase(),
      ...(context.kind === "PRODUCT"
        ? { productId: context.productId.toLowerCase() }
        : {}),
      ...(context.kind === "ORDER" ? { orderId: context.orderId.toLowerCase() } : {}),
    },
  }).context;
}
