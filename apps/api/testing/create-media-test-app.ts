import multipart from "@fastify/multipart";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { RuntimeEnvironment } from "@sevo/config";
import { MEDIA_UPLOAD_MAX_BYTES } from "@sevo/contracts/media/v1";
import { ApiExceptionFilter } from "../src/http/api-exception.filter";
import { IdentityAccessModule } from "../src/modules/identity-access/composition";
import { DevOtpProvider } from "../src/modules/notifications/composition";
import { MediaModule } from "../src/modules/media/composition";
import { PostgresMinioMediaStorage } from "../src/modules/media/infrastructure/postgres-minio-media-storage";
import type {
  ConversationMediaAccess,
  BuyerDisputeMediaAccess,
  DisputeMediaAccess,
  PurchaseExperienceMediaAccess,
} from "../src/modules/media/public";

class MediaTestModule {}
Module({})(MediaTestModule);

export async function createMediaTestApp(
  environment: RuntimeEnvironment,
  access: ConversationMediaAccess,
  disputeAccess: DisputeMediaAccess = async () => false,
  purchaseExperienceAccess: PurchaseExperienceMediaAccess = async () => false,
  buyerDisputeAccess: BuyerDisputeMediaAccess = async () => false,
) {
  const storage = new PostgresMinioMediaStorage(environment);
  const adapter = new FastifyAdapter({ logger: false });
  const server = adapter.getInstance();
  await server.register(multipart as unknown as Parameters<typeof server.register>[0], {
    limits: { files: 1, fields: 1, fileSize: MEDIA_UPLOAD_MAX_BYTES },
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    {
      module: MediaTestModule,
      imports: [
        IdentityAccessModule.register(environment, {
          otpProvider: new DevOtpProvider(),
        }),
        MediaModule.register(
          environment,
          storage,
          async () => false,
          access,
          disputeAccess,
          purchaseExperienceAccess,
          buyerDisputeAccess,
        ),
      ],
    },
    adapter,
    { logger: false },
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  return { app, storage };
}
