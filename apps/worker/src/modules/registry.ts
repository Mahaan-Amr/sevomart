import { content_workerHandlers } from "./content/index";
import { conversations_workerHandlers } from "./conversations/index";
import { discovery_workerHandlers } from "./discovery/index";
import { fulfillment_workerHandlers } from "./fulfillment/index";
import { identity_access_workerHandlers } from "./identity-access/index";
import { inventory_workerHandlers } from "./inventory/index";
import { media_workerHandlers } from "./media/index";
import { notifications_workerHandlers } from "./notifications/index";
import { orders_workerHandlers } from "./orders/index";
import { payments_workerHandlers } from "./payments/index";
import { problem_follow_up_workerHandlers } from "./problem-follow-up/index";
import { product_workerHandlers } from "./product/index";
import { reporting_analytics_workerHandlers } from "./reporting-analytics/index";
import { store_workerHandlers } from "./store/index";
import type { WorkerHandler } from "./public";

export const canonicalWorkerHandlers: readonly WorkerHandler[] = [
  ...identity_access_workerHandlers,
  ...store_workerHandlers,
  ...product_workerHandlers,
  ...inventory_workerHandlers,
  ...orders_workerHandlers,
  ...payments_workerHandlers,
  ...fulfillment_workerHandlers,
  ...conversations_workerHandlers,
  ...problem_follow_up_workerHandlers,
  ...content_workerHandlers,
  ...discovery_workerHandlers,
  ...media_workerHandlers,
  ...notifications_workerHandlers,
  ...reporting_analytics_workerHandlers,
];
