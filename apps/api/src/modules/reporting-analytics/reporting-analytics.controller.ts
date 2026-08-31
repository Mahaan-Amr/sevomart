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
import { ReportingAnalyticsFault, type ReportingAnalyticsFaultCode } from "./public";
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
    };
  }

  private httpError(error: unknown, correlationId: string) {
    if (!(error instanceof ReportingAnalyticsFault)) return error;
    const { status, message } = faultResponses[error.code];
    return new HttpException(
      { version: 1, code: error.code, message, correlationId },
      status,
    );
  }
}

const faultResponses: Readonly<
  Record<ReportingAnalyticsFaultCode, { status: HttpStatus; message: string }>
> = {
  UNAUTHENTICATED: {
    status: HttpStatus.UNAUTHORIZED,
    message: "برای دیدن گزارش فروشگاه وارد شوید.",
  },
  FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: "فروشندگی فعال نیست.",
  },
  NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: "فروشگاه پیدا نشد.",
  },
  VALIDATION_ERROR: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "بازه گزارش معتبر نیست.",
  },
};
