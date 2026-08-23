import {
  apiErrorV1Examples,
  createApiErrorV1JsonSchemas,
} from "@sevo/contracts/api-errors/v1";

import { addModuleOpenApiContract } from "../module-contract";
import type { OpenApiContributor } from "../public";

export const contributeApiErrorsOpenApi: OpenApiContributor = (document) =>
  addModuleOpenApiContract(
    document,
    createApiErrorV1JsonSchemas(),
    apiErrorV1Examples,
    [],
    { descriptions: {} },
  );
