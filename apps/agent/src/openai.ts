import { z } from "zod";

export const toolCallSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("function"),
    function: z
      .object({
        name: z.string().min(1),
        arguments: z.string(),
      })
      .strict(),
  })
  .strict();

export const userMessageSchema = z
  .object({ role: z.literal("user"), content: z.string().min(1) })
  .strict();

export const assistantMessageSchema = z
  .object({
    role: z.literal("assistant"),
    content: z.string().nullable(),
    tool_calls: z.array(toolCallSchema).min(1).optional(),
  })
  .strict();

export const toolMessageSchema = z
  .object({
    role: z.literal("tool"),
    tool_call_id: z.string().min(1),
    content: z.string(),
  })
  .strict();

export const conversationMessageSchema = z.discriminatedUnion("role", [
  userMessageSchema,
  assistantMessageSchema,
  toolMessageSchema,
]);

export const inboundMessageSchema = z.discriminatedUnion("role", [
  userMessageSchema,
  z
    .object({ role: z.literal("assistant"), content: z.string().min(1) })
    .strict(),
]);

export const chatRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(inboundMessageSchema).min(1),
    stream: z.literal(true).default(true),
    conversation_id: z.uuid().optional(),
  })
  .strict();

export type ToolCall = z.infer<typeof toolCallSchema>;
export type UserMessage = z.infer<typeof userMessageSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type ToolMessage = z.infer<typeof toolMessageSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type InboundMessage = z.infer<typeof inboundMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type OpenAIFunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: true;
  };
};
