import { type DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";
import { fulfillmentOrderSnapshotContract } from "@sevo/contracts/fulfillment/v1";
import { identityIdContract, storeIdContract } from "@sevo/contracts/platform/v1";

import {
  IDENTITY_SESSION_READER,
  SELLER_ACCESS_READ,
  type IdentitySessionReader,
  type SellerAccessRead,
} from "../identity-access/public";
import type { OrderPaymentWorkflow } from "../orders/public";
import { FulfillmentService } from "./application/fulfillment.service";
import { FulfillmentController } from "./fulfillment.controller";
import { PostgresFulfillmentRepository } from "./infrastructure/postgres-fulfillment.repository";
import {
  FULFILLMENT_SERVICE,
  FULFILLMENT_AUTHORITATIVE_READ,
  type FulfillmentOrderAccess,
  type FulfillmentAuthoritativeRead,
  type FulfillmentRepository,
} from "./public";

@Module({})
export class FulfillmentModule {
  static register(
    environment: RuntimeEnvironment,
    options: {
      orders: OrderPaymentWorkflow;
      resolveSellerStore: (identityId: string) => Promise<string | undefined>;
      repository?: FulfillmentRepository;
    },
  ): DynamicModule {
    const repository =
      options.repository ?? new PostgresFulfillmentRepository(environment.DATABASE_URL);
    return {
      module: FulfillmentModule,
      controllers: [FulfillmentController],
      providers: [
        {
          provide: FULFILLMENT_SERVICE,
          inject: [IDENTITY_SESSION_READER, SELLER_ACCESS_READ],
          useFactory: (
            sessions: IdentitySessionReader,
            sellerAccess: SellerAccessRead,
          ) =>
            new FulfillmentService(
              repository,
              {
                async readActiveIdentitySession(token) {
                  const session = await sessions.readActiveIdentitySession(token);
                  return session
                    ? { identityId: identityIdContract.parse(session.actor.identityId) }
                    : undefined;
                },
              },
              sellerAccess,
              {
                async resolveStore(identityId) {
                  const storeId = await options.resolveSellerStore(identityId);
                  return storeId ? storeIdContract.parse(storeId) : undefined;
                },
              },
              createFulfillmentOrderAccess(options.orders),
            ),
        },
        {
          provide: FULFILLMENT_AUTHORITATIVE_READ,
          useExisting: FULFILLMENT_SERVICE,
        },
      ],
      exports: [FULFILLMENT_AUTHORITATIVE_READ],
    };
  }
}

export function createFulfillmentOrderAccess(
  orders: OrderPaymentWorkflow,
): FulfillmentOrderAccess {
  return {
    async sellerCanAccessFulfillment(_actorId, storeId, orderId) {
      return orders.sellerCanTrack(storeId, orderId);
    },
    async buyerCanTrack(actorId, orderId) {
      const state = await orders.readBuyerPaymentState(
        identityIdContract.parse(actorId),
        orderId,
      );
      return Boolean(
        state &&
        ["PAID", "CANCELLATION_PENDING_REFUND", "CANCELLED"].includes(state.status),
      );
    },
  };
}

export function createFulfillmentAuthoritativeRead(
  repository: FulfillmentRepository,
  orders: OrderPaymentWorkflow,
): FulfillmentAuthoritativeRead {
  const access = createFulfillmentOrderAccess(orders);
  return {
    async readOrderSnapshot(input) {
      if (!(await access.buyerCanTrack(input.buyerId, input.orderId))) return undefined;
      const snapshot = await repository.readOrderSnapshot(input.orderId);
      if (!snapshot) return undefined;
      return fulfillmentOrderSnapshotContract.parse({
        version: 1,
        ...input,
        ...snapshot,
      });
    },
  };
}

export { PostgresFulfillmentRepository };
