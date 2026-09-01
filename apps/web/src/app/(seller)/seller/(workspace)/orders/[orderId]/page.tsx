import { SellerOrderFulfillment } from "../../../orders/seller-order-fulfillment";

type Props = { params: Promise<{ orderId: string }> };

export default async function SellerOrderFulfillmentPage({ params }: Props) {
  const { orderId } = await params;
  return <SellerOrderFulfillment orderId={orderId} />;
}
