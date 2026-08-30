import {
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import { eventCorrelationId } from "../../event-correlation-id";
import { readIdentitySessionToken } from "../../http/identity-session";
import { ContentService } from "./application/content.service";
import { CONTENT_SERVICE, ContentFault } from "./public";

@ApiExcludeController()
@Controller("v1")
export class ContentController {
  constructor(@Inject(CONTENT_SERVICE) private readonly content: ContentService) {}

  @Post("seller/sales-content")
  @HttpCode(HttpStatus.CREATED)
  publishSalesContent(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.respond(request, () =>
      this.content.publishSalesContent(this.context(request), request.body, key),
    );
  }

  @Post("purchase-experiences")
  @HttpCode(HttpStatus.CREATED)
  publishPurchaseExperience(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.respond(request, () =>
      this.content.publishPurchaseExperience(this.context(request), request.body, key),
    );
  }

  private context(request: FastifyRequest) {
    request.id = eventCorrelationId(request.id);
    return {
      sessionToken: readIdentitySessionToken(request),
      correlationId: request.id,
    };
  }

  private async respond(request: FastifyRequest, operation: () => Promise<unknown>) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ContentFault)) throw error;
      if (error.code === "UNAUTHENTICATED") {
        throw new HttpException(
          {
            code: "UNAUTHORIZED",
            message: "برای ادامه دوباره وارد شوید.",
            correlationId: request.id,
          },
          HttpStatus.UNAUTHORIZED,
        );
      }
      const status =
        error.code === "FORBIDDEN"
          ? HttpStatus.FORBIDDEN
          : error.code === "IDEMPOTENCY_CONFLICT" ||
              error.code === "IDEMPOTENCY_IN_PROGRESS" ||
              error.code === "ALREADY_SUBMITTED"
            ? HttpStatus.CONFLICT
            : error.code === "PRECONDITION_REQUIRED"
              ? HttpStatus.PRECONDITION_REQUIRED
              : HttpStatus.UNPROCESSABLE_ENTITY;
      throw contentHttpError(request.id, error.code, status);
    }
  }
}

function contentHttpError(correlationId: string, code: string, status: number) {
  const messages: Record<string, string> = {
    NO_ACTIVE_PRODUCT: "حداقل یک کالای فعال از همین فروشگاه انتخاب کنید.",
    FORBIDDEN: "اجازه انتشار در این زمینه را ندارید.",
    NOT_ELIGIBLE: "این خرید هنوز شرایط ثبت تجربه را ندارد.",
    ALREADY_SUBMITTED: "برای این خرید قبلاً تجربه ثبت شده است.",
    IDEMPOTENCY_CONFLICT: "این شناسه درخواست قبلاً با اطلاعات دیگری استفاده شده است.",
    IDEMPOTENCY_IN_PROGRESS: "درخواست مشابه هنوز در حال انجام است.",
    PRECONDITION_REQUIRED: "شناسه یکتای درخواست را ارسال کنید.",
  };
  return new HttpException(
    { code, message: messages[code] ?? messages.NOT_ELIGIBLE, correlationId },
    status,
  );
}
