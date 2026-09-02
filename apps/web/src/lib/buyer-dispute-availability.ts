import type { FulfillmentTimeline } from "@sevo/contracts/fulfillment/v1";
import {
  DISPUTE_DELIVERED_OPEN_WINDOW_DAYS,
  DISPUTE_SHIPPED_OPEN_WINDOW_DAYS,
} from "@sevo/contracts/problem-follow-up/v1";

type Availability =
  | { state: "NOT_STARTED" }
  | { state: "ELIGIBLE"; closesAt: string }
  | { state: "CLOSED"; closesAt: string };

const DAY_MS = 24 * 60 * 60 * 1_000;

export function buyerDisputeAvailability(
  fulfillment: FulfillmentTimeline | undefined,
  now = new Date(),
): Availability {
  if (!fulfillment) return { state: "NOT_STARTED" };
  const delivered = [...fulfillment.timeline]
    .reverse()
    .find((entry) => entry.status === "DELIVERED");
  const shipped = [...fulfillment.timeline]
    .reverse()
    .find((entry) => entry.status === "SHIPPED");
  const anchor = delivered ?? shipped;
  if (!anchor) return { state: "NOT_STARTED" };
  const days = delivered
    ? DISPUTE_DELIVERED_OPEN_WINDOW_DAYS
    : DISPUTE_SHIPPED_OPEN_WINDOW_DAYS;
  const closesAt = new Date(
    Date.parse(anchor.occurredAt) + days * DAY_MS,
  ).toISOString();
  return now.getTime() > Date.parse(closesAt)
    ? { state: "CLOSED", closesAt }
    : { state: "ELIGIBLE", closesAt };
}
