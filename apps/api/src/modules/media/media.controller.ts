import { createHash, randomUUID } from "node:crypto";

import {
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
  conversationMediaContextIdContract,
  MEDIA_UPLOAD_ACCEPTED_TYPES,
  MEDIA_UPLOAD_MAX_BYTES,
  MEDIA_UPLOAD_MAX_PIXELS,
  mediaIdContract,
  mediaUploadPurposeContract,
  type MediaReference,
} from "@sevo/contracts/media/v1";
import { productIdContract } from "@sevo/contracts/platform/v1";
import type { FastifyReply, FastifyRequest } from "fastify";
import sharp from "sharp";

import { requireIdentity } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
} from "../identity-access/public";
import {
  CONVERSATION_MEDIA_ACCESS,
  type ConversationMediaAccess,
  type StoredMediaPurpose,
  MEDIA_STORAGE,
  PUBLISHED_MEDIA_ACCESS,
  SELLER_UPLOAD_RATE_LIMITER,
  type MediaStorage,
  type PublishedMediaAccess,
  type StoredMediaVariant,
} from "./public";
import { SellerUploadRateLimiter } from "./seller-upload-rate-limiter";

type AcceptedContentType = (typeof MEDIA_UPLOAD_ACCEPTED_TYPES)[number];
type MediaIssueCode =
  | "REQUIRED"
  | "FILE_TOO_LARGE"
  | "IMAGE_TOO_LARGE"
  | "CORRUPT_IMAGE"
  | "UNSUPPORTED_FORMAT"
  | "ANIMATED_IMAGE"
  | "MIME_MISMATCH"
  | "RATE_LIMITED";

@ApiExcludeController()
@Controller("v1")
export class MediaController {
  constructor(
    @Inject(CONVERSATION_MEDIA_ACCESS)
    private readonly conversationAccess: ConversationMediaAccess,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
    @Inject(PUBLISHED_MEDIA_ACCESS)
    private readonly isPublishedMedia: PublishedMediaAccess,
    @Inject(SELLER_UPLOAD_RATE_LIMITER)
    private readonly uploadRateLimiter: SellerUploadRateLimiter,
  ) {}

  @Post("seller/media")
  async upload(@Req() request: FastifyRequest) {
    return this.uploadOwnedMedia(request);
  }

  @Post("seller/products/:productId/images")
  async uploadProductImage(
    @Param("productId") rawProductId: string,
    @Req() request: FastifyRequest,
  ) {
    const productId = productIdContract.safeParse(rawProductId);
    if (!productId.success) throw mediaNotFound(request.id);
    return this.uploadOwnedMedia(request, productId.data, "PRODUCT_IMAGE");
  }

  @Post("conversations/:conversationId/media")
  async uploadConversationAttachment(
    @Param("conversationId") value: string,
    @Req() request: FastifyRequest,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const parsed = conversationMediaContextIdContract.safeParse(value);
    if (
      !parsed.success ||
      !(await this.conversationAccess({ identityId, conversationId: parsed.data }))
    )
      throw mediaNotFound(request.id);
    return this.uploadOwnedMedia(request, parsed.data, "CONVERSATION_ATTACHMENT");
  }

  private async uploadOwnedMedia(
    request: FastifyRequest,
    ownerReferenceId?: string,
    fixedPurpose?: StoredMediaPurpose,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    if (!this.uploadRateLimiter.accept(identityId)) {
      throw mediaError(request.id, "RATE_LIMITED");
    }
    let purpose: StoredMediaPurpose | undefined = fixedPurpose;
    let fileName = "";
    let declaredContentType = "";
    let bytes: Buffer | undefined;
    try {
      for await (const part of request.parts()) {
        if (part.type === "field" && part.fieldname === "purpose") {
          const parsed = mediaUploadPurposeContract.safeParse(part.value);
          if (!parsed.success || (fixedPurpose && parsed.data !== fixedPurpose))
            throw mediaError(request.id, "REQUIRED");
          purpose = parsed.data;
        } else if (part.type === "file" && part.fieldname === "file") {
          fileName = part.filename;
          declaredContentType = part.mimetype;
          bytes = await part.toBuffer();
          if (part.file.truncated) throw mediaError(request.id, "FILE_TOO_LARGE");
        }
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isFileTooLargeError(error)) throw mediaError(request.id, "FILE_TOO_LARGE");
      throw mediaError(request.id, "CORRUPT_IMAGE");
    }
    if (!purpose || !bytes || !fileName) throw mediaError(request.id, "REQUIRED");
    if (bytes.byteLength > MEDIA_UPLOAD_MAX_BYTES) {
      throw mediaError(request.id, "FILE_TOO_LARGE");
    }
    if (
      !MEDIA_UPLOAD_ACCEPTED_TYPES.includes(declaredContentType as AcceptedContentType)
    ) {
      throw mediaError(request.id, "UNSUPPORTED_FORMAT");
    }
    const contentType = declaredContentType as AcceptedContentType;
    const inspected = await inspectImage(bytes, contentType, request.id);
    const id = mediaIdContract.parse(randomUUID());
    const variants = await createVariants(id, purpose, bytes);
    await this.storage.put({
      key: id,
      purpose,
      contentType,
      bytes,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      width: inspected.width,
      height: inspected.height,
      variants,
      ownerSellerId: identityId,
      ownerReferenceId,
      visibility: "PRIVATE",
    });
    return {
      id,
      contentType: "image/webp",
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
    const media = parsed.success ? await this.storage.inspect(parsed.data) : undefined;
    if (!media) throw mediaNotFound(request.id);
    const isAttachment = media.purpose === "CONVERSATION_ATTACHMENT";
    const publiclyReadable =
      !isAttachment &&
      media.visibility === "PUBLIC" &&
      (await this.isPublishedMedia(media.key));
    if (isAttachment) {
      const identityId = await requireIdentity(request, this.sessions);
      if (
        !media.ownerReferenceId ||
        !(await this.conversationAccess({
          identityId,
          conversationId: media.ownerReferenceId,
          ...(media.ownerSellerId === identityId ? {} : { mediaId: media.key }),
        }))
      )
        throw mediaNotFound(request.id);
    } else if (!publiclyReadable) {
      const identityId = await requireIdentity(request, this.sessions);
      if (media.ownerSellerId !== identityId) throw mediaNotFound(request.id);
    }
    const readable = await this.storage.get(media.key);
    if (!readable) throw mediaNotFound(request.id);
    if (!publiclyReadable) reply.header("cache-control", "private, no-store");
    return reply.type(readable.contentType).send(Buffer.from(readable.bytes));
  }
}

async function inspectImage(
  bytes: Buffer,
  declaredContentType: AcceptedContentType,
  correlationId: string,
) {
  try {
    const metadata = await sharp(bytes, {
      animated: true,
      failOn: "warning",
      limitInputPixels: false,
    }).metadata();
    if (!metadata.width || !metadata.height)
      throw mediaError(correlationId, "CORRUPT_IMAGE");
    if (metadata.width * metadata.height > MEDIA_UPLOAD_MAX_PIXELS) {
      throw mediaError(correlationId, "IMAGE_TOO_LARGE");
    }
    if ((metadata.pages ?? 1) > 1) throw mediaError(correlationId, "ANIMATED_IMAGE");
    if (metadata.format !== formatFor(declaredContentType)) {
      throw mediaError(correlationId, "MIME_MISMATCH");
    }
    await sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MEDIA_UPLOAD_MAX_PIXELS,
    })
      .raw()
      .toBuffer();
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw mediaError(correlationId, "CORRUPT_IMAGE");
  }
}

async function createVariants(
  id: string,
  purpose: StoredMediaPurpose,
  bytes: Buffer,
): Promise<StoredMediaVariant[]> {
  const definitions =
    purpose === "CONVERSATION_ATTACHMENT"
      ? ([["attachment-preview", 1600, 1600, false]] as const)
      : purpose === "STORE_LOGO"
        ? ([
            ["logo-small", 128, 128, true],
            ["logo-large", 512, 512, true],
          ] as const)
        : purpose === "STORE_COVER"
          ? ([
              ["cover-mobile", 960, undefined, false],
              ["cover-desktop", 1920, undefined, false],
            ] as const)
          : ([
              ["product-card", 640, 640, false],
              ["product-detail", 1600, 1600, false],
            ] as const);
  return Promise.all(
    definitions.map(async ([name, width, height, lossless]) => {
      const result = await sharp(bytes, { limitInputPixels: MEDIA_UPLOAD_MAX_PIXELS })
        .resize({ width, height, fit: "inside", withoutEnlargement: true })
        .webp(lossless ? { lossless: true } : { quality: 92 })
        .toBuffer({ resolveWithObject: true });
      return {
        key: `media/${id}/variants/${name}.webp`,
        name,
        contentType: "image/webp" as const,
        bytes: result.data,
        width: result.info.width,
        height: result.info.height,
      };
    }),
  );
}

function formatFor(contentType: AcceptedContentType) {
  return contentType === "image/jpeg" ? "jpeg" : contentType.slice("image/".length);
}

function isFileTooLargeError(error: unknown) {
  return (
    (error instanceof Error &&
      (error.name === "RequestFileTooLargeError" ||
        error.message.includes("File too large"))) ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "FST_REQ_FILE_TOO_LARGE")
  );
}

const issueMessages: Record<MediaIssueCode, string> = {
  REQUIRED: "فایل تصویر و کاربرد آن را انتخاب کنید.",
  FILE_TOO_LARGE: "حجم تصویر باید حداکثر ۱۰ مگابایت باشد.",
  IMAGE_TOO_LARGE: "ابعاد تصویر باید حداکثر ۲۴ مگاپیکسل باشد.",
  CORRUPT_IMAGE: "فایل تصویر خراب است یا کامل خوانده نمی‌شود.",
  UNSUPPORTED_FORMAT: "فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود.",
  ANIMATED_IMAGE: "تصویر متحرک پذیرفته نمی‌شود.",
  MIME_MISMATCH: "نوع فایل با محتوای واقعی تصویر هماهنگ نیست.",
  RATE_LIMITED: "تعداد بارگذاری‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.",
};

function mediaError(correlationId: string, code: MediaIssueCode) {
  return new HttpException(
    {
      code: "VALIDATION_ERROR",
      message: issueMessages[code],
      correlationId,
      details: { issues: [{ field: "media", code }] },
    },
    code === "RATE_LIMITED"
      ? HttpStatus.TOO_MANY_REQUESTS
      : code === "FILE_TOO_LARGE"
        ? HttpStatus.PAYLOAD_TOO_LARGE
        : HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function mediaNotFound(correlationId: string) {
  return new HttpException(
    { code: "MEDIA_NOT_FOUND", message: "رسانه پیدا نشد.", correlationId },
    HttpStatus.NOT_FOUND,
  );
}
