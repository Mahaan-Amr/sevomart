import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import { mediaIdContract } from "../../media-v1";
import {
  eventActorV1Contract,
  eventEnvelopeV1Contract,
  identityIdContract,
  orderIdContract,
  productIdContract,
  storeIdContract,
  timestampV1Contract,
} from "../../platform/v1/index";

export const conversationIdContract = z.uuid().brand("ConversationId");
export const conversationMessageIdContract = z.uuid().brand("ConversationMessageId");
export const conversationCursorContract = z.string().min(1).max(2_048);
export const conversationLimitContract = z.coerce.number().int().min(1).max(50);
export const conversationIdempotencyKeyContract = z.string().min(1).max(200);
export const conversationParticipantRoleV1Contract = z.enum(["BUYER", "SELLER"]);

export const conversationsV1Operations = {
  listConversations: {
    operationId: "listConversations",
    method: "get",
    path: "/v1/conversations",
  },
  openConversation: {
    operationId: "openConversation",
    method: "post",
    path: "/v1/conversations",
  },
  readConversation: {
    operationId: "readConversation",
    method: "get",
    path: "/v1/conversations/{conversationId}",
  },
  listConversationMessages: {
    operationId: "listConversationMessages",
    method: "get",
    path: "/v1/conversations/{conversationId}/messages",
  },
  sendConversationMessage: {
    operationId: "sendConversationMessage",
    method: "post",
    path: "/v1/conversations/{conversationId}/messages",
  },
} as const;

export const conversationContextV1Contract = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("STORE"), storeId: storeIdContract }).strict(),
  z
    .object({
      kind: z.literal("PRODUCT"),
      storeId: storeIdContract,
      productId: productIdContract,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ORDER"),
      storeId: storeIdContract,
      orderId: orderIdContract,
    })
    .strict(),
]);

export const conversationContextEligibilityV1Contract = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ELIGIBLE"),
      context: conversationContextV1Contract,
      buyerIdentityId: identityIdContract,
      sellerIdentityId: identityIdContract,
    })
    .strict(),
  z
    .object({
      status: z.literal("INELIGIBLE"),
      reason: z.enum(["FORBIDDEN_CONTEXT", "CONTEXT_NOT_FOUND", "CONTEXT_UNAVAILABLE"]),
    })
    .strict(),
]);

export const openConversationInputV1Contract = z
  .object({ context: conversationContextV1Contract })
  .strict();

export const conversationThreadV1Contract = z
  .object({
    version: z.literal(1),
    conversationId: conversationIdContract,
    context: conversationContextV1Contract,
    viewerRole: conversationParticipantRoleV1Contract,
    createdAt: timestampV1Contract,
    updatedAt: timestampV1Contract,
  })
  .strict();

export const conversationThreadPageV1Contract = z
  .object({
    version: z.literal(1),
    items: z.array(conversationThreadV1Contract).max(50),
    nextCursor: conversationCursorContract.optional(),
  })
  .strict();

export const conversationMessageContentV1Contract = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("TEXT"),
      text: z.string().trim().min(1).max(4_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("MEDIA"),
      mediaId: mediaIdContract,
      caption: z.string().trim().min(1).max(1_000).optional(),
    })
    .strict(),
]);

export const sendConversationMessageInputV1Contract = z
  .object({ content: conversationMessageContentV1Contract })
  .strict();

export const conversationMessageV1Contract = z
  .object({
    version: z.literal(1),
    messageId: conversationMessageIdContract,
    conversationId: conversationIdContract,
    senderRole: conversationParticipantRoleV1Contract,
    content: conversationMessageContentV1Contract,
    status: z.literal("SENT"),
    createdAt: timestampV1Contract,
  })
  .strict();

export const conversationMessagePageV1Contract = z
  .object({
    version: z.literal(1),
    items: z.array(conversationMessageV1Contract).max(50),
    nextCursor: conversationCursorContract.optional(),
  })
  .strict();

const conversationErrorBaseV1 = {
  version: z.literal(1),
  message: z.string().min(1),
  correlationId: z.uuid(),
};

const conversationErrorCodeV1Contract = z.enum([
  "UNAUTHENTICATED",
  "IDENTITY_INACTIVE",
  "FORBIDDEN_CONTEXT",
  "FORBIDDEN_CONVERSATION",
  "CONTEXT_NOT_FOUND",
  "CONTEXT_UNAVAILABLE",
  "CONVERSATION_NOT_FOUND",
  "INVALID_CURSOR",
  "CURSOR_EXPIRED",
  "IDEMPOTENCY_CONFLICT",
  "MESSAGE_REJECTED",
  "MEDIA_NOT_READY",
]);

export const conversationErrorV1Contract = z.discriminatedUnion("code", [
  z
    .object({ code: conversationErrorCodeV1Contract, ...conversationErrorBaseV1 })
    .strict(),
  z
    .object({
      code: z.literal("IDEMPOTENCY_IN_PROGRESS"),
      ...conversationErrorBaseV1,
      details: z.object({ retryAfterSeconds: z.int().positive() }).strict(),
    })
    .strict(),
]);

export const messageSentV1Contract = eventEnvelopeV1Contract.extend({
  eventType: z.literal("MessageSent.v1"),
  actor: eventActorV1Contract,
  payload: z
    .object({
      conversationId: conversationIdContract,
      messageId: conversationMessageIdContract,
      contextKind: z.enum(["STORE", "PRODUCT", "ORDER"]),
      senderRole: conversationParticipantRoleV1Contract,
    })
    .strict(),
});

export const conversationsV1Schemas = {
  ConversationId: conversationIdContract,
  ConversationMessageId: conversationMessageIdContract,
  ConversationCursor: conversationCursorContract,
  ConversationLimit: conversationLimitContract,
  ConversationIdempotencyKey: conversationIdempotencyKeyContract,
  ConversationContextV1: conversationContextV1Contract,
  ConversationContextEligibilityV1: conversationContextEligibilityV1Contract,
  OpenConversationInputV1: openConversationInputV1Contract,
  ConversationThreadV1: conversationThreadV1Contract,
  ConversationThreadPageV1: conversationThreadPageV1Contract,
  ConversationMessageContentV1: conversationMessageContentV1Contract,
  SendConversationMessageInputV1: sendConversationMessageInputV1Contract,
  ConversationMessageV1: conversationMessageV1Contract,
  ConversationMessagePageV1: conversationMessagePageV1Contract,
  ConversationErrorV1: conversationErrorV1Contract,
  MessageSentV1: messageSentV1Contract,
} as const;

export function createConversationsV1JsonSchemas() {
  return createJsonSchemaMap(conversationsV1Schemas);
}

export const conversationsV1Examples = {
  ConversationId: "7a30197b-85fb-4209-83e8-743ab3bea71c",
  ConversationMessageId: "2c532e73-a701-41b0-98c4-9cad6f8d62dc",
  ConversationCursor: "eyJ0aHJlYWRJZCI6IjdhMzAxOTdiIn0.signature",
  ConversationLimit: 30,
  ConversationIdempotencyKey: "send-message-01",
  ConversationContextV1: {
    kind: "PRODUCT",
    storeId: "15f16eaf-1e01-4e40-b0e6-b8ce19268893",
    productId: "0d113616-5ad8-45d2-a126-b5b3412b3dd7",
  },
  ConversationContextEligibilityV1: {
    status: "ELIGIBLE",
    context: {
      kind: "PRODUCT",
      storeId: "15f16eaf-1e01-4e40-b0e6-b8ce19268893",
      productId: "0d113616-5ad8-45d2-a126-b5b3412b3dd7",
    },
    buyerIdentityId: "42a69843-f87c-4788-8a86-6345c56e5df7",
    sellerIdentityId: "7b99e256-756f-4144-9280-8d388c3c27ac",
  },
  OpenConversationInputV1: {
    context: {
      kind: "PRODUCT",
      storeId: "15f16eaf-1e01-4e40-b0e6-b8ce19268893",
      productId: "0d113616-5ad8-45d2-a126-b5b3412b3dd7",
    },
  },
  ConversationThreadV1: {
    version: 1,
    conversationId: "7a30197b-85fb-4209-83e8-743ab3bea71c",
    context: {
      kind: "PRODUCT",
      storeId: "15f16eaf-1e01-4e40-b0e6-b8ce19268893",
      productId: "0d113616-5ad8-45d2-a126-b5b3412b3dd7",
    },
    viewerRole: "BUYER",
    createdAt: "2026-08-27T09:00:00.000Z",
    updatedAt: "2026-08-27T09:00:00.000Z",
  },
  ConversationThreadPageV1: {
    version: 1,
    items: [],
  },
  ConversationMessageContentV1: {
    type: "TEXT",
    text: "سلام، این کالا هنوز موجود است؟",
  },
  SendConversationMessageInputV1: {
    content: { type: "TEXT", text: "سلام، این کالا هنوز موجود است؟" },
  },
  ConversationMessageV1: {
    version: 1,
    messageId: "2c532e73-a701-41b0-98c4-9cad6f8d62dc",
    conversationId: "7a30197b-85fb-4209-83e8-743ab3bea71c",
    senderRole: "BUYER",
    content: { type: "TEXT", text: "سلام، این کالا هنوز موجود است؟" },
    status: "SENT",
    createdAt: "2026-08-27T09:00:00.000Z",
  },
  ConversationMessagePageV1: {
    version: 1,
    items: [],
  },
  ConversationErrorV1: {
    version: 1,
    code: "FORBIDDEN_CONVERSATION",
    message: "به این گفت‌وگو دسترسی ندارید.",
    correlationId: "17de9c74-f6e1-4bda-843d-9ecf95918c3e",
  },
  MessageSentV1: {
    version: 1,
    eventId: "290376c4-e2cd-4fe6-a71a-f0b12eab9015",
    eventType: "MessageSent.v1",
    aggregateId: "7a30197b-85fb-4209-83e8-743ab3bea71c",
    aggregateVersion: 1,
    occurredAt: "2026-08-27T09:00:00.000Z",
    correlationId: "17de9c74-f6e1-4bda-843d-9ecf95918c3e",
    actor: {
      type: "IDENTITY",
      id: "42a69843-f87c-4788-8a86-6345c56e5df7",
    },
    payload: {
      conversationId: "7a30197b-85fb-4209-83e8-743ab3bea71c",
      messageId: "2c532e73-a701-41b0-98c4-9cad6f8d62dc",
      contextKind: "PRODUCT",
      senderRole: "BUYER",
    },
  },
} as const;

export type ConversationContextV1 = z.infer<typeof conversationContextV1Contract>;
export type ConversationContextEligibilityV1 = z.infer<
  typeof conversationContextEligibilityV1Contract
>;
export type OpenConversationInputV1 = z.infer<typeof openConversationInputV1Contract>;
export type ConversationThreadV1 = z.infer<typeof conversationThreadV1Contract>;
export type ConversationMessageContentV1 = z.infer<
  typeof conversationMessageContentV1Contract
>;
export type SendConversationMessageInputV1 = z.infer<
  typeof sendConversationMessageInputV1Contract
>;
export type ConversationMessageV1 = z.infer<typeof conversationMessageV1Contract>;
export type ConversationErrorV1 = z.infer<typeof conversationErrorV1Contract>;
export type MessageSentV1 = z.infer<typeof messageSentV1Contract>;
