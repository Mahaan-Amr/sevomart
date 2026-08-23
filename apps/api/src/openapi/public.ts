import type { OpenAPIObject } from "@nestjs/swagger";

export type OpenApiContributor = (document: OpenAPIObject) => OpenAPIObject;
