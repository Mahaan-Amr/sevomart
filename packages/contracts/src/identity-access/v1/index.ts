import {
  identityAccessV1Examples as legacyIdentityAccessV1Examples,
  identityAccessV1Schemas as legacyIdentityAccessV1Schemas,
} from "../../identity-access-v1";
import { createJsonSchemaMap } from "../../json-schema";
import { platformAccessV1Examples, platformAccessV1Schemas } from "./platform-access";

export * from "../../identity-access-v1";
export * from "./platform-access";

export const identityAccessV1Schemas = {
  ...legacyIdentityAccessV1Schemas,
  ...platformAccessV1Schemas,
} as const;

export const identityAccessV1Examples = {
  ...legacyIdentityAccessV1Examples,
  ...platformAccessV1Examples,
} as const;

export function createIdentityAccessV1JsonSchemas() {
  return createJsonSchemaMap(identityAccessV1Schemas);
}
