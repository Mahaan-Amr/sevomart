import { buyerDisputePageContract } from "@sevo/contracts/problem-follow-up/v1";
import { describe, expect, it, vi } from "vitest";

import { ProblemFollowUpService } from "../../apps/api/src/modules/problem-follow-up/application/problem-follow-up.service";
import type {
  ProblemFollowUpFulfillmentRead,
  ProblemFollowUpRepository,
  ProblemFollowUpSessionRead,
} from "../../apps/api/src/modules/problem-follow-up/public";

const identityId = "0fc8f4a0-0cf8-4df0-9fde-82234ef66413";
const page = buyerDisputePageContract.parse({ items: [], nextCursor: null });

describe("ProblemFollowUpService buyer dispute list", () => {
  it("lists only cases owned by the active buyer identity", async () => {
    const listBuyer = vi.fn().mockResolvedValue(page);
    const service = new ProblemFollowUpService(
      { listBuyer } as unknown as ProblemFollowUpRepository,
      {
        readActiveIdentitySession: vi.fn().mockResolvedValue({ identityId }),
      } as ProblemFollowUpSessionRead,
      {} as ProblemFollowUpFulfillmentRead,
    );

    await expect(
      service.listBuyer({ sessionToken: "buyer", correlationId: "request-1" }),
    ).resolves.toEqual(page);
    expect(listBuyer).toHaveBeenCalledWith(identityId, { limit: 25 });
  });
});
