import type { OpenAPIObject } from "@nestjs/swagger";

import { contributeApiErrorsOpenApi } from "./modules/api-errors";
import { contribute_content_openApi } from "./modules/content";
import { contribute_conversations_openApi } from "./modules/conversations";
import { contribute_discovery_openApi } from "./modules/discovery";
import { contribute_fulfillment_openApi } from "./modules/fulfillment";
import { contribute_identity_access_openApi } from "./modules/identity-access";
import { contribute_inventory_openApi } from "./modules/inventory";
import { contribute_media_openApi } from "./modules/media";
import { contribute_notifications_openApi } from "./modules/notifications";
import { contribute_orders_openApi } from "./modules/orders";
import { contribute_payments_openApi } from "./modules/payments";
import { contribute_problem_follow_up_openApi } from "./modules/problem-follow-up";
import { contribute_product_openApi } from "./modules/product";
import { contribute_reporting_analytics_openApi } from "./modules/reporting-analytics";
import { contribute_store_openApi } from "./modules/store";
import type { OpenApiContributor } from "./public";

export const canonicalOpenApiRegistry: readonly {
  owner: string;
  contribute: OpenApiContributor;
}[] = [
  { owner: "identity-access", contribute: contribute_identity_access_openApi },
  { owner: "store", contribute: contribute_store_openApi },
  { owner: "product", contribute: contribute_product_openApi },
  { owner: "inventory", contribute: contribute_inventory_openApi },
  { owner: "orders", contribute: contribute_orders_openApi },
  { owner: "payments", contribute: contribute_payments_openApi },
  { owner: "fulfillment", contribute: contribute_fulfillment_openApi },
  { owner: "conversations", contribute: contribute_conversations_openApi },
  {
    owner: "problem-follow-up",
    contribute: contribute_problem_follow_up_openApi,
  },
  { owner: "content", contribute: contribute_content_openApi },
  { owner: "discovery", contribute: contribute_discovery_openApi },
  { owner: "media", contribute: contribute_media_openApi },
  { owner: "notifications", contribute: contribute_notifications_openApi },
  {
    owner: "reporting-analytics",
    contribute: contribute_reporting_analytics_openApi,
  },
  { owner: "platform", contribute: contributeApiErrorsOpenApi },
];

export function composeOpenApi(document: OpenAPIObject): OpenAPIObject {
  return canonicalOpenApiRegistry.reduce(
    (composed, { contribute }) => contribute(composed),
    document,
  );
}
