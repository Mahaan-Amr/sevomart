import { Client } from "minio";

export async function ensureE2eBucket(
  environment,
  createClient = (options) => new Client(options),
) {
  const bucket = environment.MINIO_BUCKET ?? "sevo-media";
  const client = createClient({
    endPoint: environment.MINIO_ENDPOINT ?? "127.0.0.1",
    port: Number(environment.MINIO_PORT ?? 9100),
    useSSL: environment.MINIO_USE_SSL === "true",
    accessKey: environment.MINIO_ACCESS_KEY ?? "sevo_local",
    secretKey: environment.MINIO_SECRET_KEY ?? "sevo_local_password",
  });

  if (!(await client.bucketExists(bucket))) {
    await client.makeBucket(bucket);
  }
}
