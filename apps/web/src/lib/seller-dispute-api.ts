import {
  sellerDisputePageContract,
  sellerDisputeViewContract,
} from "@sevo/contracts/problem-follow-up/v1";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export type SellerDisputeRead<T> =
  | { kind: "OK"; data: T }
  | { kind: "NOT_FOUND_OR_FORBIDDEN" }
  | { kind: "UNAVAILABLE" };

export async function readSellerDisputes(
  cookieHeader: string,
  cursor?: string,
  limit = 20,
) {
  const search = new URLSearchParams({ limit: String(limit) });
  if (cursor) search.set("cursor", cursor);
  return readJson(
    `/v1/seller/disputes?${search}`,
    cookieHeader,
    sellerDisputePageContract,
  );
}

export async function readAllSellerDisputes(cookieHeader: string) {
  const disputes = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await readSellerDisputes(cookieHeader, cursor, 100);
    if (page.kind !== "OK") return page;
    disputes.push(...page.data.items);
    cursor = page.data.nextCursor ?? undefined;
    if (cursor && seenCursors.has(cursor)) return { kind: "UNAVAILABLE" } as const;
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return { kind: "OK", data: disputes } as const;
}

export async function readSellerDispute(cookieHeader: string, disputeId: string) {
  return readJson(
    `/v1/seller/disputes/${encodeURIComponent(disputeId)}`,
    cookieHeader,
    sellerDisputeViewContract,
  );
}

async function readJson<T>(
  path: string,
  cookieHeader: string,
  contract: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<SellerDisputeRead<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if ([403, 404, 410].includes(response.status)) {
      return { kind: "NOT_FOUND_OR_FORBIDDEN" };
    }
    if (!response.ok) return { kind: "UNAVAILABLE" };
    const parsed = contract.safeParse(await response.json());
    return parsed.success ? { kind: "OK", data: parsed.data } : { kind: "UNAVAILABLE" };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}
