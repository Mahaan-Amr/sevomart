import { OrderReceipt } from "./order-receipt";

export default async function OrderReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ attemptId?: string }>;
}) {
  const [{ orderId }, { attemptId }] = await Promise.all([params, searchParams]);
  return <OrderReceipt orderId={orderId} attemptId={attemptId} />;
}
