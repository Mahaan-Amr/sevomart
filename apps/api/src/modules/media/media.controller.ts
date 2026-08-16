import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  SELLER_SESSION_READER,
  type SellerSessionReader,
} from "../identity-access/public";
import {
  mediaIdContract,
  mediaUploadInputContract,
  type MediaReference,
} from "@sevo/contracts/media/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { requireSeller } from "../../http/seller-session";
import { MEDIA_STORAGE, type MediaStorage } from "./public";

@ApiExcludeController()
@Controller("v1")
export class MediaController {
  constructor(
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(SELLER_SESSION_READER)
    private readonly sessions: SellerSessionReader,
  ) {}

  @Post("seller/media")
  async upload(@Body() body: unknown, @Req() request: FastifyRequest) {
    const sellerId = await requireSeller(request, this.sessions);
    const parsed = mediaUploadInputContract.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(
        {
          code: "VALIDATION_ERROR",
          message: "تصویر انتخاب‌شده معتبر نیست.",
          correlationId: request.id,
          details: { issues: [{ field: "media", code: "INVALID_FORMAT" }] },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const id = mediaIdContract.parse(crypto.randomUUID());
    await this.storage.put({
      key: id,
      contentType: parsed.data.contentType,
      bytes: Buffer.from(parsed.data.contentBase64, "base64"),
      ownerSellerId: sellerId,
      visibility: "PRIVATE",
    });
    return {
      id,
      contentType: parsed.data.contentType,
      url: `/v1/media/${id}`,
    } satisfies MediaReference;
  }

  @Get("media/:mediaId")
  async read(
    @Param("mediaId") value: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const parsed = mediaIdContract.safeParse(value);
    const media = parsed.success ? await this.storage.get(parsed.data) : undefined;
    if (!media) {
      throw new HttpException(
        {
          code: "MEDIA_NOT_FOUND",
          message: "رسانه پیدا نشد.",
          correlationId: request.id,
        },
        HttpStatus.NOT_FOUND,
      );
    }
    if (media.visibility === "PRIVATE") {
      const sellerId = await requireSeller(request, this.sessions);
      if (media.ownerSellerId !== sellerId) {
        throw new HttpException(
          {
            code: "MEDIA_NOT_FOUND",
            message: "رسانه پیدا نشد.",
            correlationId: request.id,
          },
          HttpStatus.NOT_FOUND,
        );
      }
    }
    return reply.type(media.contentType).send(Buffer.from(media.bytes));
  }
}
