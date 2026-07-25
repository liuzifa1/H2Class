import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { HealthResponse } from "@h2class/shared";
import { CoreApiError, createCoreClient, verifyAdminToken } from "./api";
import { appendMessages, loadConversation } from "./db";
import type { AgentEnv } from "./env";
import { runScheduledJobs } from "./jobs";
import { runAgentTurn } from "./loop";
import { chatRequestSchema } from "./openai";
import type { ConversationMessage } from "./openai";

const app = new Hono<AgentEnv>();

app.use(
  "*",
  cors({
    allowHeaders: ["Authorization", "Content-Type"],
    exposeHeaders: ["x-conversation-id"],
  }),
);

app.get("/health", async (c) => {
  let coreReachable = false;
  try {
    const response = await fetch(new URL("/health", c.env.CORE_API_URL));
    coreReachable = response.ok;
  } catch {
    // Reported in the response without leaking configuration details.
  }
  const body: HealthResponse & {
    modelApiKeyConfigured: boolean;
    jobModelConfigured: boolean;
    coreTokenConfigured: boolean;
    coreReachable: boolean;
  } = {
    status: "ok",
    service: "agent",
    time: new Date().toISOString(),
    modelApiKeyConfigured: Boolean(c.env.OPENAI_API_KEY),
    jobModelConfigured: Boolean(c.env.OPENAI_MODEL?.trim()),
    coreTokenConfigured: Boolean(c.env.CORE_API_TOKEN),
    coreReachable,
  };
  return c.json(body);
});

app.post("/v1/chat/completions", async (c) => {
  if (c.env.AGENT_DISABLED === "1") {
    return c.json({ error: "agent_disabled" }, 503);
  }
  if (
    c.env.CORE_API_TOKEN === undefined ||
    c.env.CORE_API_TOKEN.length === 0 ||
    c.env.OPENAI_API_KEY === undefined ||
    c.env.OPENAI_API_KEY.length === 0 ||
    c.env.OPENAI_BASE_URL.length === 0
  ) {
    return c.json({ error: "agent_not_configured" }, 503);
  }

  try {
    const auth = await verifyAdminToken(
      c.env.CORE_API_URL,
      c.req.header("authorization"),
    );
    if (auth === "forbidden") return c.json({ error: "forbidden" }, 403);
  } catch (error) {
    if (error instanceof CoreApiError) {
      const status = error.status === 401 ? 401 : 503;
      return c.json({ error: error.code }, status);
    }
    throw error;
  }

  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
  const lastMessage = parsed.data.messages.at(-1);
  if (lastMessage?.role !== "user") {
    return c.json({ error: "assistant_prefill_not_allowed" }, 400);
  }

  const requestedConversationId = parsed.data.conversation_id;
  const conversationId = requestedConversationId ?? crypto.randomUUID();
  let history: ConversationMessage[];
  if (requestedConversationId === undefined) {
    history = parsed.data.messages.map((message) => ({ ...message }));
    await appendMessages(c.env.AGENT_DB, conversationId, history);
  } else {
    const stored = await loadConversation(c.env.AGENT_DB, conversationId);
    if (stored === null) return c.json({ error: "conversation_not_found" }, 404);
    const userMessage: ConversationMessage = { ...lastMessage };
    await appendMessages(c.env.AGENT_DB, conversationId, [userMessage]);
    history = [...stored, userMessage];
  }

  const model = parsed.data.model;
  const responseId = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1_000);
  const client = createCoreClient(c.env.CORE_API_URL, c.env.CORE_API_TOKEN);
  c.header("x-conversation-id", conversationId);

  return streamSSE(c, async (stream) => {
    const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
      JSON.stringify({
        id: responseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      });

    await stream.writeSSE({
      data: chunk({ role: "assistant", content: "" }, null),
    });
    try {
      const finishReason = await runAgentTurn(
        c.env,
        model,
        history,
        conversationId,
        client,
        c.req.raw.signal,
        async (text) => {
          await stream.writeSSE({ data: chunk({ content: text }, null) });
        },
      );
      await stream.writeSSE({ data: chunk({}, finishReason) });
    } catch (error) {
      console.error("agent stream failed", error);
      await stream.writeSSE({
        data: JSON.stringify({
          error: {
            message: "The agent could not complete this request.",
            type: "agent_error",
            code: "agent_stream_failed",
          },
        }),
      });
    }
    await stream.writeSSE({ data: "[DONE]" });
  });
});

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "internal_error" }, 500);
});

const worker: ExportedHandler<AgentEnv["Bindings"]> = {
  fetch: (request, env, executionContext) =>
    app.fetch(request, env, executionContext),
  scheduled: (controller, env, executionContext) => {
    executionContext.waitUntil(
      runScheduledJobs(env, controller.cron, controller.scheduledTime).then(
        () => undefined,
      ),
    );
  },
};

export default worker;
