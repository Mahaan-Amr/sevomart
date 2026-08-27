import {
  assertApiModuleArtifact,
  canonicalApiModuleRegistry,
} from "../../apps/api/src/composition/module-registry";
import { ConversationsModule } from "../../apps/api/src/modules/conversations/composition";
import { ContentModule } from "../../apps/api/src/modules/content/composition";
import { DiscoveryModule } from "../../apps/api/src/modules/discovery/composition";
import { FulfillmentModule } from "../../apps/api/src/modules/fulfillment/composition";
import { IdentityAccessModule } from "../../apps/api/src/modules/identity-access/composition";
import { InventoryModule } from "../../apps/api/src/modules/inventory/composition";
import { MediaModule } from "../../apps/api/src/modules/media/composition";
import { NotificationsModule } from "../../apps/api/src/modules/notifications/composition";
import { OrdersModule } from "../../apps/api/src/modules/orders/composition";
import { PaymentsModule } from "../../apps/api/src/modules/payments/composition";
import { ProblemFollowUpModule } from "../../apps/api/src/modules/problem-follow-up/composition";
import { ProductModule } from "../../apps/api/src/modules/product/composition";
import { ReportingAnalyticsModule } from "../../apps/api/src/modules/reporting-analytics/composition";
import { StoreModule } from "../../apps/api/src/modules/store/composition";
import { canonicalOpenApiRegistry } from "../../apps/api/src/openapi/compose-openapi";
import { contributeApiErrorsOpenApi } from "../../apps/api/src/openapi/modules/api-errors";
import { contribute_content_openApi } from "../../apps/api/src/openapi/modules/content";
import { contribute_conversations_openApi } from "../../apps/api/src/openapi/modules/conversations";
import { contribute_discovery_openApi } from "../../apps/api/src/openapi/modules/discovery";
import { contribute_fulfillment_openApi } from "../../apps/api/src/openapi/modules/fulfillment";
import { contribute_identity_access_openApi } from "../../apps/api/src/openapi/modules/identity-access";
import { contribute_inventory_openApi } from "../../apps/api/src/openapi/modules/inventory";
import { contribute_media_openApi } from "../../apps/api/src/openapi/modules/media";
import { contribute_notifications_openApi } from "../../apps/api/src/openapi/modules/notifications";
import { contribute_orders_openApi } from "../../apps/api/src/openapi/modules/orders";
import { contribute_payments_openApi } from "../../apps/api/src/openapi/modules/payments";
import { contribute_problem_follow_up_openApi } from "../../apps/api/src/openapi/modules/problem-follow-up";
import { contribute_product_openApi } from "../../apps/api/src/openapi/modules/product";
import { contribute_reporting_analytics_openApi } from "../../apps/api/src/openapi/modules/reporting-analytics";
import { contribute_store_openApi } from "../../apps/api/src/openapi/modules/store";
import { content_workerHandlers } from "../../apps/worker/src/modules/content/index";
import { conversations_workerHandlers } from "../../apps/worker/src/modules/conversations/index";
import { discovery_workerHandlers } from "../../apps/worker/src/modules/discovery/index";
import { fulfillment_workerHandlers } from "../../apps/worker/src/modules/fulfillment/index";
import { identity_access_workerHandlers } from "../../apps/worker/src/modules/identity-access/index";
import { inventory_workerHandlers } from "../../apps/worker/src/modules/inventory/index";
import { media_workerHandlers } from "../../apps/worker/src/modules/media/index";
import { notifications_workerHandlers } from "../../apps/worker/src/modules/notifications/index";
import { orders_workerHandlers } from "../../apps/worker/src/modules/orders/index";
import { payments_workerHandlers } from "../../apps/worker/src/modules/payments/index";
import { problem_follow_up_workerHandlers } from "../../apps/worker/src/modules/problem-follow-up/index";
import { product_workerHandlers } from "../../apps/worker/src/modules/product/index";
import { reporting_analytics_workerHandlers } from "../../apps/worker/src/modules/reporting-analytics/index";
import { canonicalWorkerRegistry } from "../../apps/worker/src/modules/registry";
import { store_workerHandlers } from "../../apps/worker/src/modules/store/index";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Ownership = {
  modules: string[];
  infrastructureOwners: string[];
  contracts: Record<string, string>;
};

const ownership = JSON.parse(
  readFileSync("docs/architecture/module-ownership.json", "utf8"),
) as Ownership;
const lifecycle = JSON.parse(
  readFileSync("docs/architecture/contract-lifecycle.json", "utf8"),
) as { contracts: Record<string, { owner: string }> };
const contractPackage = JSON.parse(
  readFileSync("packages/contracts/package.json", "utf8"),
) as { exports: Record<string, unknown> };

function expectExactlyOneSlot(
  actual: readonly { owner: string }[],
  expectedOwners: readonly string[],
) {
  const owners = actual.map(({ owner }) => owner);
  expect(new Set(owners).size).toBe(owners.length);
  expect([...owners].sort()).toEqual([...expectedOwners].sort());
}

function expectOwnerArtifacts(
  actual: readonly Record<string, unknown>[],
  artifactKey: string,
  expected: Record<string, unknown>,
) {
  expect(
    Object.fromEntries(actual.map((slot) => [slot.owner, slot[artifactKey]])),
  ).toEqual(expected);
}

describe("canonical composition registries", () => {
  it("rejects an API slot whose composer returns another owner's artifact", () => {
    class ExpectedModule {}
    class UnexpectedModule {}

    expect(
      assertApiModuleArtifact(
        { owner: "expected", artifact: ExpectedModule },
        ExpectedModule,
      ),
    ).toBe(ExpectedModule);
    expect(
      assertApiModuleArtifact(
        { owner: "expected", artifact: ExpectedModule },
        { module: ExpectedModule },
      ),
    ).toEqual({ module: ExpectedModule });
    expect(() =>
      assertApiModuleArtifact(
        { owner: "expected", artifact: ExpectedModule },
        UnexpectedModule,
      ),
    ).toThrow("API composition slot expected returned a different module artifact");
  });

  it("keeps lifecycle and package exports aligned with single contract owners", () => {
    expect(
      Object.fromEntries(
        Object.entries(lifecycle.contracts).map(([contract, { owner }]) => [
          contract,
          owner,
        ]),
      ),
    ).toEqual(ownership.contracts);

    const canonicalPackageExports = Object.keys(ownership.contracts).map((contract) =>
      contract.replace("@sevo/contracts", "."),
    );
    expect(Object.keys(contractPackage.exports).sort()).toEqual(
      [".", "./health", ...canonicalPackageExports].sort(),
    );
  });

  it("composes every API module through one producer-owned slot", () => {
    expectExactlyOneSlot(canonicalApiModuleRegistry, ownership.modules);
    expectOwnerArtifacts(canonicalApiModuleRegistry, "artifact", {
      "identity-access": IdentityAccessModule,
      media: MediaModule,
      store: StoreModule,
      product: ProductModule,
      inventory: InventoryModule,
      orders: OrdersModule,
      payments: PaymentsModule,
      fulfillment: FulfillmentModule,
      conversations: ConversationsModule,
      "problem-follow-up": ProblemFollowUpModule,
      content: ContentModule,
      discovery: DiscoveryModule,
      notifications: NotificationsModule,
      "reporting-analytics": ReportingAnalyticsModule,
    });
  });

  it("composes every worker module through one producer-owned slot", () => {
    expectExactlyOneSlot(canonicalWorkerRegistry, ownership.modules);
    expectOwnerArtifacts(canonicalWorkerRegistry, "handlers", {
      "identity-access": identity_access_workerHandlers,
      store: store_workerHandlers,
      product: product_workerHandlers,
      inventory: inventory_workerHandlers,
      orders: orders_workerHandlers,
      payments: payments_workerHandlers,
      fulfillment: fulfillment_workerHandlers,
      conversations: conversations_workerHandlers,
      "problem-follow-up": problem_follow_up_workerHandlers,
      content: content_workerHandlers,
      discovery: discovery_workerHandlers,
      media: media_workerHandlers,
      notifications: notifications_workerHandlers,
      "reporting-analytics": reporting_analytics_workerHandlers,
    });
  });

  it("composes every domain and platform OpenAPI fragment through one slot", () => {
    expectExactlyOneSlot(canonicalOpenApiRegistry, [
      ...ownership.modules,
      ...ownership.infrastructureOwners,
    ]);
    expectOwnerArtifacts(canonicalOpenApiRegistry, "contribute", {
      "identity-access": contribute_identity_access_openApi,
      store: contribute_store_openApi,
      product: contribute_product_openApi,
      inventory: contribute_inventory_openApi,
      orders: contribute_orders_openApi,
      payments: contribute_payments_openApi,
      fulfillment: contribute_fulfillment_openApi,
      conversations: contribute_conversations_openApi,
      "problem-follow-up": contribute_problem_follow_up_openApi,
      content: contribute_content_openApi,
      discovery: contribute_discovery_openApi,
      media: contribute_media_openApi,
      notifications: contribute_notifications_openApi,
      "reporting-analytics": contribute_reporting_analytics_openApi,
      platform: contributeApiErrorsOpenApi,
    });
  });
});
