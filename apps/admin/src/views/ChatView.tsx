import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { getRequestErrorMessage } from "../lib/api";
import { streamChat, type ChatHistoryMessage } from "../lib/chat";
import {
  loadConversations,
  loadModel,
  newConversation,
  saveConversations,
  saveModel,
  type Conversation,
  type ConversationMessage,
} from "../lib/conversations";
import { DEFAULT_AGENT_MODEL } from "../lib/config";
import { formatShanghaiDateTime } from "../lib/date";

const updateConversation = (
  conversations: readonly Conversation[],
  id: string,
  change: (conversation: Conversation) => Conversation,
) => {
  const current = conversations.find((conversation) => conversation.localId === id);
  if (current === undefined) return [...conversations];
  return [
    change(current),
    ...conversations.filter((conversation) => conversation.localId !== id),
  ];
};

const titleFor = (content: string) =>
  content.length > 18 ? `${content.slice(0, 18)}…` : content;

export const ChatView = () => {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const stored = loadConversations();
    return stored.length === 0 ? [newConversation()] : stored;
  });
  const [activeId, setActiveId] = useState(() => conversations[0]?.localId ?? "");
  const [input, setInput] = useState("");
  const [model, setModel] = useState(() => loadModel(DEFAULT_AGENT_MODEL));
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.localId === activeId),
    [activeId, conversations],
  );

  useEffect(() => saveConversations(conversations), [conversations]);
  useEffect(() => saveModel(model.trim()), [model]);
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [selected?.messages, streaming]);
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const createConversation = () => {
    if (streaming) return;
    const conversation = newConversation();
    setConversations((current) => [conversation, ...current]);
    setActiveId(conversation.localId);
    setInput("");
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = input.trim();
    const current = selected;
    const selectedModel = model.trim();
    if (content.length === 0 || current === undefined || streaming) return;
    if (selectedModel.length === 0) {
      setError("请先填写供应商提供的模型名称。");
      return;
    }

    const now = new Date().toISOString();
    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: now,
    };
    const assistantMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: now,
    };
    const requestMessages: ChatHistoryMessage[] =
      current.conversationId === null
        ? [
            ...current.messages
              .filter((message) => message.content.length > 0)
              .map(({ role, content: messageContent }) => ({
                role,
                content: messageContent,
              })),
            { role: "user", content },
          ]
        : [{ role: "user", content }];

    setConversations((items) =>
      updateConversation(items, current.localId, (conversation) => ({
        ...conversation,
        title:
          conversation.messages.length === 0
            ? titleFor(content)
            : conversation.title,
        updatedAt: now,
        messages: [...conversation.messages, userMessage, assistantMessage],
      })),
    );
    setInput("");
    setError(null);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const conversationId = await streamChat({
        model: selectedModel,
        messages: requestMessages,
        conversationId: current.conversationId,
        signal: controller.signal,
        onText: (text) => {
          setConversations((items) =>
            updateConversation(items, current.localId, (conversation) => ({
              ...conversation,
              updatedAt: new Date().toISOString(),
              messages: conversation.messages.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, content: `${message.content}${text}` }
                  : message,
              ),
            })),
          );
        },
      });
      setConversations((items) =>
        updateConversation(items, current.localId, (conversation) => ({
          ...conversation,
          conversationId,
        })),
      );
    } catch (value) {
      setConversations((items) =>
        updateConversation(items, current.localId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.filter(
            (message) =>
              message.id !== assistantMessage.id || message.content.length > 0,
          ),
        })),
      );
      if (!controller.signal.aborted) setError(getRequestErrorMessage(value));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
    }
  };

  return (
    <section className="chat-layout">
      <aside className="conversation-panel">
        <div className="conversation-panel__head">
          <div>
            <span className="section-kicker">对话记录</span>
            <h2>最近对话</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={createConversation}
            disabled={streaming}
            aria-label="新建对话"
            title="新建对话"
          >
            ＋
          </button>
        </div>

        <div className="conversation-list">
          {conversations.map((conversation) => (
            <button
              key={conversation.localId}
              className={
                conversation.localId === activeId
                  ? "conversation-item conversation-item--active"
                  : "conversation-item"
              }
              type="button"
              onClick={() => {
                if (!streaming) {
                  setActiveId(conversation.localId);
                  setError(null);
                }
              }}
              disabled={streaming && conversation.localId !== activeId}
            >
              <span className="conversation-item__mark" aria-hidden="true">
                {conversation.messages.length === 0 ? "新" : "聊"}
              </span>
              <span>
                <strong>{conversation.title}</strong>
                <small>{formatShanghaiDateTime(conversation.updatedAt)}</small>
              </span>
            </button>
          ))}
        </div>

        <label className="model-field">
          <span>模型名称</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="由模型供应商提供"
            disabled={streaming}
            spellCheck={false}
          />
          <small>仅保存模型标识，不保存任何供应商密钥。</small>
        </label>
      </aside>

      <div className="thread-panel">
        <div className="thread-panel__head">
          <div>
            <span className="assistant-presence" aria-hidden="true">
              H2
            </span>
            <div>
              <h2>{selected?.title ?? "新对话"}</h2>
              <p>
                <span className="online-dot" aria-hidden="true" />
                可查询核心数据并执行日常操作
              </p>
            </div>
          </div>
          <span className="thread-panel__meta">上海时间</span>
        </div>

        <div className="thread" aria-live="polite">
          {selected === undefined || selected.messages.length === 0 ? (
            <div className="chat-empty">
              <span className="chat-empty__mark" aria-hidden="true">H2</span>
              <h3>今天想先处理什么？</h3>
              <p>你可以直接用自然语言安排工作，助手会从系统读取真实数据。</p>
              <div className="prompt-suggestions">
                {["查找王老师本周的空闲时间", "列出所有三年级学生", "看看还有哪些消息没发"].map(
                  (suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setInput(suggestion)}
                    >
                      {suggestion}
                      <span aria-hidden="true">↗</span>
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {selected.messages.map((message) =>
                message.content.length === 0 ? null : (
                  <article
                    key={message.id}
                    className={`message message--${message.role}`}
                  >
                    <div className="message__author">
                      <span aria-hidden="true">
                        {message.role === "user" ? "主" : "H2"}
                      </span>
                      <strong>{message.role === "user" ? "你" : "H2 助手"}</strong>
                      <time>{formatShanghaiDateTime(message.createdAt)}</time>
                    </div>
                    <p>{message.content}</p>
                  </article>
                ),
              )}
              {streaming ? (
                <div className="tool-activity" role="status">
                  <span aria-hidden="true" />
                  正在查询核心数据并整理结果…
                </div>
              ) : null}
              <div ref={threadEndRef} />
            </div>
          )}
        </div>

        <form className="composer" onSubmit={submit}>
          {error === null ? null : (
            <div className="inline-alert inline-alert--error" role="alert">
              {error}
            </div>
          )}
          <div className="composer__box">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="例如：帮我查一下李老师下周二有没有空…"
              rows={3}
              disabled={streaming}
              aria-label="发送给 AI 助手的消息"
            />
            <button
              className="send-button"
              type="submit"
              disabled={streaming || input.trim().length === 0}
              aria-label="发送"
            >
              {streaming ? "…" : "发送"}
            </button>
          </div>
          <p className="composer__hint">Enter 发送 · Shift + Enter 换行 · 结果以核心系统数据为准</p>
        </form>
      </div>
    </section>
  );
};
