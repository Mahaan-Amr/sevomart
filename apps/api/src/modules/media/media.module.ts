import { DynamicModule, Module } from "@nestjs/common";

import { FakeObjectStorage } from "./testing/fake-object-storage";
import { MEDIA_STORAGE, type MediaStorage } from "./public";
import { MediaController } from "./media.controller";

@Module({})
export class MediaModule {
  static register(storage: MediaStorage = new FakeObjectStorage()): DynamicModule {
    return {
      module: MediaModule,
      global: true,
      controllers: [MediaController],
      providers: [{ provide: MEDIA_STORAGE, useValue: storage }],
      exports: [MEDIA_STORAGE],
    };
  }
}
