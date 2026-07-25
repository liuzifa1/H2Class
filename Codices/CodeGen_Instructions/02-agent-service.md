# 02 — Agent service (`apps/agent`)

A Cloudflare Worker running a vendor-neutral OpenAI-compatible agent loop. **It is a client of the core API, not a backend**: zero business logic, no access to core's database. Its own D1 database (`AGENT_DB`, database `h2class-agent`) stores only conversations and run history.

## Hard rules

- Core data flows ONLY through `src/api.ts` (typed fetch client, `Authorization: Bearer ${CORE_API_TOKEN}`). Never bind core's D1 to this worker. Never compute business results locally (balances, conflicts, prices) — call the endpoint.
- Owner-only operations are not callable with the agent's token (core returns 403). They are exposed to the model as `propose_*` tools that hit `POST /pending-actions`.
- Inbound `POST /v1/chat/completions` requests carry the owner's session token; verify it by forwarding to core `GET /me` and requiring role `admin` before doing anything.
- Kill switch: if env `AGENT_DISABLED=1`, the chat endpoint returns 503 immediately.

## OpenAI-compatible model API

- Use direct `fetch`; do not bind the worker to a vendor SDK.
- `OPENAI_BASE_URL` includes the vendor API prefix (normally `/v1`). Send model requests to `${OPENAI_BASE_URL}/chat/completions` with `Authorization: Bearer ${OPENAI_API_KEY}`.
- The inbound request's non-empty `model` string is passed through unchanged. Do not hard-code a model name.
- Stream the vendor's OpenAI-compatible SSE response and forward text as OpenAI `chat.completion.chunk` SSE data from the public endpoint.
- Send `stream: true`, the system prompt, conversation messages, the generated `tools`, and `tool_choice: "auto"`. Do not add vendor-specific reasoning, sampling, or token-budget fields.
- Do not accept assistant prefill: each owner turn must end in a `user` message.
- Tools use `strict: true`, an object `parameters` schema with `additionalProperties: false` and explicit `required`. Descriptions say WHEN to call the tool.
- Keep the tool array byte-stable in a fixed order across calls (sort once by final tool name).
- Tool arguments arrive as JSON strings in streamed `tool_calls`; parse them as JSON objects, then validate them with the registry Zod schema. Never string-match serialized JSON.

## The loop (see AGENT.md §8)

```text
while iterations < 24:
  stream POST {OPENAI_BASE_URL}/chat/completions
  assemble text plus every streamed assistant tool_call
  append the complete assistant message to history
  if there are tool_calls:
      execute every tool call; never drop a result
      append one role=tool message for each tool_call_id
      continue
  else: done
```

- Failed tool call → a short error result for that `tool_call_id`; never drop a result.
- `MAX_ITERATIONS = 24` per owner turn; on hitting it, stop and tell the owner what remains.
- Persist history per conversation in `AGENT_DB` after every assistant or tool turn; reload it on the next request.
- The public response ends with an OpenAI finish chunk and `data: [DONE]`.

## Public chat contract

`POST /v1/chat/completions` accepts an OpenAI-style request with `model`, `messages`, and `stream: true`. H2Class adds an optional UUID `conversation_id`; a new UUID is returned in the `x-conversation-id` response header. The worker owns the system prompt, so client-supplied `system` and `tool` messages are rejected.

For a new conversation, persist the supplied `user`/`assistant` string messages. For an existing `conversation_id`, reload stored history and append only the request's final user message, avoiding duplicated client history.

## Tool registry

Generated from `packages/shared`'s endpoint registry (see brief 03): one tool per endpoint entry. Mapping:

| Registry field | Tool |
|---|---|
| `name` | OpenAI function name (e.g. `people_create`) |
| `input` (Zod) | `parameters` via Zod v4's native JSON-Schema export |
| `ownerOnly: true` | becomes `propose_<name>` → `POST /pending-actions { endpoint, payload }` |
| `readonly: true` | may be executed freely; other calls still go through core validation |
| `autonomousWrite: true` | explicitly approved direct write for headless jobs (currently only `drafts_create`) |

Do not hand-write tools for core endpoints; if a tool is missing, the endpoint is missing from the registry — fix it there (or report). If core has not shipped `POST /pending-actions`, a `propose_*` tool returns an error result explaining that the capability is pending; it never calls the owner-only endpoint directly.

## System prompt (`src/prompt.ts`)

Contains: business context (K12 center, Asia/Shanghai timezone), tone for drafts (owner's voice, Simplified Chinese, concrete details filled in), decision policy (act directly on operational tasks; propose owner-only actions; ask the owner when a request is ambiguous or two options are equally good; NEVER invent prices — always call a pricing tool), and output style (concise; end turns with either completed work or one clear question).

## Autonomous runs

`scheduled()` dispatches the exact UTC cron string through a job registry and
runs the same streamed loop headlessly with the job's fixed prompt. Interactive
requests still pass their `model` through unchanged; headless jobs require the
non-secret `OPENAI_MODEL` binding because there is no inbound request to supply
one.

The autonomous tool set is generated from registry metadata and enforced both
when tools are advertised and when a call executes. It contains only visible
readonly entries, `drafts_create`, and visible owner-only entries converted to
`propose_*`; operational writes and hidden control-plane entries are absent.

The daily renewal watch runs at `0 23 * * *` UTC (07:00 Asia/Shanghai). Its
binding defaults are: all arrears, active packages with `remainingCredits <=
3`, and active subscriptions ending within 14 local calendar days. Multiple
triggers are combined into one draft per guardian+student. Renewal drafts use
the exact purpose `renewal:<student UUID>`; the prompt checks `drafts_list`, and
the executor independently repeats that structured unsent-draft check before
`drafts_create`.

The daily digest shares `0 23 * * *` UTC and runs deterministically after the
renewal watch. It calls only `reports_daily` and persists a conversation titled
`今日简报`; its advertised and executable tool set contains no other endpoint.
All signed money values remain integer fen in the summary.

The no-show follow-up runs at `0 13 * * *` UTC (21:00 Asia/Shanghai). It checks
only lessons that have ended, and only an explicit `absent` attendance row may
produce guardian drafts. Missing attendance is an internal digest anomaly,
never an accusation. Draft purposes are exact
`no_show:<lesson UUID>:<student UUID>` values, protected by the same structured
prompt-plus-executor unsent-draft guard as renewal reminders.
The executor also derives an eligibility set only from successful `lessons_list`
and `attendance_list` results observed in that invocation. `drafts_create` is
rejected unless the exact lesson/student is on an ended, non-cancelled lesson
roster and has an explicit `absent` row; model assertions are never evidence.

The weekly schedule draft runs Fridays at `0 9 * * 5` UTC (17:00
Asia/Shanghai). A candidate must repeat with the same class type, teacher,
sorted roster, local weekday, and start minute in at least three distinct weeks
of the prior four-week window. Closures, existing target-week lessons, inactive
class types, and unavailable intervals are skipped. The job can only file one
owner-confirmation `lessons_bulk_apply` proposal of at most 24 explicit lessons;
it never calls `lessons_create`. Exact structured pending payloads are checked
both in the prompt and in the executor, so a rerun does not create a duplicate
pending action. One validated proposal call consumes the run's only proposal
attempt before the POST starts; the cap remains consumed after errors so an
ambiguous failed POST cannot be retried with either the same or a different
payload in that run.

Every invocation creates one conversation plus one `job_run` row. The row
stores deterministic tool, draft, and pending-action metrics and ends as `completed`, `partial`
(including `MAX_ITERATIONS`), or `failed`; errors never store configuration or
secret values.
