import {
  BuyerDisputeMediaAccessDeniedError,
  type BuyerDisputeMedia,
  type BuyerDisputeMediaAccess,
  type MediaStorage,
} from "./public";

const UPLOAD_CONTEXT_LIFETIME_MS = 30 * 60 * 1000;

export class BuyerDisputeMediaService implements BuyerDisputeMedia {
  constructor(
    private readonly storage: MediaStorage,
    private readonly access: BuyerDisputeMediaAccess,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issueUploadContext(
    input: Parameters<BuyerDisputeMedia["issueUploadContext"]>[0],
  ) {
    if (!(await this.access(input))) {
      throw new BuyerDisputeMediaAccessDeniedError();
    }
    const expiresAt = new Date(this.now().getTime() + UPLOAD_CONTEXT_LIFETIME_MS);
    const context = await this.storage.issueBuyerDisputeUploadContext({
      ...input,
      expiresAt,
    });
    return { contextId: context.contextId, expiresAt: context.expiresAt.toISOString() };
  }

  readUploadContext(contextId: Parameters<BuyerDisputeMedia["readUploadContext"]>[0]) {
    return this.storage.readBuyerDisputeUploadContext(contextId);
  }
}
