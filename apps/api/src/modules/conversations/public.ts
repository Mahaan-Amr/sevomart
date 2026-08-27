import type {
  ConversationMessageV1,
  ConversationMessageContentV1,
  ConversationContextV1,
  ConversationErrorV1,
  ConversationThreadV1,
} from "@sevo/contracts/conversations/v1";
export const CONVERSATION_SERVICE = Symbol("CONVERSATION_SERVICE");
export type ConversationRequest = { sessionToken?: string; correlationId: string };
export class ConversationFault extends Error {
  constructor(readonly code: ConversationErrorV1["code"]) {
    super(code);
  }
}
export type StoredConversation = {
  conversationId: string;
  buyerIdentityId: string;
  sellerIdentityId: string;
  context: ConversationContextV1;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};
export type ConversationMutation = {
  identityId: string;
  key: string;
  requestHash: string;
  correlationId: string;
};
export type ConversationSnapshot = {
  snapshotId: string;
  identityId: string;
  operation: "THREADS" | "MESSAGES";
  conversationId?: string;
  expiresAt: Date;
};
export type ConversationSnapshotEntry = { itemId: string; sortAt: Date };
export interface ConversationRepository {
  hasAttachment(conversationId: string, mediaId: string): Promise<boolean>;
  snapshot(
    identityId: string,
    operation: "THREADS" | "MESSAGES",
    conversationId?: string,
  ): Promise<ConversationSnapshot>;
  readSnapshot(snapshotId: string): Promise<ConversationSnapshot | undefined>;
  entries(
    snapshotId: string,
    limit: number,
    after?: { lastAt: string; lastId: string },
  ): Promise<ConversationSnapshotEntry[]>;
  readMessage(
    conversationId: string,
    messageId: string,
  ): Promise<ConversationMessageV1 | undefined>;
  audit(
    identityId: string | undefined,
    operation: string,
    outcome: string,
    correlationId: string,
    conversationId?: string,
  ): Promise<void>;
  send(
    command: ConversationMutation & {
      conversationId: string;
      content: ConversationMessageContentV1;
    },
    authorize: (thread: StoredConversation) => Promise<"BUYER" | "SELLER">,
    validateContent: () => Promise<void>,
  ): Promise<ConversationMessageV1>;
  read(conversationId: string): Promise<StoredConversation | undefined>;
  open(
    command: ConversationMutation & {
      context: ConversationContextV1;
    },
    resolveSeller: (existing?: StoredConversation) => Promise<string>,
  ): Promise<ConversationThreadV1>;
}
