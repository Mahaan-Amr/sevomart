import type { StoreAuthoritativeRead } from "../store/public";
import type { StoreId } from "@sevo/contracts/platform/v1";

export class DiscoveryStoreContractConsumer {
  constructor(private readonly stores: StoreAuthoritativeRead) {}

  async readPublishedStore(storeId: StoreId) {
    const store = await this.stores.readStore(storeId);
    if (!store || store.publicationStatus !== "PUBLISHED" || !store.slug) {
      return undefined;
    }
    return {
      storeId: store.storeId,
      publicationVersion: store.publicationVersion,
      publicationStatus: store.publicationStatus,
      slug: store.slug,
      displayIdentity: store.displayIdentity,
    };
  }
}
