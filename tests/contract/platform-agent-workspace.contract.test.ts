import {
  platformAgentWorkspaceSessionContract,
  platformAgentWorkspaceV1Paths,
} from "@sevo/contracts/identity-access/v1";
import { describe, expect, it } from "vitest";

describe("platform agent workspace v1 contract", () => {
  it("publishes live workspace-session and logout paths", () => {
    expect(platformAgentWorkspaceV1Paths).toEqual({
      readSession: "/v1/platform/auth/session",
      logout: "/v1/platform/auth/logout",
    });
  });

  it("accepts every distinct live permission in stable order", () => {
    expect(
      platformAgentWorkspaceSessionContract.parse({
        actor: {
          identityId: "9921f18f-187f-40dd-a389-1626156366f8",
          audience: "PLATFORM_AGENT",
        },
        permissions: ["PAYMENT_REVIEW", "SELLER_APPLICATION_REVIEW"],
        expiresAt: "2026-08-29T17:00:00.000Z",
      }),
    ).toEqual({
      actor: {
        identityId: "9921f18f-187f-40dd-a389-1626156366f8",
        audience: "PLATFORM_AGENT",
      },
      permissions: ["PAYMENT_REVIEW", "SELLER_APPLICATION_REVIEW"],
      expiresAt: "2026-08-29T17:00:00.000Z",
    });

    expect(
      platformAgentWorkspaceSessionContract.safeParse({
        actor: {
          identityId: "9921f18f-187f-40dd-a389-1626156366f8",
          audience: "PLATFORM_AGENT",
        },
        permissions: ["PAYMENT_REVIEW", "PAYMENT_REVIEW"],
        expiresAt: "2026-08-29T17:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
