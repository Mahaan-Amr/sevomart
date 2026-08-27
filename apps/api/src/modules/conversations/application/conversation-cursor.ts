import { createHmac, timingSafeEqual } from "node:crypto";
import { conversationIdContract } from "@sevo/contracts/conversations/v1";
import { ConversationFault } from "../public";

export type ConversationCursor = {
  snapshotId: string;
  operation: "THREADS" | "MESSAGES";
  conversationId?: string;
  lastAt: string;
  lastId: string;
  expiresAt: string;
};
export class ConversationCursorCodec {
  private readonly key: Buffer;
  constructor(secret: string) {
    this.key = createHmac("sha256", secret)
      .update("sevo.conversations.cursor.v1")
      .digest();
  }
  encode(identityId: string, cursor: ConversationCursor) {
    const body = Buffer.from(JSON.stringify(cursor)).toString("base64url");
    return `${body}.${this.sign(identityId, body).toString("base64url")}`;
  }
  decode(
    identityId: string,
    token: string,
    operation: ConversationCursor["operation"],
    conversationId?: string,
  ): ConversationCursor {
    try {
      if (token.length > 2048) throw new Error();
      const [body, signature, extra] = token.split(".");
      if (!body || !signature || extra !== undefined) throw new Error();
      const expected = this.sign(identityId, body),
        supplied = Buffer.from(signature, "base64url");
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected) ||
        supplied.toString("base64url") !== signature
      )
        throw new Error();
      const value = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      ) as ConversationCursor;
      if (
        value.operation !== operation ||
        value.conversationId !== conversationId ||
        !conversationIdContract.safeParse(value.snapshotId).success ||
        !conversationIdContract.safeParse(value.lastId).success ||
        !Number.isFinite(Date.parse(value.lastAt)) ||
        !Number.isFinite(Date.parse(value.expiresAt))
      )
        throw new Error();
      if (Date.parse(value.expiresAt) <= Date.now())
        throw new ConversationFault("CURSOR_EXPIRED");
      return value;
    } catch (error) {
      if (error instanceof ConversationFault) throw error;
      throw new ConversationFault("INVALID_CURSOR");
    }
  }
  private sign(identityId: string, body: string) {
    return createHmac("sha256", this.key).update(`${identityId}:${body}`).digest();
  }
}
