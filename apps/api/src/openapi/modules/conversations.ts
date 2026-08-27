import {
  conversationsV1Examples,
  conversationsV1Operations,
  createConversationsV1JsonSchemas,
} from "@sevo/contracts/conversations/v1";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const paginationParameters = [
  {
    name: "cursor",
    schema: "ConversationCursor",
    example: conversationsV1Examples.ConversationCursor,
    required: false,
  },
  {
    name: "limit",
    schema: "ConversationLimit",
    example: conversationsV1Examples.ConversationLimit,
    required: false,
  },
] as const;

const conversationIdParameter = {
  name: "conversationId",
  schema: "ConversationId",
  example: conversationsV1Examples.ConversationId,
} as const;

const idempotencyHeaderParameters = [
  {
    name: "Idempotency-Key",
    schema: "ConversationIdempotencyKey",
    example: conversationsV1Examples.ConversationIdempotencyKey,
    required: true,
  },
] as const;

const operations = [
  {
    ...conversationsV1Operations.listConversations,
    tag: "conversations",
    auth: "identity-session",
    queryParameters: paginationParameters,
    responses: [
      { status: 200, schema: "ConversationThreadPageV1" },
      { status: 400, schema: "ConversationErrorV1" },
      { status: 401, schema: "ConversationErrorV1" },
      { status: 403, schema: "ConversationErrorV1" },
      { status: 410, schema: "ConversationErrorV1" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...conversationsV1Operations.openConversation,
    tag: "conversations",
    auth: "identity-session",
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "OpenConversationInputV1",
      example: conversationsV1Examples.OpenConversationInputV1,
    },
    responses: [
      { status: 200, schema: "ConversationThreadV1" },
      { status: 401, schema: "ConversationErrorV1" },
      { status: 403, schema: "ConversationErrorV1" },
      { status: 404, schema: "ConversationErrorV1" },
      {
        status: 409,
        schema: "ConversationErrorV1",
        headers: {
          "Retry-After": {
            description: "Seconds before retrying an in-progress idempotent open",
            schema: { type: "string" },
          },
        },
      },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...conversationsV1Operations.readConversation,
    tag: "conversations",
    auth: "identity-session",
    pathParameter: conversationIdParameter,
    responses: [
      { status: 200, schema: "ConversationThreadV1" },
      { status: 401, schema: "ConversationErrorV1" },
      { status: 403, schema: "ConversationErrorV1" },
      { status: 404, schema: "ConversationErrorV1" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...conversationsV1Operations.listConversationMessages,
    tag: "conversations",
    auth: "identity-session",
    pathParameter: conversationIdParameter,
    queryParameters: paginationParameters,
    responses: [
      { status: 200, schema: "ConversationMessagePageV1" },
      { status: 400, schema: "ConversationErrorV1" },
      { status: 401, schema: "ConversationErrorV1" },
      { status: 403, schema: "ConversationErrorV1" },
      { status: 404, schema: "ConversationErrorV1" },
      { status: 410, schema: "ConversationErrorV1" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
  {
    ...conversationsV1Operations.sendConversationMessage,
    tag: "conversations",
    auth: "identity-session",
    pathParameter: conversationIdParameter,
    headerParameters: idempotencyHeaderParameters,
    request: {
      schema: "SendConversationMessageInputV1",
      example: conversationsV1Examples.SendConversationMessageInputV1,
    },
    responses: [
      { status: 201, schema: "ConversationMessageV1" },
      { status: 401, schema: "ConversationErrorV1" },
      { status: 403, schema: "ConversationErrorV1" },
      { status: 404, schema: "ConversationErrorV1" },
      {
        status: 409,
        schema: "ConversationErrorV1",
        headers: {
          "Retry-After": {
            description: "Seconds before retrying an in-progress idempotent send",
            schema: { type: "string" },
          },
        },
      },
      { status: 422, schema: "ConversationErrorV1" },
      { status: 500, schema: "InternalServerError" },
    ],
  },
] as const satisfies readonly ApiOperationContract[];

const responseMetadata = {
  descriptions: {
    200: "Conversation resource returned",
    201: "Message accepted once and stored",
    400: "Conversation cursor is invalid",
    401: "Identity session is missing or invalid",
    403: "Identity cannot access this context or conversation",
    404: "Conversation context or resource was not found",
    409: "Context, cursor, or idempotent mutation conflicts with current state",
    410: "Conversation cursor has expired",
    422: "Message content or media was rejected",
    500: "Unexpected server error",
  },
};

export const contribute_conversations_openApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(
    document,
    createConversationsV1JsonSchemas(),
    conversationsV1Examples,
    operations,
    responseMetadata,
  );
