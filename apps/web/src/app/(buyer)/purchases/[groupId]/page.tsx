import { PurchaseReceipt } from "./purchase-receipt";

export default async function PurchasePage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  return (
    <PurchaseReceipt
      groupId={groupId}
      developmentPayment={
        (process.env.SEVO_RUNTIME_ENV ?? process.env.NODE_ENV) !== "production"
      }
    />
  );
}
