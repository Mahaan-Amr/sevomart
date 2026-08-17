import { TestSettlementDestinationVerifier } from "../../apps/api/src/modules/store/testing/test-settlement-verifier";
import { runSettlementDestinationVerifierContract } from "./settlement-destination-verifier.contract";

runSettlementDestinationVerifierContract(
  "TestSettlementDestinationVerifier",
  () => new TestSettlementDestinationVerifier(),
);
