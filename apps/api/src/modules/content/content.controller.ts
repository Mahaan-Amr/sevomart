import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import { eventCorrelationId } from "../../event-correlation-id";
import { readIdentitySessionToken } from "../../http/identity-session";
import { ContentService } from "./application/content.service";
import { CONTENT_SERVICE, ContentFault } from "./public";

@ApiExcludeController()
@Controller()
export class ContentController {
  constructor(@Inject(CONTENT_SERVICE) private readonly content: ContentService) {}

  @Post("v2/seller/sales-content")
  @HttpCode(HttpStatus.CREATED)
  publishSalesContentV2(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.respond(request, () =>
      this.content.publishSalesContent(this.context(request), request.body, key),
    );
  }

  @Get("v2/seller/sales-content")
  listSellerSalesContentV2(@Req() request: FastifyRequest) {
    return this.respond(request, () =>
      this.content.listSellerSalesContent(this.context(request)),
    );
  }

  @Get("v2/seller/sales-content/:contentId")
  readSellerSalesContentV2(
    @Req() request: FastifyRequest,
    @Param("contentId") contentId: string,
  ) {
    return this.respond(request, () =>
      this.content.readSellerSalesContent(this.context(request), contentId),
    );
  }

  @Put("v2/seller/sales-content/:contentId")
  replaceSellerSalesContentV2(
    @Req() request: FastifyRequest,
    @Param("contentId") contentId: string,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.respond(request, () =>
      this.content.replaceSellerSalesContent(
        this.context(request),
        contentId,
        request.body,
        key,
      ),
    );
  }

  @Post("v2/purchase-experiences")
  @HttpCode(HttpStatus.CREATED)
  publishPurchaseExperienceV2(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.respond(request, () =>
      this.content.publishPurchaseExperience(this.context(request), request.body, key),
    );
  }

  @Get("v2/purchase-experiences/eligibility/:orderItemId")
  readPurchaseExperienceEligibilityV2(
    @Req() request: FastifyRequest,
    @Param("orderItemId") orderItemId: string,
  ) {
    return this.respond(request, () =>
      this.content.readPurchaseExperienceEligibility(
        this.context(request),
        orderItemId,
      ),
    );
  }

  @Post("v2/purchase-experiences/media-contexts")
  @HttpCode(HttpStatus.CREATED)
  createPurchaseExperienceMediaContextV2(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.respond(request, () =>
      this.content.createPurchaseExperienceMediaContext(
        this.context(request),
        request.body,
        key,
      ),
    );
  }

  @Get("v2/products/:productId/purchase-experiences")
  readProductPurchaseExperiencesV2(
    @Req() request: FastifyRequest,
    @Param("productId") productId: string,
  ) {
    return this.respond(request, () =>
      this.content.readProductPurchaseExperiences(productId),
    );
  }

  @Get("v2/sales-content")
  readPublicSalesContentV2(
    @Req() request: FastifyRequest,
    @Query("storeIds") storeIds: string | undefined,
  ) {
    return this.respond(request, () => this.content.readPublicSalesContent(storeIds));
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
          : error.code === "CONTENT_NOT_FOUND"
            ? HttpStatus.NOT_FOUND
            : error.code === "REVISION_CONFLICT" ||
                error.code === "IDEMPOTENCY_CONFLICT" ||
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
    INVALID_QUERY: "شناسه فروشگاه‌ها را درست وارد کنید و دوباره تلاش کنید.",
    NOT_ELIGIBLE: "این خرید هنوز شرایط ثبت تجربه را ندارد.",
    ALREADY_SUBMITTED: "برای این خرید قبلاً تجربه ثبت شده است.",
    IDEMPOTENCY_CONFLICT: "این شناسه درخواست قبلاً با اطلاعات دیگری استفاده شده است.",
    IDEMPOTENCY_IN_PROGRESS: "درخواست مشابه هنوز در حال انجام است.",
    PRECONDITION_REQUIRED: "شناسه یکتای درخواست را ارسال کنید.",
    CONTENT_NOT_FOUND: "این محتوای فروش پیدا نشد.",
    REVISION_CONFLICT: "محتوا جای دیگری تغییر کرده است. نسخه تازه را باز کنید.",
  };
  return new HttpException(
    { code, message: messages[code] ?? messages.NOT_ELIGIBLE, correlationId },
    status,
  );
}
