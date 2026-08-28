import { afterEach, describe, expect, it, vi } from "vitest";

import { readSellerWorkspaceAccess } from "./seller-workspace-access";

describe("seller workspace access", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("admits an active seller from the live seller operation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readSellerWorkspaceAccess("sevo_session=active")).resolves.toEqual({
      kind: "ACTIVE",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/v1/seller/orders",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("sends an applicant without approved history to the application journey", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 403 }))
      .mockResolvedValueOnce(
        Response.json({ items: [], nextCursor: null }, { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readSellerWorkspaceAccess("sevo_session=applicant")).resolves.toEqual({
      kind: "APPLICANT",
    });
  });

  it("blocks a formerly approved seller whose live access is inactive", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 403 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            items: [
              {
                applicationId: "05100f04-813c-44f9-b681-22cb4f3dbeae",
                status: "APPROVED",
                currentRevision: 1,
                currentPayload: {
                  applicantName: "نگار محمدی",
                  proposedStoreName: "خانه ماه",
                  goodsAreaText: "سفال دست‌ساز",
                  currentSalesMethod: "فروش از راه اینستاگرام",
                },
                nextStep: "START_SELLER_WORKSPACE",
                createdAt: "2026-08-24T08:00:00.000Z",
                lastSubmittedAt: "2026-08-24T08:00:00.000Z",
                timeline: [],
              },
            ],
            nextCursor: null,
          },
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readSellerWorkspaceAccess("sevo_session=inactive")).resolves.toEqual({
      kind: "INACTIVE",
    });
  });

  it("does not invent an access state when the live check is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    );

    await expect(readSellerWorkspaceAccess("sevo_session=unknown")).resolves.toEqual({
      kind: "UNAVAILABLE",
    });
  });

  it("admits an active seller who has not created a store yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 404 })),
    );

    await expect(readSellerWorkspaceAccess("sevo_session=unknown")).resolves.toEqual({
      kind: "ACTIVE",
    });
  });

  it("fails closed for an unexpected response from the live access check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 429 })),
    );

    await expect(readSellerWorkspaceAccess("sevo_session=unknown")).resolves.toEqual({
      kind: "UNAVAILABLE",
    });
  });

  it("requires login when the live check rejects the session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );

    await expect(readSellerWorkspaceAccess("")).resolves.toEqual({
      kind: "SIGNED_OUT",
    });
  });
});
