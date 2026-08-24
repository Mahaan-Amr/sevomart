import { z } from "zod";

export const storeSlugContract = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .brand<"StoreSlug">();
