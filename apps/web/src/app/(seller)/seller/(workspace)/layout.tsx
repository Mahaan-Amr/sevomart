import { ActiveSellerGate } from "../_components/active-seller-gate";
import { SellerShell } from "../_components/seller-shell";

export default function SellerWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ActiveSellerGate returnTo="/seller">
      <SellerShell>{children}</SellerShell>
    </ActiveSellerGate>
  );
}
