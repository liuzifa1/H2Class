const CONVERSATIONS_KEY = "h2class.chat-conversations";
const MODEL_KEY = "h2class.agent-model";

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type Conversation = {
  localId: string;
  conversationId: string | null;
  title: string;
  updatedAt: string;
  messages: ConversationMessage[];
};

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const parseMessage = (value: unknown): ConversationMessage | null => {
  const item = record(value);
  if (
    item === null ||
    typeof item.id !== "string" ||
    (item.role !== "user" && item.role !== "assistant") ||
    typeof item.content !== "string" ||
    typeof item.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id: item.id,
    role: item.role,
    content: item.content,
    createdAt: item.createdAt,
  };
};

const parseConversation = (value: unknown): Conversation | null => {
  const item = record(value);
  if (
    item === null ||
    typeof item.localId !== "string" ||
    !(typeof item.conversationId === "string" || item.conversationId === null) ||
    typeof item.title !== "string" ||
    typeof item.updatedAt !== "string" ||
    !Array.isArray(item.messages)
  ) {
    return null;
  }

  const messages = item.messages.map(parseMessage);
  if (messages.some((message) => message === null)) return null;
  return {
    localId: item.localId,
    conversationId: item.conversationId,
    title: item.title,
    updatedAt: item.updatedAt,
    messages: messages.filter((message) => message !== null),
  };
};

export const loadConversations = (): Conversation[] => {
  const stored = localStorage.getItem(CONVERSATIONS_KEY);
  if (stored === null) return [];
  try {
    const value: unknown = JSON.parse(stored);
    if (!Array.isArray(value)) return [];
    return value
      .map(parseConversation)
      .filter((conversation) => conversation !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
};

export const saveConversations = (conversations: readonly Conversation[]) => {
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
};

export const newConversation = (): Conversation => {
  const now = new Date().toISOString();
  return {
    localId: crypto.randomUUID(),
    conversationId: null,
    title: "新对话",
    updatedAt: now,
    messages: [],
  };
};

export const loadModel = (fallback: string) =>
  localStorage.getItem(MODEL_KEY)?.trim() || fallback;

export const saveModel = (model: string) => {
  localStorage.setItem(MODEL_KEY, model);
};
