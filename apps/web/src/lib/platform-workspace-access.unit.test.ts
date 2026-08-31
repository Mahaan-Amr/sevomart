import { afterEach, describe, expect, it, vi } from "vitest";

import {
  platformDestinationsFor,
  platformEntryPath,
  readPlatformWorkspaceAccess,
} from "./platform-workspace-access";

describe("platform workspace access", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads every live permission without caching the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          actor: {
            identityId: "9921f18f-187f-40dd-a389-1626156366f8",
            audience: "PLATFORM_AGENT",
          },
          permissions: ["PAYMENT_REVIEW", "SELLER_APPLICATION_REVIEW"],
          expiresAt: "2026-08-29T17:00:00.000Z",
        },
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readPlatformWorkspaceAccess("sevo_platform_session=agent"),
    ).resolves.toMatchObject({
      kind: "READY",
      session: {
        permissions: ["PAYMENT_REVIEW", "SELLER_APPLICATION_REVIEW"],
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/v1/platform/auth/session",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("distinguishes signed-out and unavailable session checks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("{}", { status: 401 })),
    );
    await expect(readPlatformWorkspaceAccess("")).resolves.toEqual({
      kind: "SIGNED_OUT",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("{}", { status: 503 })),
    );
    await expect(
      readPlatformWorkspaceAccess("sevo_platform_session=agent"),
    ).resolves.toEqual({ kind: "UNAVAILABLE" });
  });

  it("routes one permission directly and keeps multiple permissions at home", () => {
    expect(platformEntryPath(["SELLER_APPLICATION_REVIEW"])).toBe(
      "/platform/seller-applications",
    );
    expect(platformEntryPath(["PAYMENT_REVIEW"])).toBe("/platform/payment-reviews");
    expect(platformEntryPath(["VIOLATION_REVIEW"])).toBe("/platform/violations");
    expect(platformEntryPath(["DISPUTE_REVIEW"])).toBe("/platform/disputes");
    expect(platformEntryPath(["ACCESS_ADMINISTRATION"])).toBe("/platform/access");
    expect(platformEntryPath(["ACCESS_AUDIT_REVIEW"])).toBe("/platform/access");
    expect(
      platformEntryPath(["PAYMENT_REVIEW", "SELLER_APPLICATION_REVIEW"]),
    ).toBeNull();
    expect(platformEntryPath([])).toBeNull();
  });

  it("builds navigation only from the permissions present in this request", () => {
    expect(platformDestinationsFor(["PAYMENT_REVIEW"])).toEqual([
      {
        permission: "PAYMENT_REVIEW",
        href: "/platform/payment-reviews",
        label: "بررسی پرداخت‌ها",
        shortLabel: "پرداخت‌ها",
      },
    ]);
    expect(platformDestinationsFor([])).toEqual([]);
  });

  it("publishes the violation queue only for its live responsibility", () => {
    expect(platformDestinationsFor(["VIOLATION_REVIEW"])).toEqual([
      {
        permission: "VIOLATION_REVIEW",
        href: "/platform/violations",
        label: "بررسی پرونده‌های تخلف",
        shortLabel: "تخلف‌ها",
      },
    ]);
  });

  it("routes dispute reviewers to the dispute queue", () => {
    expect(platformEntryPath(["DISPUTE_REVIEW"])).toBe("/platform/disputes");
    expect(platformDestinationsFor(["DISPUTE_REVIEW"])).toEqual([
      {
        permission: "DISPUTE_REVIEW",
        href: "/platform/disputes",
        label: "رسیدگی به پرونده‌های اختلاف",
        shortLabel: "اختلاف‌ها",
      },
    ]);
  });

  it("shows one access destination when administration and audit review coexist", () => {
    expect(
      platformDestinationsFor(["ACCESS_ADMINISTRATION", "ACCESS_AUDIT_REVIEW"]),
    ).toEqual([
      {
        permission: "ACCESS_ADMINISTRATION",
        href: "/platform/access",
        label: "مدیریت دسترسی پلتفرم",
        shortLabel: "دسترسی‌ها",
      },
    ]);
  });
});
