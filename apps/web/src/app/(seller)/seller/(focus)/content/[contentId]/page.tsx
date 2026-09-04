import { ActiveSellerGate } from "../../../_components/active-seller-gate";
import { SellerSalesContentWorkspace } from "../../../content/seller-sales-content-workspace";

export default async function EditSellerSalesContentPage({
  params,
}: {
  params: Promise<{ contentId: string }>;
}) {
  const { contentId } = await params;
  return (
    <ActiveSellerGate returnTo={`/seller/content/${contentId}`}>
      <SellerSalesContentWorkspace mode="edit" contentId={contentId} />
    </ActiveSellerGate>
  );
}
