import type { OpenApiContributor } from "../public";
import { createInventoryV1JsonSchemas } from "@sevo/contracts/inventory/v1";
import { addModuleOpenApiContract } from "../module-contract";

export const contribute_inventory_openApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(document, createInventoryV1JsonSchemas(), {}, [], {
    descriptions: {},
  });
