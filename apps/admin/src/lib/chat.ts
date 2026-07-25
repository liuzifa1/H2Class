import { fetchAuthorized, type RequestError } from "./api";
import { AGENT_URL } from "./config";

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type StreamChatInput = {
  model: string;
  messages: readonly ChatHistoryMessage[];
  conversationId: string | null;
  signal: AbortSignal;
  onText: (text: string) => void;
};

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const streamError = (code: string): RequestError =>
  Object.assign(new Error(code), { status: 502, code });

const frameData = (frame: string) =>
  frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

const textDelta = (value: unknown) => {
  const chunk = record(value);
  if (chunk === null) throw streamError("invalid_event_stream");

  const error = record(chunk.error);
  if (error !== null) {
    const code = typeof error.code === "string" ? error.code : "agent_stream_failed";
    throw streamError(code);
  }

  const choices = chunk.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const choice = record(choices[0]);
  const delta = choice === null ? null : record(choice.delta);
  return delta !== null && typeof delta.content === "string" ? delta.content : "";
};

export const streamChat = async ({
  model,
  messages,
  conversationId,
  signal,
  onText,
}: StreamChatInput) => {
  const response = await fetchAuthorized(AGENT_URL, "/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...(conversationId === null ? {} : { conversation_id: conversationId }),
    }),
    signal,
  });
  if (response.body === null) throw streamError("invalid_event_stream");

  const nextConversationId = response.headers.get("x-conversation-id");
  if (nextConversationId === null) throw streamError("invalid_event_stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  const processFrame = (frame: string) => {
    const data = frameData(frame);
    if (data.length === 0) return;
    if (data === "[DONE]") {
      completed = true;
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      throw streamError("invalid_event_stream");
    }
    const delta = textDelta(value);
    if (delta.length > 0) onText(delta);
  };

  while (!completed) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      processFrame(frame);
      if (completed) break;
      boundary = buffer.indexOf("\n\n");
    }
  }

  buffer += decoder.decode();
  if (!completed && buffer.trim().length > 0) processFrame(buffer.trim());
  if (!completed) throw streamError("invalid_event_stream");
  await reader.cancel().catch(() => undefined);
  return nextConversationId;
};
