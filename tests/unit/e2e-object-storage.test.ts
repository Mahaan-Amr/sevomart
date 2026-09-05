import { describe, expect, it, vi } from "vitest";

import { ensureE2eBucket } from "../../apps/api/scripts/e2e-object-storage.mjs";

describe("E2E object storage", () => {
  it("creates the configured bucket only when it is absent", async () => {
    const bucketExists = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const makeBucket = vi.fn().mockResolvedValue(undefined);
    const createClient = vi.fn(() => ({ bucketExists, makeBucket }));
    const environment = {
      MINIO_ACCESS_KEY: "access",
      MINIO_BUCKET: "candidate-media",
      MINIO_ENDPOINT: "127.0.0.1",
      MINIO_PORT: "19000",
      MINIO_SECRET_KEY: "secret",
      MINIO_USE_SSL: "false",
    };

    await ensureE2eBucket(environment, createClient);
    await ensureE2eBucket(environment, createClient);

    expect(createClient).toHaveBeenCalledWith({
      accessKey: "access",
      endPoint: "127.0.0.1",
      port: 19000,
      secretKey: "secret",
      useSSL: false,
    });
    expect(bucketExists).toHaveBeenCalledTimes(2);
    expect(bucketExists).toHaveBeenCalledWith("candidate-media");
    expect(makeBucket).toHaveBeenCalledOnce();
    expect(makeBucket).toHaveBeenCalledWith("candidate-media");
  });
});
