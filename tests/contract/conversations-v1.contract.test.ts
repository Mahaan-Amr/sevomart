import {
  conversationCursorContract,
  conversationContextEligibilityV1Contract,
  conversationContextV1Contract,
  conversationErrorV1Contract,
  conversationIdContract,
  conversationIdempotencyKeyContract,
  conversationMessagePageV1Contract,
  conversationMessageV1Contract,
  conversationThreadPageV1Contract,
  conversationThreadV1Contract,
  createConversationsV1JsonSchemas,
  messageSentV1Contract,
} from "@sevo/contracts/conversations/v1";
import { describe, expect, it } from "vitest";

const storeId = "15f16eaf-1e01-4e40-b0e6-b8ce19268893";
const productId = "0d113616-5ad8-45d2-a126-b5b3412b3dd7";
const orderId = "47a3f408-858c-45d7-a0bd-ab84a28718ef";
const conversationId = "7a30197b-85fb-4209-83e8-743ab3bea71c";
const messageId = "2c532e73-a701-41b0-98c4-9cad6f8d62dc";
const occurredAt = "2026-08-27T09:00:00.000Z";

describe("conversations v1 public contract", () => {
  it("defines strict store, product, and order contexts with explicit eligibility", () => {
    expect(conversationContextV1Contract.parse({ kind: "STORE", storeId })).toEqual({
      kind: "STORE",
      storeId,
    });
    expect(
      conversationContextV1Contract.parse({ kind: "PRODUCT", storeId, productId }),
    ).toEqual({ kind: "PRODUCT", storeId, productId });
    expect(
      conversationContextV1Contract.parse({ kind: "ORDER", storeId, orderId }),
    ).toEqual({ kind: "ORDER", storeId, orderId });

    expect(
      conversationContextEligibilityV1Contract.parse({
        status: "ELIGIBLE",
        context: { kind: "ORDER", storeId, orderId },
        buyerIdentityId: "42a69843-f87c-4788-8a86-6345c56e5df7",
        sellerIdentityId: "7b99e256-756f-4144-9280-8d388c3c27ac",
      }),
    ).toMatchObject({ status: "ELIGIBLE" });
    expect(
      conversationContextEligibilityV1Contract.parse({
        status: "INELIGIBLE",
        reason: "FORBIDDEN_CONTEXT",
      }),
    ).toEqual({ status: "INELIGIBLE", reason: "FORBIDDEN_CONTEXT" });

    expect(() =>
      conversationContextV1Contract.parse({
        kind: "PRODUCT",
        storeId,
        productId,
        orderId,
      }),
    ).toThrow();
  });

  it("publishes buyer and seller thread views with opaque cursor pagination", () => {
    const buyerThread = conversationThreadV1Contract.parse({
      version: 1,
      conversationId,
      context: { kind: "PRODUCT", storeId, productId },
      viewerRole: "BUYER",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    const sellerThread = conversationThreadV1Contract.parse({
      ...buyerThread,
      viewerRole: "SELLER",
    });

    expect(conversationIdContract.parse(conversationId)).toBe(conversationId);
    expect(conversationCursorContract.parse("opaque.next-page")).toBe(
      "opaque.next-page",
    );
    expect(
      conversationThreadPageV1Contract.parse({
        version: 1,
        items: [buyerThread, sellerThread],
        nextCursor: "opaque.next-page",
      }),
    ).toMatchObject({ items: [{ viewerRole: "BUYER" }, { viewerRole: "SELLER" }] });
  });

  it("keeps authenticated message views and public events free of account PII", () => {
    const message = conversationMessageV1Contract.parse({
      version: 1,
      messageId,
      conversationId,
      senderRole: "BUYER",
      content: { type: "TEXT", text: "سلام، این کالا هنوز موجود است؟" },
      status: "SENT",
      createdAt: occurredAt,
    });
    const event = messageSentV1Contract.parse({
      version: 1,
      eventId: "290376c4-e2cd-4fe6-a71a-f0b12eab9015",
      eventType: "MessageSent.v1",
      aggregateId: conversationId,
      aggregateVersion: 1,
      occurredAt,
      correlationId: "17de9c74-f6e1-4bda-843d-9ecf95918c3e",
      actor: {
        type: "IDENTITY",
        id: "42a69843-f87c-4788-8a86-6345c56e5df7",
      },
      payload: {
        conversationId,
        messageId,
        contextKind: "PRODUCT",
        senderRole: "BUYER",
      },
    });

    expect(
      conversationMessagePageV1Contract.parse({ version: 1, items: [message] }),
    ).toMatchObject({ items: [{ status: "SENT" }] });
    expect(JSON.stringify(message)).not.toMatch(
      /mobile|phone|address|contact|buyerIdentityId|sellerIdentityId/i,
    );
    expect(JSON.stringify(event.payload)).not.toMatch(
      /"(?:text|content|media|mobile|phone|address|contact|identity)[^"]*"/i,
    );
    expect(() =>
      conversationMessageV1Contract.parse({ ...message, mobile: "09120000000" }),
    ).toThrow();
  });

  it("defines idempotent send keys and recoverable access, cursor, and retry errors", () => {
    expect(conversationIdempotencyKeyContract.parse("send-message-01")).toBe(
      "send-message-01",
    );
    expect(
      conversationErrorV1Contract.parse({
        version: 1,
        code: "FORBIDDEN_CONVERSATION",
        message: "به این گفت‌وگو دسترسی ندارید.",
        correlationId: "17de9c74-f6e1-4bda-843d-9ecf95918c3e",
      }),
    ).toMatchObject({ code: "FORBIDDEN_CONVERSATION" });
    expect(
      conversationErrorV1Contract.parse({
        version: 1,
        code: "IDEMPOTENCY_IN_PROGRESS",
        message: "ارسال قبلی هنوز در حال انجام است.",
        correlationId: "17de9c74-f6e1-4bda-843d-9ecf95918c3e",
        details: { retryAfterSeconds: 2 },
      }),
    ).toMatchObject({ details: { retryAfterSeconds: 2 } });
    expect(createConversationsV1JsonSchemas()).toMatchObject({
      ConversationThreadV1: expect.any(Object),
      ConversationMessageV1: expect.any(Object),
      ConversationErrorV1: expect.any(Object),
      MessageSentV1: expect.any(Object),
    });
  });
});
