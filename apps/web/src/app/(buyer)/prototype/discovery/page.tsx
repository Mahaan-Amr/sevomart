import { Suspense } from "react";

import { BuyerDiscoveryPrototype } from "./buyer-discovery-prototype";

// PROTOTYPE: Three buyer discovery directions, switchable via ?variant=A|B|C,
// on the throwaway /prototype/discovery route.
export default function BuyerDiscoveryPrototypePage() {
  return (
    <Suspense fallback={null}>
      <BuyerDiscoveryPrototype />
    </Suspense>
  );
}
