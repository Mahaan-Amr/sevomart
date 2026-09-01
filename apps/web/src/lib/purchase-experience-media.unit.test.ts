import { describe, expect, it, vi } from "vitest";

import {
  preparePurchaseExperienceImageUpload,
  PurchaseExperienceMediaUploadError,
} from "./purchase-experience-media";

const reference = {
  id: "6014fdd4-e393-4100-a037-030b781b6637",
  contentType: "image/webp",
  url: "/v1/media/6014fdd4-e393-4100-a037-030b781b6637",
};

describe("purchase experience image upload", () => {
  it("reuses one idempotency key when the Persian retry action runs again", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { message: "ارتباط با سرور برقرار نشد. دوباره تلاش کنید." },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(Response.json(reference, { status: 201 }));
    const upload = preparePurchaseExperienceImageUpload({
      contextId: "70000000-0000-4000-8000-000000000001",
      file: new File(["image"], "experience.png", { type: "image/png" }),
      idempotencyKey: "stable-upload-key",
      fetcher,
    });

    await expect(upload.run()).rejects.toEqual(
      expect.objectContaining<Partial<PurchaseExperienceMediaUploadError>>({
        userMessage: "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.",
      }),
    );
    await expect(upload.run()).resolves.toEqual(reference);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get("idempotency-key")).toBe(
        "stable-upload-key",
      );
    }
  });
});
