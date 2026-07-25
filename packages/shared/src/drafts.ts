import { z } from "zod";

const draftIdSchema = z.uuid().describe("Message draft UUID.");
const personIdSchema = z.uuid().describe("Message recipient person UUID.");

export const messageDraftStatusSchema = z.enum(["draft", "sent"]);

export const messageDraftSchema = z.object({
  id: draftIdSchema,
  personId: personIdSchema,
  purpose: z.string().min(1).describe("Short machine-readable draft purpose."),
  text: z.string().min(1).describe("Ready-to-paste Simplified Chinese message."),
  status: messageDraftStatusSchema,
  createdAt: z.iso.datetime().describe("UTC creation timestamp."),
  sentAt: z.iso.datetime().nullable().describe("UTC sent timestamp, when sent."),
});

export const draftsCreateInputSchema = z
  .object({
    personId: personIdSchema,
    purpose: z.string().min(1).describe("Short machine-readable draft purpose."),
    text: z.string().min(1).describe("Ready-to-paste Simplified Chinese message."),
  })
  .strict();

export const draftsListInputSchema = z
  .object({
    personId: personIdSchema.optional().describe("Optional recipient filter."),
    purpose: z.string().min(1).optional().describe("Optional exact purpose filter."),
    status: messageDraftStatusSchema.optional().describe("Optional status filter."),
  })
  .strict();

export const draftsListOutputSchema = z.object({
  drafts: z.array(messageDraftSchema),
});

export const draftsMarkSentInputSchema = z
  .object({ id: draftIdSchema })
  .strict();

export type MessageDraftStatus = z.infer<typeof messageDraftStatusSchema>;
export type MessageDraft = z.infer<typeof messageDraftSchema>;
export type DraftsCreateInput = z.infer<typeof draftsCreateInputSchema>;
export type DraftsListInput = z.infer<typeof draftsListInputSchema>;
export type DraftsListOutput = z.infer<typeof draftsListOutputSchema>;
export type DraftsMarkSentInput = z.infer<typeof draftsMarkSentInputSchema>;
