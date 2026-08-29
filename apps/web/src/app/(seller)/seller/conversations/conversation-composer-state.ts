import type {
  ConversationMessageContentV1,
  ConversationMessageV1,
} from "@sevo/contracts/conversations/v1";

export type OptimisticConversationMessage = {
  clientId: string;
  conversationId: string;
  idempotencyKey: string;
  content: ConversationMessageContentV1;
  status: "SENDING" | "UNSENT";
  error?: string;
};

export type VisibleConversationMessage =
  ConversationMessageV1 | OptimisticConversationMessage;

export function startOutgoingMessage(input: {
  clientId: string;
  conversationId: string;
  idempotencyKey: string;
  content: ConversationMessageContentV1;
}): OptimisticConversationMessage {
  return { ...input, status: "SENDING" };
}

export function failOutgoingMessage(
  message: OptimisticConversationMessage,
  error: string,
): OptimisticConversationMessage {
  return { ...message, status: "UNSENT", error };
}

export function retryOutgoingMessage(
  message: OptimisticConversationMessage,
): OptimisticConversationMessage {
  return { ...message, status: "SENDING", error: undefined };
}

export function settleOutgoingMessage(
  messages: VisibleConversationMessage[],
  clientId: string,
  sent: ConversationMessageV1,
): VisibleConversationMessage[] {
  const withoutOptimisticOrReplay = messages.filter(
    (message) =>
      (!("clientId" in message) || message.clientId !== clientId) &&
      !("messageId" in message && message.messageId === sent.messageId),
  );
  return [...withoutOptimisticOrReplay, sent];
}
