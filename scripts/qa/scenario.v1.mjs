import {
  createQaScenarioFactory,
  QA_SCENARIO_CONTRACT_VERSION,
} from "./scenario-factory.v1.mjs";
import { createQaScenarioLifecycle } from "./scenario-lifecycle.mjs";
import { assertQaScenarioProcessEnvironment } from "./scenario-environment.mjs";

const factory = createQaScenarioFactory({
  lifecycle: createQaScenarioLifecycle(),
});

export { QA_SCENARIO_CONTRACT_VERSION };
export async function withQaScenario(definition, exercise) {
  assertQaScenarioProcessEnvironment();
  return factory.withScenario(definition, exercise);
}
