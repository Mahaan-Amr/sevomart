import type { ReactNode } from "react";
import { MultiStoreCheckoutView } from "../multi-store-checkout-view";

// Runtime mode must be read when the request arrives, not during image build.
export const dynamic = "force-dynamic";

export default function CheckoutStepsLayout({ children }: { children: ReactNode }) {
  const developmentPayment =
    (process.env.SEVO_RUNTIME_ENV ?? process.env.NODE_ENV) !== "production";
  return (
    <>
      <MultiStoreCheckoutView developmentPayment={developmentPayment} />
      {children}
    </>
  );
}
