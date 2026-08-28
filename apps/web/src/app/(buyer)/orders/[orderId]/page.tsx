import { redirect, notFound } from "next/navigation";
import { firstParameter } from "../../../../lib/navigation";

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
  // Full order tracking is delivered by the buyer order journey, not this shell.
  notFound();
}
