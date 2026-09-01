import { createHash } from "node:crypto";

import {
  advanceFulfillmentInputContract,
  fulfillmentIdempotencyKeyContract,
  fulfillmentOrderSnapshotContract,
  fulfillmentOrderSnapshotInputContract,
} from "@sevo/contracts/fulfillment/v1";
import { identityIdContract, orderIdContract } from "@sevo/contracts/platform/v1";

import {
  FulfillmentFault,
  type FulfillmentOrderAccess,
  type FulfillmentRepository,
  type FulfillmentRequest,
  type FulfillmentSellerAccessRead,
  type FulfillmentSessionRead,
  type FulfillmentStoreResolver,
} from "../public";
import { nextFulfillmentStatus } from "./fulfillment-state";

export class FulfillmentService {
  constructor(
    private readonly repository: FulfillmentRepository,
    private readonly sessions: FulfillmentSessionRead,
    private readonly sellerAccess: FulfillmentSellerAccessRead,
    private readonly stores: FulfillmentStoreResolver,
    private readonly orders: FulfillmentOrderAccess,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async advance(
    request: FulfillmentRequest,
    orderIdInput: unknown,
    body: unknown,
    key: unknown,
  ) {
    const { actorId, storeId, orderId } = await this.requireSellerOrder(
      request,
      orderIdInput,
    );
    const parsedInput = advanceFulfillmentInputContract.safeParse(body);
    if (!parsedInput.success) throw new FulfillmentFault("VALIDATION_ERROR");
    const parsedKey = fulfillmentIdempotencyKeyContract.safeParse(key);
    if (!parsedKey.success) throw new FulfillmentFault("PRECONDITION_REQUIRED");
    const requestHash = hash(parsedInput.data);
    const replay = await this.repository.replayAdvance({
      orderId,
      actorId,
      idempotencyKey: parsedKey.data,
      requestHash,
    });
    if (replay) return replay;
    const current = await this.repository.read(orderId);
    if (!current) throw new FulfillmentFault("FULFILLMENT_NOT_FOUND");
    if (nextFulfillmentStatus(current.status) !== parsedInput.data.targetStatus) {
      throw new FulfillmentFault("INVALID_TRANSITION");
    }
    return this.repository.advance({
      orderId,
      actorId,
      storeId,
      correlationId: request.correlationId,
      causationId: request.correlationId,
      occurredAt: this.now(),
      idempotencyKey: parsedKey.data,
      requestHash,
      expectedStatus: current.status,
      input: parsedInput.data,
    });
  }

  async readSeller(request: FulfillmentRequest, orderIdInput: unknown) {
    const { orderId } = await this.requireSellerOrder(request, orderIdInput);
    const timeline = await this.repository.read(orderId);
    if (!timeline) throw new FulfillmentFault("FULFILLMENT_NOT_FOUND");
    return timeline;
  }

  async readBuyer(request: FulfillmentRequest, orderIdInput: unknown) {
    const actorId = await this.requireIdentity(request);
    const orderId = this.parseOrderId(orderIdInput);
    if (!(await this.orders.buyerCanTrack(actorId, orderId))) {
      throw new FulfillmentFault("FULFILLMENT_NOT_FOUND");
    }
    const timeline = await this.repository.read(orderId);
    if (!timeline) throw new FulfillmentFault("FULFILLMENT_NOT_FOUND");
    return timeline;
  }

  async readOrderSnapshot(input: unknown) {
    const parsed = fulfillmentOrderSnapshotInputContract.safeParse(input);
    if (!parsed.success) return undefined;
    const { orderId, buyerId } = parsed.data;
    if (!(await this.orders.buyerCanTrack(buyerId, orderId))) return undefined;
    const snapshot = await this.repository.readOrderSnapshot(orderId);
    if (!snapshot) return undefined;
    return fulfillmentOrderSnapshotContract.parse({
      version: 1,
      orderId,
      buyerId,
      ...snapshot,
    });
  }

  private async requireSellerOrder(request: FulfillmentRequest, orderIdInput: unknown) {
    const actorId = await this.requireIdentity(request);
    if (!(await this.sellerAccess.isActiveSeller(actorId))) {
      throw new FulfillmentFault("FORBIDDEN");
    }
    const storeId = await this.stores.resolveStore(actorId);
    if (!storeId) throw new FulfillmentFault("FORBIDDEN");
    const orderId = this.parseOrderId(orderIdInput);
    if (!(await this.orders.sellerCanAccessFulfillment(actorId, storeId, orderId))) {
      throw new FulfillmentFault("FULFILLMENT_NOT_FOUND");
    }
    return { actorId, storeId, orderId };
  }

  private async requireIdentity(request: FulfillmentRequest) {
    if (!request.sessionToken) throw new FulfillmentFault("UNAUTHENTICATED");
    const session = await this.sessions.readActiveIdentitySession(request.sessionToken);
    if (!session) throw new FulfillmentFault("UNAUTHENTICATED");
    return identityIdContract.parse(session.identityId);
  }

  private parseOrderId(value: unknown) {
    const parsed = orderIdContract.safeParse(value);
    if (!parsed.success) throw new FulfillmentFault("FULFILLMENT_NOT_FOUND");
    return parsed.data;
  }
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
