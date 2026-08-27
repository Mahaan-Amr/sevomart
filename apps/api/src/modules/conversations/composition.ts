import { Module, type DynamicModule } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";
import {
  IDENTITY_SESSION_READER,
  SELLER_ACCESS_READ,
  type IdentitySessionReader,
  type SellerAccessRead,
} from "../identity-access/public";
import { STORE_AUTHORITATIVE_READ, type StoreAuthoritativeRead } from "../store/public";
import type { ProductAuthoritativeRead } from "../product/public";
import type { OrderConversationEligibility } from "../orders/public";
import {
  CONVERSATION_ATTACHMENT_READER,
  type ConversationMediaAccess,
  type ConversationAttachmentReader,
} from "../media/public";
import { CONVERSATION_SERVICE } from "./public";
import { PostgresConversationRepository } from "./infrastructure/postgres-conversation.repository";
import { ConversationService } from "./application/conversation.service";
import { ConversationController } from "./conversation.controller";

@Module({})
export class ConversationsModule {
  static register(
    environment: RuntimeEnvironment,
    options: {
      products: ProductAuthoritativeRead;
      orders: OrderConversationEligibility;
      onMediaAccessReady?: (access: ConversationMediaAccess) => void;
    },
  ): DynamicModule {
    const repository = new PostgresConversationRepository(environment.DATABASE_URL);
    return {
      module: ConversationsModule,
      controllers: [ConversationController],
      providers: [
        { provide: PostgresConversationRepository, useValue: repository },
        {
          provide: CONVERSATION_SERVICE,
          inject: [
            IDENTITY_SESSION_READER,
            STORE_AUTHORITATIVE_READ,
            SELLER_ACCESS_READ,
            CONVERSATION_ATTACHMENT_READER,
          ],
          useFactory: (
            sessions: IdentitySessionReader,
            stores: StoreAuthoritativeRead,
            sellers: SellerAccessRead,
            media: ConversationAttachmentReader,
          ) => {
            const service = new ConversationService(
              repository,
              sessions,
              stores,
              sellers,
              options.products,
              options.orders,
              media,
              environment.CART_TOKEN_DERIVATION_SECRET,
            );
            options.onMediaAccessReady?.((input) => service.canAccessMedia(input));
            return service;
          },
        },
      ],
      exports: [CONVERSATION_SERVICE],
    };
  }
}
export { ConversationService } from "./application/conversation.service";
