import { z } from "zod";

export const apiErrorContract = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  correlationId: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ApiError = z.infer<typeof apiErrorContract>;
