import type { ReactNode } from "react";
import { CheckoutView } from "../checkout-view";

export default function CheckoutStepsLayout({ children }: { children: ReactNode }) {
  const developmentPayment =
    (process.env.SEVO_RUNTIME_ENV ?? process.env.NODE_ENV) !== "production";
  return (
    <>
      <CheckoutView developmentPayment={developmentPayment} />
      {children}
    </>
  );
}
