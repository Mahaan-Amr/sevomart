import { cookies } from "next/headers";

import { readSellerOperationalSummary } from "../../../../../lib/seller-reporting-api";
import { SellerOrders } from "../../orders/seller-orders";

type Props = { searchParams: Promise<{ status?: string | string[] }> };

export default async function SellerOrdersPage({ searchParams }: Props) {
  const { status } = await searchParams;
  if (status !== "preparing") return <SellerOrders />;
  const cookieStore = await cookies();
  const summary = await readSellerOperationalSummary(cookieStore.toString());
  return (
    <SellerOrders
      overdueOnly
      overdueAfterHours={
        summary.kind === "OK" ? summary.data.preparationOverdueAfterHours : undefined
      }
    />
  );
}
