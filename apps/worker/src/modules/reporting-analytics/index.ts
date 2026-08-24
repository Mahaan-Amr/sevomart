import { storePublishedV1Contract } from "@sevo/contracts/store/v1";
import { DurableOutboxWorker, type OutboxEventHandler } from "@sevo/outbox";

import type { WorkerHandler } from "../public";

export const projectStorePublication: OutboxEventHandler = async (event, sql) => {
  const publication = storePublishedV1Contract.parse(event);
  await sql`
    insert into reporting_store_publications
      (store_id, last_event_id, publication_version, published_at, projected_at)
    values
      (${publication.payload.storeId}, ${publication.eventId},
       ${publication.payload.publicationVersion ?? publication.aggregateVersion},
       ${publication.occurredAt}, now())
    on conflict (store_id) do update set
      last_event_id = excluded.last_event_id,
      publication_version = excluded.publication_version,
      published_at = excluded.published_at,
      projected_at = excluded.projected_at
    where reporting_store_publications.publication_version
      < excluded.publication_version
  `;
};

const storePublicationProjectionWorker: WorkerHandler = {
  async start(environment) {
    const worker = new DurableOutboxWorker(environment.DATABASE_URL, {
      consumerName: "reporting-store-publications-v1",
      handlers: { "StorePublished.v1": projectStorePublication },
    });
    await worker.start();
    return () => worker.close();
  },
};

export const reporting_analytics_workerHandlers: readonly WorkerHandler[] = [
  storePublicationProjectionWorker,
];
