import { SellerOrders } from "../../orders/seller-orders";

type Props = { searchParams: Promise<{ status?: string | string[] }> };

export default async function SellerOrdersPage({ searchParams }: Props) {
  const { status } = await searchParams;
  return <SellerOrders status={status === "preparing" ? "PREPARING" : undefined} />;
}
