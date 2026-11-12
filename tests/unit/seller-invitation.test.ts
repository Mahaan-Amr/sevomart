import { afterEach, describe, expect, it, vi } from "vitest";
import { identityAccessV1Examples } from "@sevo/contracts/identity-access/v1";
import {
  canInviteSeller,
  readSellerWorkspaceAccess,
  type SellerWorkspaceAccess,
} from "../../apps/web/src/lib/seller-workspace-access";

describe("seller invitation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    ["SIGNED_OUT", true],
    ["APPLICANT", true],
    ["ACTIVE", false],
    ["INACTIVE", false],
    ["UNAVAILABLE", false],
  ] as const)("handles %s safely", (kind, expected) => {
    expect(canInviteSeller({ kind } as SellerWorkspaceAccess)).toBe(expected);
  });

  it("hides the invitation if reading seller status fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    expect(canInviteSeller(await readSellerWorkspaceAccess("session=example"))).toBe(
      false,
    );
  });

  it("hides the invitation for an approved application without active access", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 403 }))
        .mockResolvedValueOnce(
          Response.json({
            items: [
              {
                ...identityAccessV1Examples.SellerApplicationView,
                status: "APPROVED",
                nextStep: "START_SELLER_WORKSPACE",
              },
            ],
            nextCursor: null,
          }),
        ),
    );
    expect(await readSellerWorkspaceAccess("session=example")).toEqual({
      kind: "INACTIVE",
    });
    expect(canInviteSeller({ kind: "INACTIVE" })).toBe(false);
  });
});
