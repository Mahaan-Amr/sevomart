import { z } from "zod";

const runtimeEnvironmentContract = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(3001),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.url().default("postgresql://sevo:sevo_local@localhost:6432/sevo"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional().or(z.literal("")),
});

export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentContract>;

export function readRuntimeEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): RuntimeEnvironment {
  return runtimeEnvironmentContract.parse(source);
}
