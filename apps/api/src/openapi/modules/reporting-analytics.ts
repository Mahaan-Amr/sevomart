import {
  createReportingAnalyticsV1JsonSchemas,
  reportingAnalyticsV1Examples,
  reportingAnalyticsV1Operations,
} from "@sevo/contracts/reporting-analytics/v1";

import {
  addModuleOpenApiContract,
  type ApiOperationContract,
} from "../module-contract";
import type { OpenApiContributor } from "../public";

const errors = [
  { status: 401, schema: "ReportingAnalyticsError" },
  { status: 403, schema: "ReportingAnalyticsError" },
  { status: 404, schema: "ReportingAnalyticsError" },
  { status: 422, schema: "ReportingAnalyticsError" },
  { status: 500, schema: "InternalServerError" },
] as const;

const operations = [
  {
    ...reportingAnalyticsV1Operations.readSellerOperationalSummary,
    tag: "reporting-analytics",
    auth: "identity-session",
    responses: [{ status: 200, schema: "SellerOperationalSummary" }, ...errors],
  },
  {
    ...reportingAnalyticsV1Operations.readSellerBasicReport,
    tag: "reporting-analytics",
    auth: "identity-session",
    queryParameters: [
      {
        name: "from",
        schema: "SellerReportTimestamp",
        example: reportingAnalyticsV1Examples.SellerReportRangeQuery.from,
        required: false,
      },
      {
        name: "to",
        schema: "SellerReportTimestamp",
        example: reportingAnalyticsV1Examples.SellerReportRangeQuery.to,
        required: false,
      },
    ],
    responses: [{ status: 200, schema: "SellerBasicReport" }, ...errors],
  },
] as const satisfies readonly ApiOperationContract[];

export const contribute_reporting_analytics_openApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(
    document,
    createReportingAnalyticsV1JsonSchemas(),
    reportingAnalyticsV1Examples,
    operations,
    {
      descriptions: {
        200: "Private seller operational summary or basic report",
        401: "Identity session is missing or invalid",
        403: "Seller access is inactive",
        404: "Seller store was not found",
        422: "Report range is invalid",
        500: "Unexpected server error",
      },
    },
  );
