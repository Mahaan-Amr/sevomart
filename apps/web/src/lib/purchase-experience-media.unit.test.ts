import { describe, expect, it, vi } from "vitest";

import {
  preparePurchaseExperienceMediaContext,
  preparePurchaseExperienceImageUpload,
  PurchaseExperienceMediaUploadError,
} from "./purchase-experience-media";

const reference = {
  id: "6014fdd4-e393-4100-a037-030b781b6637",
  contentType: "image/webp",
  url: "/v1/media/6014fdd4-e393-4100-a037-030b781b6637",
};

describe("purchase experience image upload", () => {
  it("marks a definitive server validation rejection so the form can release its slot", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          code: "VALIDATION_ERROR",
          message: "فایل تصویر خراب است یا کامل خوانده نمی‌شود.",
          details: { issues: [{ field: "media", code: "CORRUPT_IMAGE" }] },
        },
        { status: 422 },
      ),
    );
    const upload = preparePurchaseExperienceImageUpload({
      contextId: "70000000-0000-4000-8000-000000000001",
      file: new File(["image"], "experience.png", { type: "image/png" }),
      fetcher,
    });

    await expect(upload.run()).rejects.toEqual(
      expect.objectContaining<Partial<PurchaseExperienceMediaUploadError>>({
        userMessage: "فایل تصویر خراب است یا کامل خوانده نمی‌شود.",
        issueCode: "CORRUPT_IMAGE",
      }),
    );
  });

  it("creates an order-scoped upload context with one stable retry key", async () => {
    const context = {
      contextId: "70000000-0000-4000-8000-000000000001",
      expiresAt: "2026-09-02T12:00:00.000Z",
      maxItems: 4,
      maxBytesPerItem: 10 * 1024 * 1024,
      uploadUrl: "/v1/purchase-experience-media/70000000-0000-4000-8000-000000000001",
    } as const;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValueOnce(Response.json(context, { status: 201 }));
    const request = preparePurchaseExperienceMediaContext({
      orderItemId: "80000000-0000-4000-8000-000000000001",
      idempotencyKey: "stable-context-key",
      fetcher,
    });

    await expect(request.run()).rejects.toEqual(
      expect.objectContaining<Partial<PurchaseExperienceMediaUploadError>>({
        userMessage: "ارتباط برقرار نشد. دوباره تلاش کنید.",
      }),
    );
    await expect(request.run()).resolves.toEqual(context);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get("idempotency-key")).toBe(
        "stable-context-key",
      );
      expect(init?.body).toBe(
        JSON.stringify({
          orderItemId: "80000000-0000-4000-8000-000000000001",
        }),
      );
    }
  });

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
