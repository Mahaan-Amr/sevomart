import { describe, expect, it } from "vitest";

import { platformDisputeAction } from "./problem-follow-up-views";

describe("platformDisputeAction", () => {
  const now = new Date("2026-08-31T10:00:00.000Z");

  it("projects a resolution only after the seller deadline or during review", () => {
    expect(
      platformDisputeAction(
        {
          status: "AWAITING_SELLER_RESPONSE",
          deadline: {
            kind: "SELLER_FIRST_RESPONSE",
            dueAt: "2026-08-31T09:59:59.000Z",
          },
        },
        now,
      ),
    ).toBe("RESOLVE");
    expect(
      platformDisputeAction(
        {
          status: "AWAITING_SELLER_RESPONSE",
          deadline: {
            kind: "SELLER_FIRST_RESPONSE",
            dueAt: "2026-08-31T10:00:01.000Z",
          },
        },
        now,
      ),
    ).toBeNull();
    expect(platformDisputeAction({ status: "UNDER_REVIEW", deadline: null }, now)).toBe(
      "RESOLVE",
    );
  });

  it("projects reopening only while the server-owned window remains open", () => {
    expect(
      platformDisputeAction(
        {
          status: "RESOLVED",
          deadline: {
            kind: "REOPEN_WINDOW",
            dueAt: "2026-08-31T10:00:00.000Z",
          },
        },
        now,
      ),
    ).toBe("REOPEN");
    expect(
      platformDisputeAction(
        {
          status: "CLOSED",
          deadline: {
            kind: "REOPEN_WINDOW",
            dueAt: "2026-08-31T09:59:59.000Z",
          },
        },
        now,
      ),
    ).toBeNull();
  });
});
