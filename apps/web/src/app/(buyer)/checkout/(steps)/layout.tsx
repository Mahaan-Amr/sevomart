import type { ReactNode } from "react";
import { MultiStoreCheckoutView } from "../multi-store-checkout-view";

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
