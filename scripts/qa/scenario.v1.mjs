import {
  createQaScenarioFactory,
  QA_SCENARIO_CONTRACT_VERSION,
} from "./scenario-factory.v1.mjs";
import { createQaScenarioLifecycle } from "./scenario-lifecycle.mjs";

const factory = createQaScenarioFactory({
  lifecycle: createQaScenarioLifecycle(),
});

export { QA_SCENARIO_CONTRACT_VERSION };
export const withQaScenario = factory.withScenario;
