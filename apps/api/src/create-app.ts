import { randomUUID } from "node:crypto";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { RuntimeEnvironment } from "@sevo/config";

import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./http/api-exception.filter";
import { addIdentityStoreOpenApiContract } from "./openapi/identity-store.openapi";

export async function createApiApp(
  environment: RuntimeEnvironment,
): Promise<NestFastifyApplication> {
  if (environment.NODE_ENV === "production" && environment.OTP_PROVIDER === "dev") {
    throw new Error("DevOtpProvider cannot run in production");
  }

  const adapter = new FastifyAdapter({
    logger: environment.NODE_ENV === "test" ? false : { level: "info" },
    requestIdHeader: "x-correlation-id",
    genReqId: () => randomUUID(),
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(environment),
    adapter,
    { bufferLogs: true },
  );

  app.enableCors({ origin: environment.WEB_ORIGIN });
  app.useGlobalFilters(new ApiExceptionFilter());
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onSend", (request, reply, _payload, done) => {
      void reply.header("x-correlation-id", request.id);
      done();
    });

  const openApiConfig = new DocumentBuilder()
    .setTitle("Sevo API")
    .setVersion("1")
    .build();
  const openApiDocument = addIdentityStoreOpenApiContract(
    SwaggerModule.createDocument(app, openApiConfig),
  );
  SwaggerModule.setup("openapi", app, openApiDocument, {
    jsonDocumentUrl: "openapi.json",
  });

  await app.init();
  return app;
}
