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
import sharp from "sharp";

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
      throw invalidMedia(request.id);
    }
    let bytes: Buffer;
    try {
      bytes = decodeBase64(parsed.data.contentBase64);
      const image = sharp(bytes, {
        failOn: "warning",
        limitInputPixels: 16_000_000,
      });
      const metadata = await image.metadata();
      if (metadata.format !== formatFor(parsed.data.contentType)) {
        throw new Error("Media type does not match its bytes");
      }
      await image.clone().raw().toBuffer();
    } catch {
      throw invalidMedia(request.id);
    }
    const id = mediaIdContract.parse(crypto.randomUUID());
    await this.storage.put({
      key: id,
      contentType: parsed.data.contentType,
      bytes,
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

function decodeBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid Base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0) throw new Error("Empty media");
  return bytes;
}

function formatFor(contentType: "image/jpeg" | "image/png" | "image/webp") {
  return contentType.slice("image/".length);
}

function invalidMedia(correlationId: string) {
  return new HttpException(
    {
      code: "VALIDATION_ERROR",
      message: "تصویر انتخاب‌شده معتبر نیست.",
      correlationId,
      details: { issues: [{ field: "media", code: "INVALID_FORMAT" }] },
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}
