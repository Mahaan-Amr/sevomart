import { SellerDirectRefund } from "../../../../orders/seller-direct-refund";

type Props = { params: Promise<{ orderId: string }> };

export default async function SellerDirectRefundPage({ params }: Props) {
  const { orderId } = await params;
  return <SellerDirectRefund orderId={orderId} />;
}
