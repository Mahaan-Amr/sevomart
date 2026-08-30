import type { FulfillmentStatus } from "@sevo/contracts/fulfillment/v1";

const nextStatusByCurrent: Readonly<
  Partial<Record<FulfillmentStatus, FulfillmentStatus>>
> = {
  ACTION_REQUIRED: "PREPARING",
  PREPARING: "SHIPPED",
  SHIPPED: "DELIVERED",
};

export function nextFulfillmentStatus(status: FulfillmentStatus) {
  return nextStatusByCurrent[status];
}
