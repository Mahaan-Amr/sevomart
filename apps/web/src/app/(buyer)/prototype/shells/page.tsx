import { Suspense } from "react";

import { FiveIdentityShellPrototype } from "./five-identity-shell-prototype";

// PROTOTYPE: Three radically different shells for the five demo identities,
// switchable with ?variant=A|B|C&identity=buyer|seller|applicant|reviewer|access.
export default function FiveIdentityShellPrototypePage() {
  return (
    <Suspense fallback={null}>
      <FiveIdentityShellPrototype />
    </Suspense>
  );
}
