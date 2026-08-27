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

export const canonicalWorkerRegistry: readonly {
  owner: string;
  handlers: readonly WorkerHandler[];
}[] = [
  { owner: "identity-access", handlers: identity_access_workerHandlers },
  { owner: "store", handlers: store_workerHandlers },
  { owner: "product", handlers: product_workerHandlers },
  { owner: "inventory", handlers: inventory_workerHandlers },
  { owner: "orders", handlers: orders_workerHandlers },
  { owner: "payments", handlers: payments_workerHandlers },
  { owner: "fulfillment", handlers: fulfillment_workerHandlers },
  { owner: "conversations", handlers: conversations_workerHandlers },
  { owner: "problem-follow-up", handlers: problem_follow_up_workerHandlers },
  { owner: "content", handlers: content_workerHandlers },
  { owner: "discovery", handlers: discovery_workerHandlers },
  { owner: "media", handlers: media_workerHandlers },
  { owner: "notifications", handlers: notifications_workerHandlers },
  { owner: "reporting-analytics", handlers: reporting_analytics_workerHandlers },
];

export const canonicalWorkerHandlers: readonly WorkerHandler[] =
  canonicalWorkerRegistry.flatMap(({ handlers }) => handlers);
