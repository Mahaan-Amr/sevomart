import { SellerOrderBuyer } from "../../../../orders/seller-order-buyer";

type Props = { params: Promise<{ orderId: string }> };

export default async function SellerOrderBuyerPage({ params }: Props) {
  const { orderId } = await params;
  return <SellerOrderBuyer orderId={orderId} />;
}
