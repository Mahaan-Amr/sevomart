import { afterEach, describe, expect, it } from "vitest";

import { createApiApp } from "../../apps/api/src/create-app";
import { apiTestEnvironment } from "../helpers/api-test-environment";

describe("conversations v1 OpenAPI contract", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => close?.());

  it("publishes one authenticated thread API for buyer and seller consumers", async () => {
    const app = await createApiApp(apiTestEnvironment);
    close = () => app.close();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/openapi.json",
    });
    const document = response.json();

    const collection = document.paths["/v1/conversations"];
    expect(collection.get.operationId).toBe("listConversations");
    expect(collection.post.operationId).toBe("openConversation");
    expect(collection.get.security).toEqual([{ identitySession: [] }]);
    expect(collection.post.security).toEqual([{ identitySession: [] }]);
    expect(collection.get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "cursor", in: "query", required: false }),
        expect.objectContaining({ name: "limit", in: "query", required: false }),
      ]),
    );
    expect(collection.post.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/OpenConversationInputV1",
    );
    expect(collection.post.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Idempotency-Key",
          in: "header",
          required: true,
        }),
      ]),
    );
    expect(collection.post.responses["409"].headers).toHaveProperty("Retry-After");

    const needsReply = document.paths["/v1/conversations/needs-reply"].get;
    expect(needsReply.operationId).toBe("readConversationNeedsReply");
    expect(needsReply.security).toEqual([{ identitySession: [] }]);
    expect(needsReply.responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/ConversationNeedsReplyV1",
    );

    const thread = document.paths["/v1/conversations/{conversationId}"].get;
    expect(thread.operationId).toBe("readConversation");
    expect(thread.security).toEqual([{ identitySession: [] }]);
    expect(thread.responses).toHaveProperty("403");
    expect(thread.responses).toHaveProperty("404");

    const messages = document.paths["/v1/conversations/{conversationId}/messages"];
    expect(messages.get.operationId).toBe("listConversationMessages");
    expect(messages.post.operationId).toBe("sendConversationMessage");
    for (const operation of [messages.get, messages.post]) {
      expect(operation.security).toEqual([{ identitySession: [] }]);
      expect(operation.responses).toHaveProperty("403");
      expect(operation.responses).toHaveProperty("404");
    }
    expect(messages.post.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Idempotency-Key",
          in: "header",
          required: true,
        }),
      ]),
    );
    expect(messages.post.responses["409"].headers).toHaveProperty("Retry-After");

    expect(document.components.schemas).toMatchObject({
      ConversationContextEligibilityV1: expect.any(Object),
      ConversationThreadV1: expect.any(Object),
      ConversationNeedsReplyV1: expect.any(Object),
      ConversationMessageV1: expect.any(Object),
      ConversationOutgoingMessageV1: expect.any(Object),
      ConversationErrorV1: expect.any(Object),
      MessageSentV1: expect.any(Object),
    });
  });
});
