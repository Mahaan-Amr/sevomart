import { fulfillmentTimelineContract } from "@sevo/contracts/fulfillment/v1";

type FulfillmentTimeline = ReturnType<typeof fulfillmentTimelineContract.parse>;

export function isOverdueSellerPreparation(
  timeline: FulfillmentTimeline,
  now: Date,
  overdueAfterHours: number,
) {
  const preparingAt = timeline.timeline.findLast(
    ({ status }) => status === "PREPARING",
  )?.occurredAt;
  return (
    timeline.status === "PREPARING" &&
    preparingAt !== undefined &&
    Date.parse(preparingAt) <= now.getTime() - overdueAfterHours * 60 * 60 * 1_000
  );
}
