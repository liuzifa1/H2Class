type ToolCall = { name: string; input: Record<string, unknown> };

let callSequence = 0;

const sseResponse = (frame: unknown) =>
  new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

export const modelTools = (calls: ToolCall[]) => {
  const toolCalls = calls.map((call, index) => {
    callSequence += 1;
    return {
      index,
      id: `call-${callSequence}`,
      type: "function",
      function: {
        name: call.name,
        arguments: JSON.stringify(call.input),
      },
    };
  });
  return sseResponse({
    choices: [{
      index: 0,
      delta: { tool_calls: toolCalls },
      finish_reason: "tool_calls",
    }],
  });
};

export const modelText = (content: string) =>
  sseResponse({
    choices: [{ index: 0, delta: { content }, finish_reason: "stop" }],
  });

export const requestBody = (init: RequestInit | undefined) => {
  if (typeof init?.body !== "string") throw new Error("mock_body_missing");
  return JSON.parse(init.body) as {
    messages: Array<Record<string, unknown>>;
    tools: Array<{ function: { name: string } }>;
  };
};

export const initialUserPrompt = (
  body: ReturnType<typeof requestBody>,
) => {
  const message = body.messages.find((candidate) => candidate.role === "user");
  if (typeof message?.content !== "string") {
    throw new Error("mock_initial_prompt_missing");
  }
  return message.content;
};

export const previousToolNames = (
  body: ReturnType<typeof requestBody>,
) => {
  const messages = body.messages.filter((message) =>
    message.role === "assistant" && Array.isArray(message.tool_calls)
  );
  const calls = messages.at(-1)?.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.map((call) => {
    if (typeof call !== "object" || call === null) return "";
    const fn = Reflect.get(call, "function");
    return typeof fn === "object" && fn !== null &&
        typeof Reflect.get(fn, "name") === "string"
      ? Reflect.get(fn, "name") as string
      : "";
  });
};

export const lastToolContents = (
  body: ReturnType<typeof requestBody>,
) => {
  const contents: unknown[] = [];
  for (let index = body.messages.length - 1; index >= 0; index -= 1) {
    const message = body.messages[index];
    if (message?.role !== "tool") break;
    if (typeof message.content === "string") {
      contents.unshift(JSON.parse(message.content));
    }
  }
  return contents;
};

export const requestUrl = (input: RequestInfo | URL) =>
  new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
