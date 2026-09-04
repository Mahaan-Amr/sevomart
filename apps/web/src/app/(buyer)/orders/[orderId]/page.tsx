import { redirect } from "next/navigation";
import { firstParameter } from "../../../../lib/navigation";
import { OrderTracking } from "./order-tracking";

export default async function OrderReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ attemptId?: string | string[] }>;
}) {
  const [{ orderId }, { attemptId }] = await Promise.all([params, searchParams]);
  const attempt = firstParameter(attemptId);
  if (attempt)
    redirect(
      `/orders/${encodeURIComponent(orderId)}/payment-result?${new URLSearchParams({ attemptId: attempt })}`,
    );
  return <OrderTracking orderId={orderId} />;
}
