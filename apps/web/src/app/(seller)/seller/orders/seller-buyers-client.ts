import {
  revealedOrderDeliveryDetailsContract,
  storeBuyerOrderPageContract,
  storeBuyerPageContract,
  type RevealedOrderDeliveryDetails,
  type StoreBuyerOrderPage,
  type StoreBuyerPage,
} from "@sevo/contracts/orders/v1";

export class SellerSessionExpired extends Error {}

export async function readRelatedBuyers(
  search: string,
  cursor?: string,
): Promise<StoreBuyerPage> {
  const parameters = new URLSearchParams({ search, limit: "20" });
  if (cursor) parameters.set("cursor", cursor);
  const response = await fetch(`/api/seller/buyers?${parameters}`, {
    cache: "no-store",
  });
  const body = await readSellerBody(response);
  const parsed = storeBuyerPageContract.safeParse(body);
  if (!parsed.success) throw new Error(readMessage(body));
  return parsed.data;
}

export async function readStoreBuyerOrders(
  orderId: string,
  cursor?: string,
): Promise<StoreBuyerOrderPage> {
  const parameters = new URLSearchParams({ limit: "20" });
  if (cursor) parameters.set("cursor", cursor);
  const response = await fetch(
    `/api/seller/orders/${encodeURIComponent(orderId)}/buyer-orders?${parameters}`,
    { cache: "no-store" },
  );
  const body = await readSellerBody(response);
  const parsed = storeBuyerOrderPageContract.safeParse(body);
  if (!parsed.success) throw new Error(readMessage(body));
  return parsed.data;
}

export async function revealOrderDeliveryDetails(
  orderId: string,
  reason: string,
): Promise<RevealedOrderDeliveryDetails> {
  const response = await fetch(
    `/api/seller/orders/${encodeURIComponent(orderId)}/delivery-details/reveal`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
      cache: "no-store",
    },
  );
  const body = await readSellerBody(response);
  const parsed = revealedOrderDeliveryDetailsContract.safeParse(body);
  if (!parsed.success) throw new Error(readMessage(body));
  return parsed.data;
}

async function readSellerBody(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (response.status === 401) throw new SellerSessionExpired();
  if (!response.ok) throw new Error(readMessage(body));
  return body;
}

function readMessage(body: unknown) {
  return typeof body === "object" && body && "message" in body
    ? String(body.message)
    : "اطلاعات خریدار دریافت نشد. دوباره تلاش کنید.";
}
