import {
  Controller,
  Get,
  Post,
  Req,
  Param,
  HttpCode,
  Header,
  Inject,
  HttpException,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { eventCorrelationId } from "../../event-correlation-id";
import { readIdentitySessionToken } from "../../http/identity-session";
import { CONVERSATION_SERVICE, ConversationFault } from "./public";
import { ConversationService } from "./application/conversation.service";

@ApiExcludeController()
@Controller("v1/conversations")
export class ConversationController {
  constructor(
    @Inject(CONVERSATION_SERVICE) private readonly service: ConversationService,
  ) {}
  @Header("Cache-Control", "private, no-store")
  @Post()
  @HttpCode(200)
  open(@Req() request: FastifyRequest) {
    return this.respond(request, () =>
      this.service.open(
        this.context(request),
        request.body,
        request.headers["idempotency-key"],
      ),
    );
  }
  @Header("Cache-Control", "private, no-store")
  @Post(":conversationId/messages")
  @HttpCode(201)
  send(@Req() request: FastifyRequest, @Param("conversationId") id: string) {
    return this.respond(request, () =>
      this.service.send(
        this.context(request),
        id,
        request.body,
        request.headers["idempotency-key"],
      ),
    );
  }
  @Header("Cache-Control", "private, no-store")
  @Get()
  list(@Req() request: FastifyRequest) {
    return this.respond(request, () =>
      this.service.list(
        this.context(request),
        request.query as { cursor?: unknown; limit?: unknown },
      ),
    );
  }
  @Header("Cache-Control", "private, no-store")
  @Get("needs-reply")
  needsReply(@Req() request: FastifyRequest) {
    return this.respond(request, () =>
      this.service.readNeedsReply(this.context(request)),
    );
  }
  @Header("Cache-Control", "private, no-store")
  @Get(":conversationId/messages")
  messages(@Req() request: FastifyRequest, @Param("conversationId") id: string) {
    return this.respond(request, () =>
      this.service.list(
        this.context(request),
        request.query as { cursor?: unknown; limit?: unknown },
        id,
      ),
    );
  }
  @Header("Cache-Control", "private, no-store")
  @Get(":conversationId")
  read(@Req() request: FastifyRequest, @Param("conversationId") id: string) {
    return this.respond(request, () => this.service.read(this.context(request), id));
  }
  private context(request: FastifyRequest) {
    return {
      sessionToken: readIdentitySessionToken(request),
      correlationId: eventCorrelationId(request.id),
    };
  }
  private async respond(request: FastifyRequest, operation: () => Promise<unknown>) {
    request.id = eventCorrelationId(request.id);
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ConversationFault)) throw error;
      await this.service.recordFailure(this.context(request), error.code);
      const status =
        error.code === "UNAUTHENTICATED"
          ? 401
          : error.code === "CONVERSATION_NOT_FOUND" ||
              error.code === "CONTEXT_NOT_FOUND"
            ? 404
            : error.code === "CONTEXT_UNAVAILABLE" ||
                error.code.startsWith("IDEMPOTENCY_")
              ? 409
              : error.code === "INVALID_CURSOR"
                ? 400
                : error.code === "CURSOR_EXPIRED"
                  ? 410
                  : error.code === "MESSAGE_REJECTED" ||
                      error.code === "MEDIA_NOT_READY"
                    ? 422
                    : 403;
      throw new HttpException(
        {
          version: 1,
          code: error.code,
          message:
            "درخواست انجام نشد؛ دسترسی و اطلاعات را بررسی کنید و دوباره تلاش کنید.",
          correlationId: eventCorrelationId(request.id),
          ...(error.code === "IDEMPOTENCY_IN_PROGRESS"
            ? { details: { retryAfterSeconds: 1 } }
            : {}),
        },
        status,
      );
    }
  }
}
