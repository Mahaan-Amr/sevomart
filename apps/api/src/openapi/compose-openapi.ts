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

const canonicalModuleContributors: readonly OpenApiContributor[] = [
  contribute_identity_access_openApi,
  contribute_store_openApi,
  contribute_product_openApi,
  contribute_inventory_openApi,
  contribute_orders_openApi,
  contribute_payments_openApi,
  contribute_fulfillment_openApi,
  contribute_conversations_openApi,
  contribute_problem_follow_up_openApi,
  contribute_content_openApi,
  contribute_discovery_openApi,
  contribute_media_openApi,
  contribute_notifications_openApi,
  contribute_reporting_analytics_openApi,
  contributeApiErrorsOpenApi,
];

export function composeOpenApi(document: OpenAPIObject): OpenAPIObject {
  return canonicalModuleContributors.reduce(
    (composed, contribute) => contribute(composed),
    document,
  );
}
