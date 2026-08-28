import { firstParameter } from "../../../../../lib/navigation";
import { OrderReceipt } from "../order-receipt";

export default async function PaymentResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ attemptId?: string | string[] }>;
}) {
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  return <OrderReceipt orderId={orderId} attemptId={firstParameter(query.attemptId)} />;
}
