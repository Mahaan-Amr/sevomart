import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { FakeObjectStorage } from "./testing/fake-object-storage";
import { PostgresMinioMediaStorage } from "./infrastructure/postgres-minio-media-storage";
import { MEDIA_STORAGE, type MediaStorage } from "./public";
import { MediaController } from "./media.controller";

@Module({})
export class MediaModule {
  static register(
    environment: RuntimeEnvironment,
    storage?: MediaStorage,
  ): DynamicModule {
    const configuredStorage =
      storage ??
      (environment.SEVO_RUNTIME_ENV === "test"
        ? new FakeObjectStorage()
        : new PostgresMinioMediaStorage(environment));
    return {
      module: MediaModule,
      global: true,
      controllers: [MediaController],
      providers: [{ provide: MEDIA_STORAGE, useValue: configuredStorage }],
      exports: [MEDIA_STORAGE],
    };
  }
}
