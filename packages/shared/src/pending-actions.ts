import { z } from "zod";

const pendingActionIdSchema = z.uuid().describe("Pending-action UUID.");
const jsonObjectSchema = z.record(z.string(), z.json());

export const pendingActionStatusSchema = z.enum([
  "pending",
  "executed",
  "rejected",
  "expired",
]);

export const pendingActionSchema = z.object({
  id: pendingActionIdSchema,
  endpointName: z.string().min(1),
  payload: jsonObjectSchema,
  summary: z.string().min(1),
  status: pendingActionStatusSchema,
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  resolvedBy: z.string().min(1).nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  result: z.json().nullable(),
});

export const pendingActionsCreateInputSchema = z
  .object({
    endpoint: z.string().min(1),
    payload: jsonObjectSchema,
  })
  .strict();

export const pendingActionsListInputSchema = z.object({}).strict();
export const pendingActionsListOutputSchema = z.object({
  actions: z.array(pendingActionSchema),
});

export const pendingActionsExecuteInputSchema = z
  .object({ id: pendingActionIdSchema })
  .strict();

export const pendingActionsRejectInputSchema = z
  .object({
    id: pendingActionIdSchema,
    reason: z.string().regex(/\S/).max(500).optional(),
  })
  .strict();

export type PendingActionStatus = z.infer<typeof pendingActionStatusSchema>;
export type PendingAction = z.infer<typeof pendingActionSchema>;
export type PendingActionsCreateInput = z.infer<
  typeof pendingActionsCreateInputSchema
>;
export type PendingActionsListInput = z.infer<
  typeof pendingActionsListInputSchema
>;
export type PendingActionsListOutput = z.infer<
  typeof pendingActionsListOutputSchema
>;
export type PendingActionsExecuteInput = z.infer<
  typeof pendingActionsExecuteInputSchema
>;
export type PendingActionsRejectInput = z.infer<
  typeof pendingActionsRejectInputSchema
>;
