import { describe, expect, it, vi } from "vitest";

import { ProblemFollowUpController } from "../../apps/api/src/modules/problem-follow-up/problem-follow-up.controller";
import type { ProblemFollowUpService } from "../../apps/api/src/modules/problem-follow-up/application/problem-follow-up.service";

describe("problem follow-up controller", () => {
  it("decodes the Persian sensitive-access reason before the audited reveal", async () => {
    const readPlatformViolation = vi.fn().mockResolvedValue({ ok: true });
    const controller = new ProblemFollowUpController({
      readPlatformViolation,
    } as unknown as ProblemFollowUpService);
    const response = { header: vi.fn() };
    const reason = "بررسی مدرک پرونده تخلف برای تعیین اقدام بعدی";

    await expect(
      controller.readPlatformViolation(
        "5df3e69a-4d9c-4c5b-9bf2-75af372e18e4",
        "555c67ad-b996-4165-b639-ce080f7a0225",
        encodeURIComponent(reason),
        {
          id: "request-160",
          headers: { cookie: "sevo_platform_session=agent-token" },
        } as never,
        response as never,
      ),
    ).resolves.toEqual({ ok: true });
    expect(readPlatformViolation).toHaveBeenCalledWith(
      {
        sessionToken: "agent-token",
        correlationId: expect.any(String),
      },
      "5df3e69a-4d9c-4c5b-9bf2-75af372e18e4",
      {
        grantId: "555c67ad-b996-4165-b639-ce080f7a0225",
        reason,
      },
    );
    expect(response.header).toHaveBeenCalledWith("cache-control", "no-store");
  });
});
