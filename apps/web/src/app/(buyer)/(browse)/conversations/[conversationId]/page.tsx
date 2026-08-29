import { ConversationThread } from "./conversation-thread";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <ConversationThread conversationId={conversationId} />;
}
