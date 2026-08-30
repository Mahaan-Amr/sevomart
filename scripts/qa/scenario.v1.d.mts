export const QA_SCENARIO_CONTRACT_VERSION: 1;

export type QaScenarioBaseContext = Readonly<{
  contractVersion: 1;
  runId: string;
  namespace: string;
  clock: Readonly<{ now(): Date }>;
  id(name: string): string;
  environment: Readonly<
    Record<string, string | undefined> & {
      DATABASE_URL: string;
      MINIO_ACCESS_KEY: string;
      MINIO_BUCKET: string;
      MINIO_ENDPOINT: string;
      MINIO_PORT: string;
      MINIO_SECRET_KEY: string;
      MINIO_USE_SSL: "false";
      OTP_PROVIDER: "dev";
      SEVO_RUNTIME_ENV: "test";
    }
  >;
  database: Readonly<{ name: string; url: string }>;
  objectStorage: Readonly<{ bucket: string; endpoint: string }>;
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
