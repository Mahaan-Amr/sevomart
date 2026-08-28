import type { ReactNode } from "react";
import { CheckoutView } from "../checkout-view";

export default function CheckoutStepsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <CheckoutView />
      {children}
    </>
  );
}
