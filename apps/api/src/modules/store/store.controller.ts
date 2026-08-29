import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
} from "../identity-access/public";
import {
  storeDraftInputContract,
  storeIdempotencyKeyContract,
  storeRevisionTagContract,
  storeSlugContract,
} from "@sevo/contracts/store/v1";
import { identityIdContract, storeIdContract } from "@sevo/contracts/platform/v1";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireIdentity } from "../../http/identity-session";
import { readIdentitySessionToken } from "../../http/identity-session";

import {
  IncompleteStoreError,
  InvalidStoreMediaError,
  StoreNotFoundError,
  StoreService,
  StoreSlugConflictError,
} from "./application/store.service";
import { PUBLIC_STORE_FOLLOWING_READER, STORE_SERVICE } from "./store.tokens";
import { StoreIdempotencyConflictError, StoreRevisionConflictError } from "./public";
import type { PublicStoreFollowingReader } from "./public";

@ApiExcludeController()
@Controller("v1")
export class StoreController {
  constructor(
    @Inject(STORE_SERVICE) private readonly service: StoreService,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
    @Inject(PUBLIC_STORE_FOLLOWING_READER)
    private readonly following: PublicStoreFollowingReader,
  ) {}

  @Get("seller/store/draft")
  async readDraft(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const draft = await this.handle(request, () => this.service.readDraft(identityId));
    response.header("etag", `"${draft.revision}"`);
    return draft;
  }

  @Put("seller/store/draft")
  async saveDraft(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const parsed = storeDraftInputContract.safeParse(body);
    if (!parsed.success) {
      throw validationError(
        request.id,
        "اطلاعات فروشگاه را بررسی کنید.",
        parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "store",
          code: issue.code === "too_small" ? "TOO_SHORT" : "INVALID_FORMAT",
        })),
      );
    }
    const write = requireStoreWriteHeaders(request.id, idempotencyKey, ifMatch);
    const draft = await this.handle(request, () =>
      this.service.saveDraft(
        identityId,
        parsed.data,
        {
          correlationId: request.id,
          ...write,
        },
        body,
      ),
    );
    response.header("etag", `"${draft.revision}"`);
    return draft;
  }

  @Get("store-slugs/:slug/availability")
  async checkSlug(@Param("slug") value: string, @Req() request: FastifyRequest) {
    const identityId = await requireIdentity(request, this.sessions);
    const parsed = storeSlugContract.safeParse(value);
    if (!parsed.success) {
      throw validationError(request.id, "شناسه لینک معتبر نیست.", [
        { field: "slug", code: "INVALID_FORMAT" },
      ]);
    }
    return this.service.checkSlug(parsed.data, identityId);
  }

  @Get("seller/store/preview")
  async preview(@Req() request: FastifyRequest) {
    const identityId = await requireIdentity(request, this.sessions);
    return this.handle(request, () => this.service.preview(identityId));
  }

  @Post("seller/store/publication")
  @HttpCode(HttpStatus.OK)
  async publish(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const identityId = await requireIdentity(request, this.sessions);
    const write = requireStoreWriteHeaders(request.id, idempotencyKey, ifMatch);
    const publication = await this.handle(request, () =>
      this.service.publish(identityId, { correlationId: request.id, ...write }),
    );
    response.header("etag", `"${publication.store.revision}"`);
    return publication;
  }

  @Get("stores/:slug")
  async readPublished(
    @Param("slug") value: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const parsed = storeSlugContract.safeParse(value);
    if (!parsed.success) return this.notFound(request.id);
    const store = await this.handle(request, () =>
      this.service.readPublished(parsed.data),
    );
    const token = readIdentitySessionToken(request);
    const session = token
      ? await this.sessions.readActiveIdentitySession(token)
      : undefined;
    const following = await this.following.readPublicStoreFollowing(
      storeIdContract.parse(store.id),
      session ? identityIdContract.parse(session.actor.identityId) : undefined,
      store.publishedAt,
    );
    response.header(
      "cache-control",
      session ? "private, no-store" : "public, max-age=30, must-revalidate",
    );
    response.header("vary", "Cookie");
    if (following.etag) response.header("etag", following.etag);
    return {
      ...store,
      followerCount: following.followerCount,
      ...(following.viewer ? { viewer: following.viewer } : {}),
    };
  }

  private async handle<T>(request: FastifyRequest, operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof StoreNotFoundError) return this.notFound(request.id);
      if (error instanceof StoreSlugConflictError) {
        throw new HttpException(
          {
            code: "SLUG_CONFLICT",
            message: "این شناسه لینک قبلاً استفاده شده است.",
            correlationId: request.id,
            details: { slug: error.slug },
          },
          HttpStatus.CONFLICT,
        );
      }
      if (error instanceof IncompleteStoreError) {
        throw validationError(
          request.id,
          "برای انتشار، اطلاعات ضروری فروشگاه را کامل کنید.",
          error.missingFields.map((field) => ({
            field: field.toLowerCase(),
            code: "REQUIRED",
          })),
        );
      }
      if (error instanceof InvalidStoreMediaError) {
        throw validationError(request.id, "تصویر فروشگاه معتبر نیست.", [
          { field: "media", code: "INVALID_FORMAT" },
        ]);
      }
      if (error instanceof StoreRevisionConflictError) {
        throw new HttpException(
          {
            code: error.code,
            message: "فروشگاه در جای دیگری تغییر کرده است. نسخه تازه را ببینید.",
            correlationId: request.id,
            details: {
              expectedRevision: error.expectedRevision,
              currentRevision: error.currentRevision,
            },
          },
          HttpStatus.CONFLICT,
        );
      }
      if (error instanceof StoreIdempotencyConflictError) {
        throw new HttpException(
          {
            code: error.code,
            message: "این شناسه درخواست قبلاً برای تغییر دیگری استفاده شده است.",
            correlationId: request.id,
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  private notFound(correlationId: string): never {
    throw new HttpException(
      {
        code: "STORE_NOT_FOUND",
        message: "فروشگاه پیدا نشد.",
        correlationId,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

function requireStoreWriteHeaders(
  correlationId: string,
  idempotencyKey: string | undefined,
  ifMatch: string | undefined,
) {
  const parsedKey = storeIdempotencyKeyContract.safeParse(idempotencyKey);
  const parsedTag = storeRevisionTagContract.safeParse(ifMatch);
  if (!parsedKey.success || !parsedTag.success) {
    throw new HttpException(
      {
        code: "PRECONDITION_REQUIRED",
        message: "نسخه فروشگاه و شناسه یکتای درخواست لازم است.",
        correlationId,
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  return {
    idempotencyKey: parsedKey.data,
    expectedRevision: Number(parsedTag.data.slice(1, -1)),
  };
}

function validationError(
  correlationId: string,
  message: string,
  issues: Array<{
    field: string;
    code: "REQUIRED" | "INVALID_FORMAT" | "TOO_SHORT" | "TOO_LONG";
  }>,
) {
  return new HttpException(
    {
      code: "VALIDATION_ERROR",
      message,
      correlationId,
      details: { issues },
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}
