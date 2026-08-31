import postgres from "postgres";

import {
  convergeIdentityAccessDemoState,
  retireIdentityAccessDemoState,
} from "../../apps/api/src/modules/identity-access/demo-seed.adapter.mjs";
import {
  convergeStoreDemoState,
  retireStoreDemoState,
} from "../../apps/api/src/modules/store/demo-seed.adapter.mjs";
import {
  convergeProductDemoState,
  retireProductDemoState,
} from "../../apps/api/src/modules/product/demo-seed.adapter.mjs";
import {
  convergeInventoryDemoState,
  retireInventoryDemoState,
} from "../../apps/api/src/modules/inventory/demo-seed.adapter.mjs";
import { createMediaDemoSeedAdapter } from "../../apps/api/src/modules/media/demo-seed.adapter.mjs";
import {
  convergeOrderFulfillmentProjections,
  convergeOrdersDemoState,
  retireOrdersDemoState,
} from "../../apps/api/src/modules/orders/demo-seed.adapter.mjs";
import {
  convergePaymentsDemoState,
  retirePaymentsDemoState,
} from "../../apps/api/src/modules/payments/demo-seed.adapter.mjs";
import {
  convergeFulfillmentDemoState,
  retireFulfillmentDemoState,
} from "../../apps/api/src/modules/fulfillment/demo-seed.adapter.mjs";
import {
  convergeContentDemoState,
  retireContentDemoState,
} from "../../apps/api/src/modules/content/demo-seed.adapter.mjs";
import {
  convergeConversationsDemoState,
  retireConversationsDemoState,
} from "../../apps/api/src/modules/conversations/demo-seed.adapter.mjs";
import {
  convergeProblemFollowUpDemoState,
  retireProblemFollowUpDemoState,
} from "../../apps/api/src/modules/problem-follow-up/demo-seed.adapter.mjs";
import {
  convergeDiscoveryDemoState,
  retireDiscoveryDemoState,
} from "../../apps/api/src/modules/discovery/demo-seed.adapter.mjs";
import {
  convergeReportingDemoState,
  retireReportingDemoState,
} from "../../apps/api/src/modules/reporting-analytics/demo-seed.adapter.mjs";
import {
  buildDemoBaseline,
  manifestResources,
  manifestSummary,
  stableDemoId,
} from "./baseline.mjs";

export function createPostgresDemoSeedDatabase(databaseUrl) {
  const sql = postgres(databaseUrl, { max: 2 });
  const media = createMediaDemoSeedAdapter();
  return {
    async inspectTarget() {
      const [target] = await sql`
        select database_name as "databaseName", fingerprint::text, profile
        from platform_data_environment where singleton = true
      `;
      if (!target) throw new Error("Database target fingerprint is not registered");
      return target;
    },

    async withNamespaceLock(namespace, operation) {
      const connection = await sql.reserve();
      try {
        const [lock] = await connection`
          select pg_try_advisory_lock(hashtextextended(${namespace}, 0)) as acquired
        `;
        if (!lock?.acquired)
          throw new Error(`demo:seed is already running for namespace ${namespace}`);
        return await operation();
      } finally {
        await connection`select pg_advisory_unlock(hashtextextended(${namespace}, 0))`;
        connection.release();
      }
    },

    async planManifest(manifest) {
      const desired = manifestResources(manifest);
      const current = await sql`
        select resource_key as key, resource_id as id, content_checksum as checksum, status
        from platform_seed_resources where namespace = ${manifest.namespace}
      `;
      const existing = new Map(current.map((item) => [item.key, item]));
      const desiredKeys = new Set(desired.map(({ key }) => key));
      const counts = { created: 0, updated: 0, retired: 0, unchanged: 0 };
      for (const resource of desired) {
        const previous = existing.get(resource.key);
        if (!previous || previous.status === "RETIRED") counts.created += 1;
        else if (previous.checksum !== resource.checksum) counts.updated += 1;
        else counts.unchanged += 1;
      }
      counts.retired = current.filter(
        ({ key, status }) => status === "ACTIVE" && !desiredKeys.has(key),
      ).length;
      return { counts, entities: manifestSummary(manifest) };
    },

    async applyManifest(manifest, now, report) {
      const baseline = buildDemoBaseline(manifest, now);
      const mediaObjects = await media.prepare(manifest, baseline);
      let retiredObjectKeys = [];
      await sql.begin(async (transaction) => {
        const desired = manifestResources(manifest);
        const desiredKeys = desired.map(({ key }) => key);
        const retired = await transaction`
          select resource_key as key, resource_id as id from platform_seed_resources
          where namespace = ${manifest.namespace} and status = 'ACTIVE'
            and resource_key <> all(${desiredKeys})
        `;
        const retirement = { sql: transaction, retired, id: stableDemoId, now };
        await retireReportingDemoState(retirement);
        await retireDiscoveryDemoState(retirement);
        await retireProblemFollowUpDemoState(retirement);
        await retireConversationsDemoState(retirement);
        await retireContentDemoState(retirement);
        retiredObjectKeys = await media.retire(retirement);
        await retireFulfillmentDemoState(retirement);
        await retirePaymentsDemoState(retirement);
        await retireOrdersDemoState(retirement);
        const inventoryTargets = await retireProductDemoState(retirement);
        await retireInventoryDemoState({ ...retirement, targets: inventoryTargets });
        await retireStoreDemoState(retirement);
        await retireIdentityAccessDemoState(retirement);

        const convergence = { sql: transaction, manifest, baseline };
        await convergeIdentityAccessDemoState(convergence);
        await media.converge({ ...convergence, mediaObjects });
        await convergeStoreDemoState(convergence);
        await convergeProductDemoState(convergence);
        await convergeInventoryDemoState(convergence);
        await convergeOrdersDemoState(convergence);
        await convergePaymentsDemoState(convergence);
        const fulfillmentStates = await convergeFulfillmentDemoState(convergence);
        await convergeContentDemoState(convergence);
        await convergeConversationsDemoState(convergence);
        await convergeProblemFollowUpDemoState(convergence);
        await convergeDiscoveryDemoState(convergence);
        await convergeOrderFulfillmentProjections({
          ...convergence,
          fulfillmentStates,
        });
        await convergeReportingDemoState({ ...convergence, fulfillmentStates });

        await transaction`
          update platform_seed_resources set status = 'RETIRED',
            manifest_version = ${manifest.manifestVersion}, updated_at = ${now}
          where namespace = ${manifest.namespace} and status = 'ACTIVE'
            and resource_key <> all(${desiredKeys})
        `;
        for (const resource of desired) {
          await transaction`
            insert into platform_seed_resources
              (namespace, resource_key, resource_id, manifest_version,
               content_checksum, status, updated_at)
            values (${manifest.namespace}, ${resource.key}, ${resource.id},
              ${manifest.manifestVersion}, ${resource.checksum}, 'ACTIVE', ${now})
            on conflict (namespace, resource_key) do update set
              resource_id = excluded.resource_id,
              manifest_version = excluded.manifest_version,
              content_checksum = excluded.content_checksum,
              status = 'ACTIVE', updated_at = excluded.updated_at
          `;
        }
        await transaction`
          insert into platform_seed_manifest_receipts
            (namespace, manifest_version, target_fingerprint, report, applied_at)
          select ${report.namespace}, ${report.manifestVersion}, fingerprint,
            ${transaction.json(report)}, ${now}
          from platform_data_environment where singleton = true
          on conflict (namespace) do update set
            manifest_version = excluded.manifest_version,
            target_fingerprint = excluded.target_fingerprint,
            report = excluded.report, applied_at = excluded.applied_at
        `;
      });
      await media.removeObjects(retiredObjectKeys);
    },

    async close() {
      await sql.end({ timeout: 1 });
    },
  };
}

export { stableDemoId };
