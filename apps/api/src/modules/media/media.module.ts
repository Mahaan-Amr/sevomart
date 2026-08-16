import { DynamicModule, Module } from "@nestjs/common";
import type { RuntimeEnvironment } from "@sevo/config";

import { FakeObjectStorage } from "./testing/fake-object-storage";
import { MEDIA_STORAGE, type MediaStorage } from "./public";
import { MediaController } from "./media.controller";

@Module({})
export class MediaModule {
  static register(
    environment: RuntimeEnvironment,
    storage?: MediaStorage,
  ): DynamicModule {
    if (!storage && environment.NODE_ENV === "production") {
      throw new Error("Media storage adapter is not configured for production");
    }
    return {
      module: MediaModule,
      global: true,
      controllers: [MediaController],
      providers: [
        { provide: MEDIA_STORAGE, useValue: storage ?? new FakeObjectStorage() },
      ],
      exports: [MEDIA_STORAGE],
    };
  }
}
