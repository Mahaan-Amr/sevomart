import type { RuntimeEnvironment } from "@sevo/config";
import { Client } from "minio";
import postgres from "postgres";

export function createRuntimeReadinessCheck(environment: RuntimeEnvironment) {
  return createReadinessCheck([
    async () => {
      const sql = postgres(environment.DATABASE_URL, {
        max: 1,
        connect_timeout: 2,
      });
      try {
        await sql`select 1`;
        return true;
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
    async () => {
      const minio = new Client({
        endPoint: environment.MINIO_ENDPOINT,
        port: environment.MINIO_PORT,
        useSSL: environment.MINIO_USE_SSL,
        accessKey: environment.MINIO_ACCESS_KEY,
        secretKey: environment.MINIO_SECRET_KEY,
      });
      return minio.bucketExists(environment.MINIO_BUCKET);
    },
  ]);
}

export function createReadinessCheck(checks: Array<() => Promise<boolean>>) {
  return async (): Promise<boolean> => {
    try {
      return (await Promise.all(checks.map((check) => check()))).every(Boolean);
    } catch {
      return false;
    }
  };
}
