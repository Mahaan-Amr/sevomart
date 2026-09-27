import { describe, expect, it } from "vitest";

import {
  conversationDayKey,
  formatConversationDay,
  formatConversationTime,
} from "../../apps/web/src/lib/conversation-time";

describe("conversation time in Tehran", () => {
  it("groups messages by the buyer's local day across a UTC midnight", () => {
    expect(conversationDayKey("2026-09-26T20:29:00Z")).toBe(
      conversationDayKey("2026-09-26T10:00:00Z"),
    );
    expect(conversationDayKey("2026-09-26T20:31:00Z")).not.toBe(
      conversationDayKey("2026-09-26T20:29:00Z"),
    );
  });

  it("keeps the date in the day header and the clock in the bubble", () => {
    const timestamp = "2026-09-26T10:00:00Z";
    expect(formatConversationDay(timestamp)).not.toBe(
      formatConversationTime(timestamp),
    );
    expect(formatConversationTime(timestamp)).toMatch(/\d|[۰-۹]/);
    expect(formatConversationTime(timestamp)).not.toContain("۱۴۰۵");
  });
});
