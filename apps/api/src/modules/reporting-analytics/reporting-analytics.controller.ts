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
import type { FastifyReply, FastifyRequest } from "fastify";

import { readIdentitySessionToken } from "../../http/identity-session";
import { ReportingAnalyticsService } from "./application/reporting-analytics.service";
import { ReportingAnalyticsFault } from "./public";
import { REPORTING_ANALYTICS_SERVICE } from "./reporting-analytics.tokens";

@ApiExcludeController()
@Controller("v1/seller")
export class ReportingAnalyticsController {
  constructor(
    @Inject(REPORTING_ANALYTICS_SERVICE)
    private readonly reporting: ReportingAnalyticsService,
  ) {}

  @Get("overview")
  async readOperationalSummary(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "private, no-store");
    try {
      return await this.reporting.readOperationalSummary(this.context(request));
    } catch (error) {
      throw this.httpError(error, request.id);
    }
  }

  @Get("reports")
  async readBasicReport(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    response.header("cache-control", "private, no-store");
    try {
      return await this.reporting.readBasicReport(this.context(request), query);
    } catch (error) {
      throw this.httpError(error, request.id);
    }
  }

  private context(request: FastifyRequest) {
    return {
      sessionToken: readIdentitySessionToken(request),
      correlationId: request.id,
    };
  }

  private httpError(error: unknown, correlationId: string) {
    if (!(error instanceof ReportingAnalyticsFault)) return error;
    const status = {
      UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
      FORBIDDEN: HttpStatus.FORBIDDEN,
      NOT_FOUND: HttpStatus.NOT_FOUND,
      VALIDATION_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
    }[error.code];
    const message = {
      UNAUTHENTICATED: "برای دیدن گزارش فروشگاه وارد شوید.",
      FORBIDDEN: "فروشندگی فعال نیست.",
      NOT_FOUND: "فروشگاه پیدا نشد.",
      VALIDATION_ERROR: "بازه گزارش معتبر نیست.",
    }[error.code];
    return new HttpException({ code: error.code, message, correlationId }, status);
  }
}
