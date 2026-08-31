import {
  sellerBasicReportContract,
  sellerOperationalSummaryContract,
} from "@sevo/contracts/reporting-analytics/v1";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export type SellerReportingRead<T> = { kind: "OK"; data: T } | { kind: "UNAVAILABLE" };

type SellerBasicReport = ReturnType<typeof sellerBasicReportContract.parse>;
type SellerOperationalSummary = ReturnType<
  typeof sellerOperationalSummaryContract.parse
>;

export function readSellerOperationalSummary(
  cookieHeader: string,
): Promise<SellerReportingRead<SellerOperationalSummary>> {
  return readJson(
    "/v1/seller/overview",
    cookieHeader,
    sellerOperationalSummaryContract,
  );
}

export function readSellerBasicReport(
  cookieHeader: string,
): Promise<SellerReportingRead<SellerBasicReport>> {
  return readJson("/v1/seller/reports", cookieHeader, sellerBasicReportContract);
}

async function readJson<T>(
  path: string,
  cookieHeader: string,
  contract: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<SellerReportingRead<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!response.ok) return { kind: "UNAVAILABLE" };
    const parsed = contract.safeParse(await response.json());
    return parsed.success ? { kind: "OK", data: parsed.data } : { kind: "UNAVAILABLE" };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}
