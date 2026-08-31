import { z } from "zod";

import { createJsonSchemaMap } from "../../json-schema";
import {
  errorEnvelopeV1Contract,
  moneyV1Contract,
  storeIdContract,
  timestampV1Contract,
} from "../../platform/v1/index";

export const reportingAnalyticsV1Operations = {
  readSellerOperationalSummary: {
    operationId: "readSellerOperationalSummary",
    method: "get",
    path: "/v1/seller/overview",
  },
  readSellerBasicReport: {
    operationId: "readSellerBasicReport",
    method: "get",
    path: "/v1/seller/reports",
  },
} as const;

export const sellerPreparationOverdueAfterHours = 24 as const;

export function isSellerPreparationOverdue(
  preparation: Readonly<{
    fulfillmentStatus?: string;
    fulfillmentOccurredAt?: string;
  }>,
  now: Date,
) {
  return (
    preparation.fulfillmentStatus === "PREPARING" &&
    preparation.fulfillmentOccurredAt !== undefined &&
    Date.parse(preparation.fulfillmentOccurredAt) <=
      now.getTime() - sellerPreparationOverdueAfterHours * 60 * 60 * 1_000
  );
}

export const sellerReportRangeQueryContract = z
  .object({
    from: timestampV1Contract.optional(),
    to: timestampV1Contract.optional(),
  })
  .strict()
  .superRefine((range, context) => {
    if (range.from && range.to && Date.parse(range.from) >= Date.parse(range.to)) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "report range end must be after its start",
      });
    }
  });

export const sellerOperationalTaskContract = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("NEW_ORDERS"),
      count: z.int().nonnegative(),
      href: z.literal("/seller/orders"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("OVERDUE_PREPARATIONS"),
      count: z.int().nonnegative(),
      href: z.literal("/seller/orders?status=preparing"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("AWAITING_DISPUTE_RESPONSES"),
      count: z.int().nonnegative(),
      href: z.literal("/seller/conversations"),
    })
    .strict(),
]);

export const sellerOperationalSummaryContract = z
  .object({
    storeId: storeIdContract,
    tasks: z.array(sellerOperationalTaskContract).length(3),
    preparationOverdueAfterHours: z.literal(sellerPreparationOverdueAfterHours),
    projectionUpdatedAt: timestampV1Contract.nullable(),
  })
  .strict();

export const sellerBasicReportContract = z
  .object({
    storeId: storeIdContract,
    range: z.object({ from: timestampV1Contract, to: timestampV1Contract }).strict(),
    sales: moneyV1Contract,
    orderCount: z.int().nonnegative(),
    completedOrderCount: z.int().nonnegative(),
    projectionUpdatedAt: timestampV1Contract.nullable(),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.completedOrderCount > report.orderCount) {
      context.addIssue({
        code: "custom",
        path: ["completedOrderCount"],
        message: "completed orders cannot exceed placed orders",
      });
    }
  });

export const reportingAnalyticsErrorContract = errorEnvelopeV1Contract.extend({
  code: z.enum(["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR"]),
});

export const reportingAnalyticsV1Schemas = {
  SellerReportTimestamp: timestampV1Contract,
  SellerReportRangeQuery: sellerReportRangeQueryContract,
  SellerOperationalTask: sellerOperationalTaskContract,
  SellerOperationalSummary: sellerOperationalSummaryContract,
  SellerBasicReport: sellerBasicReportContract,
  ReportingAnalyticsError: reportingAnalyticsErrorContract,
} as const;

export function createReportingAnalyticsV1JsonSchemas() {
  return createJsonSchemaMap(reportingAnalyticsV1Schemas);
}

export const reportingAnalyticsV1Examples = {
  SellerReportRangeQuery: {
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-09-01T00:00:00.000Z",
  },
  SellerOperationalSummary: {
    storeId: "57a3f408-858c-45d7-a0bd-ab84a28718ef",
    tasks: [
      { kind: "NEW_ORDERS", count: 2, href: "/seller/orders" },
      {
        kind: "OVERDUE_PREPARATIONS",
        count: 1,
        href: "/seller/orders?status=preparing",
      },
      {
        kind: "AWAITING_DISPUTE_RESPONSES",
        count: 1,
        href: "/seller/conversations",
      },
    ],
    preparationOverdueAfterHours: sellerPreparationOverdueAfterHours,
    projectionUpdatedAt: "2026-08-31T12:00:00.000Z",
  },
  SellerBasicReport: {
    storeId: "57a3f408-858c-45d7-a0bd-ab84a28718ef",
    range: {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    },
    sales: { amount: 2_500_000, currency: "IRR" },
    orderCount: 4,
    completedOrderCount: 3,
    projectionUpdatedAt: "2026-08-31T12:00:00.000Z",
  },
} as const;
