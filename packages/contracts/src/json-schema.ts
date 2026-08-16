import { z } from "zod";

export function createJsonSchemaMap<SchemaName extends string>(
  schemas: Record<SchemaName, z.ZodType>,
): Record<SchemaName, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries<z.ZodType>(schemas).map(([name, schema]) => {
      const generated = z.toJSONSchema(schema, {
        target: "openapi-3.0",
      }) as unknown as Record<string, unknown>;
      delete generated.$schema;
      return [name, generated];
    }),
  ) as Record<SchemaName, Record<string, unknown>>;
}
