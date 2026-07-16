import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.enum(["core", "agent"]),
  time: z.string(),
  db: z
    .object({
      reachable: z.boolean(),
      activityLogRows: z.number(),
    })
    .optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
