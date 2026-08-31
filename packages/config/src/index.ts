import { z } from "zod";

const iranianTestMobileList = z
  .string()
  .default("09000000001,09000000002,09000000003,09000000004,09000000005")
  .transform((value) => value.split(",").map((mobile) => mobile.trim()))
  .pipe(
    z
      .array(
        z
          .string()
          .regex(/^09\d{9}$/)
          .brand<"IranianMobile">(),
      )
      .min(1),
  );

const discoveryCursorKeyring = z
  .string()
  .default('{"local-v1":"sevo_local_discovery_cursor_signing_secret"}')
  .transform((value, context) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      context.addIssue({
        code: "custom",
        message: "Invalid discovery cursor keyring JSON",
      });
      return z.NEVER;
    }
  })
  .pipe(z.record(z.string().min(1).max(64), z.string().min(32)));

const runtimeEnvironmentContract = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SEVO_RUNTIME_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(3001),
  WORKER_PORT: z.coerce.number().int().positive().max(65_535).default(3002),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.url().default("postgresql://sevo:sevo_local@localhost:6432/sevo"),
  OTP_PROVIDER: z.enum(["dev", "external"]).default("dev"),
  DEV_OTP_TEST_MOBILES: iranianTestMobileList,
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional().or(z.literal("")),
  MINIO_ENDPOINT: z.string().min(1).default("127.0.0.1"),
  MINIO_PORT: z.coerce.number().int().positive().max(65_535).default(9100),
  MINIO_USE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  MINIO_ACCESS_KEY: z.string().min(1).default("sevo_local"),
  MINIO_SECRET_KEY: z.string().min(8).default("sevo_local_password"),
  MINIO_BUCKET: z.string().min(3).default("sevo-media"),
  API_READINESS_URL: z.url().optional(),
  INTERNAL_API_URL: z.url().default("http://127.0.0.1:3001"),
  SELLER_APPROVAL_RECOVERY_SECRET: z
    .string()
    .min(32)
    .default("sevo_local_seller_approval_recovery_secret"),
  PAYMENT_RECOVERY_SECRET: z
    .string()
    .min(32)
    .default("sevo_local_payment_recovery_secret"),
  CART_TOKEN_DERIVATION_SECRET: z
    .string()
    .min(32)
    .default("sevo_local_cart_token_derivation_secret"),
  DISCOVERY_CURSOR_ACTIVE_KEY_ID: z.string().min(1).max(64).default("local-v1"),
  DISCOVERY_CURSOR_KEYRING: discoveryCursorKeyring,
  DISCOVERY_RANKING_SECRET: z
    .string()
    .min(32)
    .default("sevo_local_discovery_ranking_seed_secret"),
});

export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentContract>;

export function readRuntimeEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): RuntimeEnvironment {
  const environment = runtimeEnvironmentContract.parse(source);
  if (
    !environment.DISCOVERY_CURSOR_KEYRING[environment.DISCOVERY_CURSOR_ACTIVE_KEY_ID]
  ) {
    throw new Error("Active discovery cursor key is missing from its keyring");
  }
  if (environment.SEVO_RUNTIME_ENV === "production") {
    const unsafe =
      environment.OTP_PROVIDER === "dev" ||
      environment.MINIO_ACCESS_KEY === "sevo_local" ||
      environment.MINIO_SECRET_KEY === "sevo_local_password" ||
      ["127.0.0.1", "localhost", "minio"].includes(
        environment.MINIO_ENDPOINT.toLowerCase(),
      ) ||
      !environment.MINIO_USE_SSL ||
      environment.MINIO_BUCKET === "sevo-media" ||
      environment.SELLER_APPROVAL_RECOVERY_SECRET ===
        "sevo_local_seller_approval_recovery_secret" ||
      environment.PAYMENT_RECOVERY_SECRET === "sevo_local_payment_recovery_secret" ||
      environment.CART_TOKEN_DERIVATION_SECRET ===
        "sevo_local_cart_token_derivation_secret" ||
      Object.values(environment.DISCOVERY_CURSOR_KEYRING).includes(
        "sevo_local_discovery_cursor_signing_secret",
      ) ||
      environment.DISCOVERY_RANKING_SECRET ===
        "sevo_local_discovery_ranking_seed_secret" ||
      environment.DATABASE_URL.includes("sevo_local");
    if (unsafe) {
      throw new Error(
        "Production trust requires external OTP, non-default secrets, and persistent TLS object storage",
      );
    }
  }
  return environment;
}
