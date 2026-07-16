import { z } from "zod";

export const activityLogEntrySchema = z.object({
  id: z.number(),
  actor: z.string(),
  action: z.string(),
  entity: z.string().nullable(),
  entityId: z.string().nullable(),
  summary: z.string().nullable(),
  createdAt: z.string(),
});

export type ActivityLogEntry = z.infer<typeof activityLogEntrySchema>;
