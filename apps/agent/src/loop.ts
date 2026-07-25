import { appendMessages } from "./db";
import type { AgentEnv } from "./env";
import type {
  AssistantMessage,
  ConversationMessage,
  OpenAIFunctionTool,
  ToolCall,
  ToolMessage,
} from "./openai";
import { SYSTEM_PROMPT } from "./prompt";
import { interactiveToolRuntime } from "./tools";
import type { CoreClient } from "./api";
import type { ToolExecutor, ToolRuntime } from "./tools";

export const MAX_ITERATIONS = 24;

type ToolCallParts = {
  id: string;
  name: string;
  arguments: string;
};

type StreamedTurn = {
  assistant: AssistantMessage;
  finishReason: string | null;
};

export class ModelApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const dataFromFrame = (frame: string) =>
  frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

const applyChunk = (
  value: unknown,
  textParts: string[],
  toolParts: Map<number, ToolCallParts>,
  onText: (text: string) => Promise<void>,
): Promise<string | null> => {
  const chunk = record(value);
  if (chunk === null) throw new ModelApiError("invalid_model_stream");
  if (record(chunk.error) !== null) throw new ModelApiError("model_stream_error");
  const choices = chunk.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return Promise.resolve(null);
  }
  const choice = record(choices[0]);
  if (choice === null) throw new ModelApiError("invalid_model_stream");
  const delta = record(choice.delta);

  const operations: Promise<void>[] = [];
  if (delta !== null) {
    if (typeof delta.content === "string" && delta.content.length > 0) {
      textParts.push(delta.content);
      operations.push(onText(delta.content));
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const rawToolCall of delta.tool_calls) {
        const toolCall = record(rawToolCall);
        if (toolCall === null || typeof toolCall.index !== "number") {
          throw new ModelApiError("invalid_model_tool_call");
        }
        const current = toolParts.get(toolCall.index) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        if (typeof toolCall.id === "string") current.id += toolCall.id;
        const fn = record(toolCall.function);
        if (fn !== null) {
          if (typeof fn.name === "string") current.name += fn.name;
          if (typeof fn.arguments === "string") {
            current.arguments += fn.arguments;
          }
        }
        toolParts.set(toolCall.index, current);
      }
    }
  }

  return Promise.all(operations).then(() =>
    typeof choice.finish_reason === "string" ? choice.finish_reason : null,
  );
};

const streamModelTurn = async (
  env: AgentEnv["Bindings"],
  model: string,
  history: readonly ConversationMessage[],
  systemPrompt: string,
  availableTools: readonly OpenAIFunctionTool[],
  signal: AbortSignal,
  onText: (text: string) => Promise<void>,
): Promise<StreamedTurn> => {
  if (env.OPENAI_API_KEY === undefined || env.OPENAI_API_KEY.length === 0) {
    throw new ModelApiError("model_api_key_missing");
  }

  let response: Response;
  try {
    const baseUrl = env.OPENAI_BASE_URL.replace(/\/+$/, "");
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
        ],
        tools: availableTools,
        tool_choice: "auto",
        stream: true,
      }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ModelApiError("model_unavailable");
  }

  if (!response.ok) {
    response.body?.cancel().catch(() => undefined);
    throw new ModelApiError(`model_request_failed_${response.status}`);
  }
  if (response.body === null) throw new ModelApiError("model_stream_missing");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const textParts: string[] = [];
  const toolParts = new Map<number, ToolCallParts>();
  let finishReason: string | null = null;
  let buffer = "";
  let doneSeen = false;

  const processFrame = async (frame: string) => {
    const data = dataFromFrame(frame);
    if (data.length === 0) return;
    if (data === "[DONE]") {
      doneSeen = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new ModelApiError("invalid_model_stream");
    }
    const chunkFinishReason = await applyChunk(
      parsed,
      textParts,
      toolParts,
      onText,
    );
    if (chunkFinishReason !== null) finishReason = chunkFinishReason;
  };

  while (!doneSeen) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      await processFrame(frame);
      if (doneSeen) break;
      boundary = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (!doneSeen && buffer.trim().length > 0) await processFrame(buffer.trim());

  const toolCalls: ToolCall[] = [...toolParts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, parts]) => {
      if (parts.id.length === 0 || parts.name.length === 0) {
        throw new ModelApiError("invalid_model_tool_call");
      }
      return {
        id: parts.id,
        type: "function",
        function: { name: parts.name, arguments: parts.arguments },
      };
    });
  const text = textParts.join("");
  const assistant: AssistantMessage = {
    role: "assistant",
    content: text.length === 0 ? null : text,
    ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
  };
  return { assistant, finishReason };
};

const invalidArguments = (): string =>
  JSON.stringify({ error: "invalid_tool_arguments", is_error: true });

const executeCalls = async (
  calls: readonly ToolCall[],
  client: CoreClient,
  conversationId: string,
  executor: ToolExecutor,
): Promise<ToolMessage[]> =>
  Promise.all(
    calls.map(async (call) => {
      let input: unknown;
      try {
        input = JSON.parse(call.function.arguments);
      } catch {
        return {
          role: "tool" as const,
          tool_call_id: call.id,
          content: invalidArguments(),
        };
      }
      const result = await executor(
        call.function.name,
        input,
        client,
        conversationId,
      );
      return {
        role: "tool" as const,
        tool_call_id: call.id,
        content: result.content,
      };
    }),
  );

export type AgentLoopResult = {
  finishReason: string;
  iterations: number;
  status: "completed" | "partial";
  finalText: string | null;
};

type AgentLoopConfig = {
  systemPrompt: string;
  toolRuntime: ToolRuntime;
};

export const runAgentLoop = async (
  env: AgentEnv["Bindings"],
  model: string,
  initialHistory: readonly ConversationMessage[],
  conversationId: string,
  client: CoreClient,
  signal: AbortSignal,
  onText: (text: string) => Promise<void>,
  config: AgentLoopConfig,
): Promise<AgentLoopResult> => {
  const history = [...initialHistory];
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const turn = await streamModelTurn(
      env,
      model,
      history,
      config.systemPrompt,
      config.toolRuntime.tools,
      signal,
      onText,
    );
    history.push(turn.assistant);
    await appendMessages(env.AGENT_DB, conversationId, [turn.assistant]);

    const calls = turn.assistant.tool_calls;
    if (calls === undefined || calls.length === 0) {
      return {
        finishReason: turn.finishReason ?? "stop",
        iterations: iteration + 1,
        status: "completed",
        finalText: turn.assistant.content,
      };
    }

    const results = await executeCalls(
      calls,
      client,
      conversationId,
      config.toolRuntime.execute,
    );
    history.push(...results);
    await appendMessages(env.AGENT_DB, conversationId, results);
  }

  const limitMessage: AssistantMessage = {
    role: "assistant",
    content:
      "已达到本次操作的迭代上限，仍有步骤未完成。请缩小任务范围后重试。",
  };
  await onText(limitMessage.content ?? "");
  await appendMessages(env.AGENT_DB, conversationId, [limitMessage]);
  return {
    finishReason: "length",
    iterations: MAX_ITERATIONS,
    status: "partial",
    finalText: limitMessage.content,
  };
};

export const runAgentTurn = async (
  env: AgentEnv["Bindings"],
  model: string,
  initialHistory: readonly ConversationMessage[],
  conversationId: string,
  client: CoreClient,
  signal: AbortSignal,
  onText: (text: string) => Promise<void>,
): Promise<string> => {
  const result = await runAgentLoop(
    env,
    model,
    initialHistory,
    conversationId,
    client,
    signal,
    onText,
    { systemPrompt: SYSTEM_PROMPT, toolRuntime: interactiveToolRuntime },
  );
  return result.finishReason;
};
