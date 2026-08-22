import { Suspense } from "react";

import { SellerApplicationPrototype } from "./seller-application-prototype";

// PROTOTYPE: Three seller-application and platform-review directions,
// switchable via ?variant=A|B|C on /prototype/seller-application.
export default function SellerApplicationPrototypePage() {
  return (
    <Suspense fallback={null}>
      <SellerApplicationPrototype />
    </Suspense>
  );
}
