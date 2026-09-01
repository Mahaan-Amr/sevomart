import { mediaIdContract } from "@sevo/contracts/media/v1";
import { identityIdContract } from "@sevo/contracts/platform/v1";
import { describe, expect, it } from "vitest";

import type { MediaStorage } from "../media/public";
import { createContentMediaRead } from "./composition";

describe("content media composition", () => {
  it("keeps conversation attachments outside publishable content", async () => {
    const mediaId = mediaIdContract.parse("40000000-0000-4000-8000-000000000091");
    const identityId = identityIdContract.parse("10000000-0000-4000-8000-000000000091");
    const media: MediaStorage = {
      async inspect() {
        return {
          key: mediaId,
          purpose: "CONVERSATION_ATTACHMENT",
          contentType: "image/png",
          checksum: "a".repeat(64),
          width: 1,
          height: 1,
          ownerSellerId: identityId,
          ownerReferenceId: "thread-91",
          visibility: "PRIVATE",
        };
      },
      async put() {},
      async get() {
        return undefined;
      },
      async makePublic() {},
      async makePrivate() {},
    };

    await expect(
      createContentMediaRead(media).readOwnedKind(mediaId, identityId),
    ).resolves.toBeUndefined();
  });
});
