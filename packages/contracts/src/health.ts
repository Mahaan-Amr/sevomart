import { z } from "zod";

export const healthResponseContract = z.object({
  status: z.literal("ok"),
  service: z.literal("api"),
  version: z.literal(1),
});

export type HealthResponse = z.infer<typeof healthResponseContract>;
