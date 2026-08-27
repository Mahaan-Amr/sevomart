import type { MediaVariant } from "@sevo/contracts/media/v1";
import type { ObjectStoragePort, StoredMedia } from "../public";

export class FakeObjectStorage implements ObjectStoragePort {
  readonly #objects = new Map<string, StoredMedia>();

  async put(object: StoredMedia): Promise<void> {
    if (
      object.purpose === "CONVERSATION_ATTACHMENT" &&
      (object.visibility !== "PRIVATE" || !object.ownerReferenceId)
    )
      throw new Error("Conversation attachments must be private and bound to a thread");
    this.#objects.set(object.key, {
      ...object,
      bytes: object.bytes.slice(),
      variants: object.variants.map((variant) => ({
        ...variant,
        bytes: variant.bytes.slice(),
      })),
    });
  }

  async get(key: string, requestedVariant?: MediaVariant) {
    const object = this.#objects.get(key);
    if (!object) return undefined;
    const canonical =
      object.purpose === "CONVERSATION_ATTACHMENT"
        ? "attachment-preview"
        : object.purpose === "STORE_LOGO"
          ? "logo-large"
          : object.purpose === "STORE_COVER"
            ? "cover-desktop"
            : "product-detail";
    const variant = object.variants.find(
      (candidate) => candidate.name === (requestedVariant ?? canonical),
    );
    if (!variant) return undefined;
    return {
      ...object,
      contentType: variant.contentType,
      bytes: variant.bytes.slice(),
      variant: variant.name,
      variants: undefined,
    };
  }

  async inspect(key: string) {
    const object = this.#objects.get(key);
    if (!object) return undefined;
    return {
      key: object.key,
      purpose: object.purpose,
      contentType: object.contentType,
      checksum: object.checksum,
      width: object.width,
      height: object.height,
      ownerSellerId: object.ownerSellerId,
      ownerReferenceId: object.ownerReferenceId,
      visibility: object.visibility,
    };
  }

  async makePublic(key: string, ownerSellerId: string): Promise<void> {
    const object = this.#objects.get(key);
    if (
      !object ||
      object.ownerSellerId !== ownerSellerId ||
      object.purpose === "CONVERSATION_ATTACHMENT"
    ) {
      throw new Error("Media is not owned by the publishing seller");
    }
    this.#objects.set(key, { ...object, visibility: "PUBLIC" });
  }

  async makePrivate(key: string, ownerSellerId: string): Promise<void> {
    const object = this.#objects.get(key);
    if (!object || object.ownerSellerId !== ownerSellerId) {
      throw new Error("Media is not owned by the editing seller");
    }
    this.#objects.set(key, { ...object, visibility: "PRIVATE" });
  }
}
