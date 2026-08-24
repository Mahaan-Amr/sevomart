import {
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  discoveryFollowIdempotencyKeyContract,
  discoveryFollowRevisionTagContract,
} from "@sevo/contracts/discovery/v1";
import { identityIdContract, storeIdContract } from "@sevo/contracts/platform/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { readIdentitySessionToken } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
} from "../identity-access/public";
import { STORE_FOLLOWING_SERVICE } from "./discovery.tokens";
import {
  FollowIdempotencyConflictError,
  FollowPreconditionRequiredError,
  FollowRevisionConflictError,
  FollowStoreNotFoundError,
  SelfFollowNotAllowedError,
  type StoreFollowing,
} from "./public";

@ApiExcludeController()
@Controller("v1/me/follows")
export class DiscoveryController {
  constructor(
    @Inject(STORE_FOLLOWING_SERVICE) private readonly following: StoreFollowing,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
  ) {}

  @Put(":storeId")
  @HttpCode(HttpStatus.OK)
  activate(
    @Param("storeId") storeId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.write("ACTIVATE", storeId, idempotencyKey, ifMatch, request, response);
  }

  @Delete(":storeId")
  @HttpCode(HttpStatus.OK)
  deactivate(
    @Param("storeId") storeId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    return this.write(
      "DEACTIVATE",
      storeId,
      idempotencyKey,
      ifMatch,
      request,
      response,
    );
  }

  private async write(
    operation: "ACTIVATE" | "DEACTIVATE",
    storeIdInput: string,
    idempotencyKeyInput: string | undefined,
    ifMatchInput: string | undefined,
    request: FastifyRequest,
    response: FastifyReply,
  ) {
    const token = readIdentitySessionToken(request) ?? "";
    const session = await this.sessions.readActiveIdentitySession(token);
    if (!session) {
      throw problem(
        HttpStatus.UNAUTHORIZED,
        "UNAUTHENTICATED",
        "برای دنبال‌کردن فروشگاه وارد شوید.",
        request.id,
      );
    }
    const storeId = storeIdContract.safeParse(storeIdInput);
    if (!storeId.success) {
      throw problem(
        HttpStatus.NOT_FOUND,
        "STORE_NOT_FOUND",
        "فروشگاه پیدا نشد.",
        request.id,
      );
    }
    const idempotencyKey =
      discoveryFollowIdempotencyKeyContract.safeParse(idempotencyKeyInput);
    const revisionTag = ifMatchInput
      ? discoveryFollowRevisionTagContract.safeParse(ifMatchInput)
      : undefined;
    if (!idempotencyKey.success || (revisionTag && !revisionTag.success)) {
      throw problem(
        HttpStatus.PRECONDITION_REQUIRED,
        "PRECONDITION_REQUIRED",
        "شناسه درخواست و نسخه معتبر رابطه لازم است.",
        request.id,
      );
    }

    try {
      const write =
        operation === "ACTIVATE" ? this.following.activate : this.following.deactivate;
      const result = await write.call(this.following, {
        identityId: identityIdContract.parse(session.actor.identityId),
        storeId: storeId.data,
        idempotencyKey: idempotencyKey.data,
        ...(revisionTag?.success
          ? { expectedRevision: Number(revisionTag.data.slice(1, -1)) }
          : {}),
        correlationId: request.id,
      });
      response.header("etag", result.etag);
      response.header("cache-control", "private, no-store");
      return result.view;
    } catch (error) {
      if (error instanceof FollowPreconditionRequiredError) {
        throw problem(
          HttpStatus.PRECONDITION_REQUIRED,
          "PRECONDITION_REQUIRED",
          "نسخه فعلی رابطه را تازه کنید و دوباره تلاش کنید.",
          request.id,
        );
      }
      if (error instanceof FollowRevisionConflictError) {
        throw problem(
          HttpStatus.CONFLICT,
          "REVISION_CONFLICT",
          "وضعیت دنبال‌کردن در جای دیگری تغییر کرده است.",
          request.id,
          { currentRevision: error.currentRevision },
        );
      }
      if (error instanceof FollowIdempotencyConflictError) {
        throw problem(
          HttpStatus.CONFLICT,
          "IDEMPOTENCY_CONFLICT",
          "این شناسه درخواست برای تغییر دیگری استفاده شده است.",
          request.id,
        );
      }
      if (error instanceof SelfFollowNotAllowedError) {
        throw problem(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "SELF_FOLLOW_NOT_ALLOWED",
          "فروشگاه خودتان را نمی‌توانید دنبال کنید.",
          request.id,
        );
      }
      if (error instanceof FollowStoreNotFoundError) {
        throw problem(
          HttpStatus.NOT_FOUND,
          "STORE_NOT_FOUND",
          "فروشگاه پیدا نشد.",
          request.id,
        );
      }
      throw error;
    }
  }
}

function problem(
  status: HttpStatus,
  code: string,
  message: string,
  correlationId: string,
  details?: Record<string, unknown>,
) {
  return new HttpException(
    { code, message, correlationId, ...(details ? { details } : {}) },
    status,
  );
}
