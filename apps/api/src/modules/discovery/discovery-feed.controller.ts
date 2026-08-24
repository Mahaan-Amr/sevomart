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
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  DiscoveryCursorExpiredError,
  DiscoveryCursorInvalidError,
  DiscoveryCursorStaleError,
} from "./application/discovery-cursor";
import { DISCOVERY_FEED_SERVICE } from "./discovery.tokens";
import { DiscoveryProjectionUnavailableError, type DiscoveryFeed } from "./public";

@ApiExcludeController()
@Controller("v1/feeds")
export class DiscoveryFeedController {
  constructor(
    @Inject(DISCOVERY_FEED_SERVICE) private readonly discovery: DiscoveryFeed,
  ) {}

  @Get("discovery")
  async read(
    @Query("cursor") cursorInput: string | undefined,
    @Query("limit") limitInput: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const cursor = cursorInput
      ? discoveryFeedCursorContract.safeParse(cursorInput)
      : undefined;
    const limit = limitInput
      ? discoveryFeedLimitContract.safeParse(limitInput)
      : undefined;
    if (cursor && !cursor.success) {
      throw problem(
        HttpStatus.BAD_REQUEST,
        "INVALID_CURSOR",
        "نشانی ادامه فید معتبر نیست.",
        request.id,
      );
    }
    if (limit && !limit.success) {
      throw problem(
        HttpStatus.BAD_REQUEST,
        "INVALID_CURSOR",
        "اندازه صفحه باید بین ۱ تا ۳۰ باشد.",
        request.id,
      );
    }
    try {
      const result = await this.discovery.read({
        ...(cursor?.success ? { cursor: cursor.data } : {}),
        ...(limit?.success ? { limit: limit.data } : {}),
      });
      response.header("cache-control", "public, max-age=30");
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
          "نسخه فید تغییر کرده است؛ فید را تازه کنید.",
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
