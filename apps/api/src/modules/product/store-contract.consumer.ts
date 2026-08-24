import type { IdentityId, StoreId } from "@sevo/contracts/platform/v1";

import type { StoreAuthoritativeRead } from "../store/public";

export class ProductStoreContractConsumer {
  constructor(private readonly stores: StoreAuthoritativeRead) {}

  async requireProductPublicationStore(identityId: IdentityId, storeId: StoreId) {
    const store = await this.stores.requireOwnedSellable(identityId, storeId);
    return {
      storeId: store.storeId,
      storeRevision: store.revision,
      publicationVersion: store.publicationVersion,
    };
  }
}
