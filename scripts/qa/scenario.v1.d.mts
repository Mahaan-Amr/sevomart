export const QA_SCENARIO_CONTRACT_VERSION: 1;

export type QaScenarioBaseContext = Readonly<{
  contractVersion: 1;
  runId: string;
  namespace: string;
  clock: Readonly<{ now(): Date }>;
  id(name: string): string;
  database: Readonly<{ name: string; url: string }>;
  objectStorage: Readonly<{ endpoint: string }>;
}>;

export type QaScenarioContext<Data> = QaScenarioBaseContext & Readonly<{ data: Data }>;

export function withQaScenario<Data, Result>(
  definition: Readonly<{
    name: string;
    fixedTime: string;
    build(context: QaScenarioBaseContext): Data | Promise<Data>;
  }>,
  exercise: (context: QaScenarioContext<Data>) => Result | Promise<Result>,
): Promise<Result>;
