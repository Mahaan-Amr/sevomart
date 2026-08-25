import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import {
  discoveryFeedCursorContract,
  discoveryFeedLimitContract,
} from "@sevo/contracts/discovery/v1";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import type { FastifyReply, FastifyRequest } from "fastify";

import { readIdentitySessionToken } from "../../http/identity-session";
import {
  IDENTITY_SESSION_READER,
  type IdentitySessionReader,
} from "../identity-access/public";
import {
  DiscoveryCursorExpiredError,
  DiscoveryCursorInvalidError,
  DiscoveryCursorStaleError,
} from "./application/discovery-cursor";
import { FOLLOWING_FEED_SERVICE } from "./discovery.tokens";
import { DiscoveryProjectionUnavailableError, type FollowingFeed } from "./public";

@ApiExcludeController()
@Controller("v1/me/feeds")
export class FollowingFeedController {
  constructor(
    @Inject(FOLLOWING_FEED_SERVICE) private readonly following: FollowingFeed,
    @Inject(IDENTITY_SESSION_READER)
    private readonly sessions: IdentitySessionReader,
  ) {}

  @Get("following")
  async read(
    @Query("cursor") cursorInput: string | undefined,
    @Query("limit") limitInput: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const token = readIdentitySessionToken(request) ?? "";
    const identitySession = await this.sessions.readIdentitySession(token);
    if (!identitySession) {
      throw problem(
        HttpStatus.UNAUTHORIZED,
        "UNAUTHENTICATED",
        "برای دیدن دنبال‌شده‌ها وارد شوید.",
        request.id,
      );
    }
    if (identitySession.identityStatus !== "ACTIVE") {
      throw problem(
        HttpStatus.FORBIDDEN,
        "IDENTITY_INACTIVE",
        "این هویت غیرفعال است؛ برای پیگیری با پشتیبانی تماس بگیرید.",
        request.id,
      );
    }
    const cursor = cursorInput
      ? discoveryFeedCursorContract.safeParse(cursorInput)
      : undefined;
    const limit = limitInput
      ? discoveryFeedLimitContract.safeParse(limitInput)
      : undefined;
    if ((cursor && !cursor.success) || (limit && !limit.success)) {
      throw problem(
        HttpStatus.BAD_REQUEST,
        "INVALID_CURSOR",
        "نشانی ادامه فید معتبر نیست.",
        request.id,
      );
    }
    try {
      const result = await this.following.read({
        identityId: identityIdContract.parse(identitySession.session.actor.identityId),
        ...(cursor?.success ? { cursor: cursor.data } : {}),
        ...(limit?.success ? { limit: limit.data } : {}),
      });
      response.header("cache-control", "private, no-store");
      response.header("x-projection-lag-ms", String(result.projectionLagMs));
      return result.page;
    } catch (error) {
      if (error instanceof DiscoveryCursorInvalidError) {
        throw problem(
          HttpStatus.BAD_REQUEST,
          "INVALID_CURSOR",
          "نشانی ادامه فید معتبر نیست.",
          request.id,
        );
      }
      if (error instanceof DiscoveryCursorExpiredError) {
        throw problem(
          HttpStatus.GONE,
          "CURSOR_EXPIRED",
          "فید را تازه کردیم؛ از ابتدا ادامه دهید.",
          request.id,
        );
      }
      if (error instanceof DiscoveryCursorStaleError) {
        throw problem(
          HttpStatus.CONFLICT,
          "FEED_CURSOR_STALE",
          "فروشگاه‌های دنبال‌شده تغییر کرده‌اند؛ فید را تازه کنید.",
          request.id,
        );
      }
      if (error instanceof DiscoveryProjectionUnavailableError) {
        response.header("retry-after", "5");
        throw problem(
          HttpStatus.SERVICE_UNAVAILABLE,
          "PROJECTION_UNAVAILABLE",
          "نمایش کالاها فعلاً به‌روز نیست. کمی بعد دوباره تلاش کنید.",
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
) {
  return new HttpException({ code, message, correlationId }, status);
}
