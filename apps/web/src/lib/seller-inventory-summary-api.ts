import { sellerInventoryListContract } from "@sevo/contracts/inventory/v1";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";

export async function readSellerOutOfStockCount(
  cookieHeader: string,
): Promise<{ kind: "OK"; data: number } | { kind: "UNAVAILABLE" }> {
  try {
    let count = 0;
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      const search = new URLSearchParams({
        availability: "OUT_OF_STOCK",
        limit: "50",
      });
      if (cursor) search.set("cursor", cursor);
      const response = await fetch(`${API_BASE_URL}/v1/seller/inventory?${search}`, {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      });
      if (!response.ok) return { kind: "UNAVAILABLE" };
      const parsed = sellerInventoryListContract.safeParse(await response.json());
      if (!parsed.success) return { kind: "UNAVAILABLE" };
      count += parsed.data.items.length;
      cursor = parsed.data.nextCursor;
      if (cursor && seenCursors.has(cursor)) return { kind: "UNAVAILABLE" };
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return { kind: "OK", data: count };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}
