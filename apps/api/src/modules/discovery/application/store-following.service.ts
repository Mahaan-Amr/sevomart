import type { StoreAuthoritativeRead } from "../../store/public";
import {
  FollowStoreNotFoundError,
  SelfFollowNotAllowedError,
  type StoreFollowing,
  type StoreFollowRepository,
  type StoreFollowWrite,
  type StoredFollowWriteResult,
} from "../public";

type FollowCommand = Omit<StoreFollowWrite, "operation">;

export class StoreFollowingService implements StoreFollowing {
  constructor(
    private readonly repository: StoreFollowRepository,
    private readonly stores: StoreAuthoritativeRead,
  ) {}

  async activate(command: FollowCommand): Promise<StoredFollowWriteResult> {
    const store = await this.stores.readStore(command.storeId);
    if (!store || store.publicationStatus !== "PUBLISHED") {
      throw new FollowStoreNotFoundError();
    }
    if (store.owner.identityId === command.identityId) {
      throw new SelfFollowNotAllowedError();
    }
    return this.repository.write({ ...command, operation: "ACTIVATE" });
  }

  deactivate(command: FollowCommand): Promise<StoredFollowWriteResult> {
    return this.repository.write({ ...command, operation: "DEACTIVATE" });
  }
}
