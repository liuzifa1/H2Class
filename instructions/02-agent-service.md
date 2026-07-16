# 02 — Agent service (`apps/agent`)

A Cloudflare Worker running the Claude agent loop. **It is a client of the core API, not a backend**: zero business logic, no access to core's database. Its own D1 database (separate binding, milestone 2: `AGENT_DB`, database `h2class-agent`) stores only conversations and run history.

## Hard rules

- Core data flows ONLY through `src/api.ts` (typed fetch client, `Authorization: Bearer ${CORE_API_TOKEN}`). Never bind core's D1 to this worker. Never compute business results locally (balances, conflicts, prices) — call the endpoint.
- Owner-only operations are not callable with the agent's token (core returns 403). They are exposed to the model as `propose_*` tools that hit `POST /pending-actions`.
- Inbound `/chat` requests must carry the owner's session token; verify it by forwarding to core `GET /me` and requiring role `admin` before doing anything.
- Kill switch: if env `AGENT_DISABLED=1`, `/chat` returns 503 immediately.

## Claude API — current facts (your training data may be stale; follow these)

- SDK: `@anthropic-ai/sdk` (already a dependency). Model string: **`claude-opus-4-8`** exactly.
- Thinking: `thinking: { type: "adaptive" }`. **Do NOT send** `temperature`, `top_p`, `top_k`, or `thinking: {type:"enabled", budget_tokens}` — all of these return HTTP 400 on this model.
- Effort: `output_config: { effort: "high" }`.
- Use `client.messages.stream(...)` and forward text deltas to the console client (SSE); get the full message with `await stream.finalMessage()`.
- Prompt caching: `system` is an array of text blocks with `cache_control: { type: "ephemeral" }` on the last block; keep the tool array byte-stable and in a fixed order across calls (sort by name). Any reordering invalidates the cache.
- Tools: `strict: true`, `input_schema` with `additionalProperties: false` and explicit `required`. Descriptions must say WHEN to call the tool, not just what it does.
- Assistant prefill (a trailing assistant message in `messages`) returns 400 — never use it.
- Tool inputs arrive as parsed objects (`block.input`) — use them directly; never string-match serialized JSON.

## The loop (see AGENT.md §8)

```
while true:
  response = messages.stream(model, system, tools, messages).finalMessage()
  append {role:"assistant", content: response.content} to history
  if stop_reason == "tool_use":
      execute every tool_use block; collect ALL results
      append ONE user message containing ALL tool_result blocks   ← never split them
      continue
  if stop_reason == "pause_turn": continue (re-send as-is)
  else: done (end_turn = answer or a question for the owner)
```

- Failed tool call → `tool_result` with `is_error: true` and a short reason; never drop a result (the API rejects unmatched `tool_use` ids).
- `MAX_ITERATIONS = 24` per user turn; on hitting it, stop and tell the owner what remains.
- Persist history per conversation in `AGENT_DB` after every turn; reload on next request.

## Tool registry

Generated from `packages/shared`'s endpoint registry (see brief 03): one tool per endpoint entry. Mapping:

| Registry field | Tool |
|---|---|
| `name` | tool name (e.g. `people_create`) |
| `input` (zod) | `input_schema` via zod v4's native JSON-Schema export |
| `ownerOnly: true` | becomes `propose_<name>` → `POST /pending-actions { endpoint, payload }` |
| `readonly: true` | may be executed freely; others still go through core's own validation |

Do not hand-write tools for core endpoints; if a tool is missing, the endpoint is missing from the registry — fix it there (or report).

## System prompt (src/prompt.ts)

Contains: business context (K12 center, Asia/Shanghai timezone), tone for drafts (owner's voice, Simplified Chinese, concrete details filled in), decision policy (act directly on operational tasks; propose on money; ask the owner when a request is ambiguous or two options are equally good; NEVER invent prices — always call the pricing tool), and output style (concise; end turns with either completed work or one clear question).

## Autonomous runs (milestone 6)

`scheduled()` handler → same loop, headless, fixed prompts per job (daily digest, renewal watch). Output may only be: read calls, drafts (`POST /message-drafts`), pending actions. Log each run in `AGENT_DB`.
