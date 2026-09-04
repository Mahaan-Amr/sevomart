import type { FulfillmentOrderSnapshot } from "@sevo/contracts/fulfillment/v1";
import {
  DISPUTE_DELIVERED_OPEN_WINDOW_DAYS,
  DISPUTE_SHIPPED_OPEN_WINDOW_DAYS,
} from "@sevo/contracts/problem-follow-up/v1";

const DAY_MS = 24 * 60 * 60 * 1_000;

export function buyerDisputeWindowClosesAt(snapshot: FulfillmentOrderSnapshot) {
  const anchor = new Date(
    snapshot.status === "DELIVERED" ? snapshot.deliveredAt : snapshot.shippedAt,
  );
  const days =
    snapshot.status === "DELIVERED"
      ? DISPUTE_DELIVERED_OPEN_WINDOW_DAYS
      : DISPUTE_SHIPPED_OPEN_WINDOW_DAYS;
  return new Date(anchor.getTime() + days * DAY_MS);
}

export function isBuyerDisputeWindowOpen(
  snapshot: FulfillmentOrderSnapshot,
  now: Date,
) {
  return now.getTime() <= buyerDisputeWindowClosesAt(snapshot).getTime();
}
