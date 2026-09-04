import { createHash } from "node:crypto";

import {
  paymentIdempotencyKeyContract,
  requestDirectRefundInputContract,
} from "@sevo/contracts/payments/v1";
import { identityIdContract, orderIdContract } from "@sevo/contracts/platform/v1";

import { eventCorrelationId } from "../../../event-correlation-id";
import {
  DirectRefundFault,
  type DirectRefundRepository,
  type DirectRefundRequest,
  type DirectRefundSellerAccess,
  type DirectRefundService,
  type DirectRefundSessionRead,
  type DirectRefundStoreResolver,
  type DirectPaymentProvider,
} from "../public";

export class DirectRefundApplicationService implements DirectRefundService {
  constructor(
    private readonly repository: DirectRefundRepository,
    private readonly sessions: DirectRefundSessionRead,
    private readonly sellerAccess: DirectRefundSellerAccess,
    private readonly stores: DirectRefundStoreResolver,
    private readonly provider: DirectPaymentProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async request(
    request: DirectRefundRequest,
    orderIdInput: unknown,
    input: unknown,
    key: unknown,
  ) {
    const context = await this.requireSeller(request, orderIdInput);
    const parsedKey = paymentIdempotencyKeyContract.safeParse(key);
    if (!parsedKey.success) throw new DirectRefundFault("PRECONDITION_REQUIRED");
    const parsed = requestDirectRefundInputContract.safeParse(input);
    if (!parsed.success) throw new DirectRefundFault("VALIDATION_ERROR");
    return this.repository.request({
      ...context,
      idempotencyKey: parsedKey.data,
      input: parsed.data,
      requestHash: hash(parsed.data),
    });
  }

  async read(request: DirectRefundRequest, orderIdInput: unknown) {
    const context = await this.requireSeller(request, orderIdInput);
    const refund = await this.repository.readForSeller(
      context.storeId,
      context.orderId,
    );
    if (!refund) throw new DirectRefundFault("REFUND_NOT_FOUND");
    return refund;
  }

  async readBuyer(request: DirectRefundRequest, orderIdInput: unknown) {
    if (!request.sessionToken) throw new DirectRefundFault("UNAUTHENTICATED");
    const session = await this.sessions.readActiveIdentitySession(request.sessionToken);
    if (!session) throw new DirectRefundFault("UNAUTHENTICATED");
    const identityId = identityIdContract.parse(session.identityId);
    const orderId = orderIdContract.safeParse(orderIdInput);
    if (!orderId.success) throw new DirectRefundFault("REFUND_NOT_FOUND");
    const refund = await this.repository.readForBuyer(identityId, orderId.data);
    if (!refund) throw new DirectRefundFault("REFUND_NOT_FOUND");
    return refund;
  }

  async applyProviderResult(
    provider: string,
    input: unknown,
    keyInput: unknown,
    correlationId: string,
  ) {
    if (provider.toUpperCase() !== this.provider.providerKey) {
      throw new DirectRefundFault("REFUND_NOT_FOUND");
    }
    const key = paymentIdempotencyKeyContract.safeParse(keyInput);
    if (!key.success) throw new DirectRefundFault("PRECONDITION_REQUIRED");
    let verified;
    try {
      verified = await this.provider.verifyAndMapRefundResult(input);
    } catch {
      throw new DirectRefundFault("REFUND_EVIDENCE_REQUIRED");
    }
    return this.repository.recordResult({
      orderId: verified.orderId,
      input: verified,
      providerKey: this.provider.providerKey,
      providerEventId: verified.providerEventId,
      idempotencyKey: key.data,
      requestHash: hash(verified),
      correlationId,
      causationId: eventCorrelationId(verified.providerEventId),
      occurredAt: this.now(),
    });
  }

  private async requireSeller(request: DirectRefundRequest, orderIdInput: unknown) {
    if (!request.sessionToken) throw new DirectRefundFault("UNAUTHENTICATED");
    const session = await this.sessions.readActiveIdentitySession(request.sessionToken);
    if (!session) throw new DirectRefundFault("UNAUTHENTICATED");
    const actorId = identityIdContract.parse(session.identityId);
    if (!(await this.sellerAccess.isActiveSeller(actorId))) {
      throw new DirectRefundFault("FORBIDDEN");
    }
    const storeId = await this.stores.resolveStore(actorId);
    if (!storeId) throw new DirectRefundFault("FORBIDDEN");
    const order = orderIdContract.safeParse(orderIdInput);
    if (!order.success) throw new DirectRefundFault("REFUND_NOT_FOUND");
    return {
      orderId: order.data,
      actorId,
      storeId,
      correlationId: request.correlationId,
      causationId: request.correlationId,
      occurredAt: this.now(),
    };
  }

  async onModuleDestroy() {
    await this.repository.onModuleDestroy?.();
  }
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
