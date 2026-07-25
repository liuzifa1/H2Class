# H2Class — Agent Service (agent-first operations)

Companion to [ARCHITECTURE.md](ARCHITECTURE.md) and [TECH_STACK.md](TECH_STACK.md). There is no WeChat automation — the owner relays WeChat messages manually. Everything else — sign-ups, arranging, rescheduling, renewals, follow-ups — is agentic.

Two-module split (this doc covers module 2):

1. **Core module** (`apps/api`) — owns everything: database, business logic, invariants, the REST API.
2. **Agent module** (`apps/agent`) — the brain. Calls the core API **like a web client does**. Zero business logic.

## 1. What it is

The agent is the **primary way to operate the system**. You talk to it in the admin console (typed, or pasted straight from a WeChat conversation):

> "新学生：小红，三年级。妈妈李女士 138xxxx1234。想每周六上午数学 1v1，王老师。今天买了 20 次课，微信转账 4800。"

One message; the agent then: creates the student + guardian (phone captured — the real CRM), proposes the payment record (**your one-click confirm**), finds Wang's Saturday slots, books the recurring lessons, and drafts the welcome message for you to paste into WeChat. The console's forms remain as manual fallback.

## 2. Architecture: a client, not a second backend

`apps/agent` is a separate small Cloudflare Worker:

- **It talks to core only through the public REST API**, authenticated with a service-account token — same endpoints, same validation, same audit path as the admin console. If the API can't do something, neither can the agent; there is no back door.
- **Hard rule: core data only via the API.** The agent keeps its *own* state (conversations, run history) in a separate D1 database and never touches core tables directly.
- **Independent lifecycle**: deploy/restart/upgrade the agent without touching core; a crashed agent means "back to forms," never broken data.
- **Chat plumbing**: the admin console opens the chat against the agent service (`POST /v1/chat/completions`, streamed). The agent validates the owner's session by calling core's `/me` with the forwarded token — only authenticated admins can drive it.

```
apps/agent/src/
├── index.ts      # OpenAI-compatible chat endpoint (streamed), health
├── loop.ts       # OpenAI-compatible agent loop ↔ tools
├── tools.ts      # tool registry, generated from packages/shared schemas
├── api.ts        # typed client for the core API (service-account token)
├── jobs.ts       # autonomous runs (cron): digest, renewal watch, …
└── prompt.ts     # system prompt: policies, tone, boundaries
```

## 3. The "every function" guarantee, API edition

Core already defines every endpoint's request/response with Zod in `packages/shared` (TECH_STACK.md §2). The agent generates its **tool registry from those same schemas**: one tool per endpoint, `strict: true`, plus a short prescriptive description of when to use it.

Consequence: **a new core endpoint is agent-operable the day it ships** — adding the feature *is* adding the tool. No drift, no agent blind spots. (What used to be "three facades" is now simpler: the API is the single facade; forms, agent, and jobs are all just clients.)

## 4. OpenAI-compatible model API setup

| Setting | Value | Why |
|---|---|---|
| Client | Workers-native `fetch` | Vendor-neutral and dependency-free |
| Endpoint | `OPENAI_BASE_URL` + `/chat/completions` | Works with the selected OpenAI-compatible vendor |
| Model | Inbound request's `model` string | Vendor and deployment choose the model |
| Streaming | Yes, through to the console | You watch it work |
| Tools | OpenAI function tools; stable sorted order | Generated from the endpoint registry |

## 5. Permission model: enforced by tokens, not trust

The agent's service account has role `agent`, and the **core API** decides what that role can do — the gate is authorization, not agent self-restraint:

| Class | Examples | `agent` role can… |
|---|---|---|
| **Reads** | schedules, balances, availability, reports | Call freely |
| **Operational writes** | create/move/cancel lesson, enroll, create person, set availability | Call directly — same conflict checks as a human admin, audit-logged as the agent's service account |
| **Owner-only** | record payment, ledger adjustment, refund, price change, deletions, bulk apply | **403.** The agent cannot call these at all — with any prompt, any bug, any injection. It can only *propose* |

Proposals — the confirm gate, API edition:

1. Agent calls `POST /pending-actions { endpoint, payload }`. Core validates the payload against that endpoint's own schema and stores it.
2. The admin console lists pending actions as cards: human-readable summary + exact payload ("Record payment: 李女士, ¥4800, 20-class package for 小红").
3. You confirm → core executes **the stored payload under your authority** (your session, your audit entry). The model never re-generates the action after approval. Reject → the agent is told and adjusts.
4. Pending actions expire (e.g. 1h) and are **re-validated at execution time** (balance/slot may have changed).

This is strictly stronger than an in-process flag: even a fully compromised agent process holds a token that physically lacks the permission to move money.

## 6. Human-as-transport: the message drafts queue

You handle WeChat manually — the agent still closes the notify loop by **drafting every outbound message**:

- Core endpoints that change state (reschedule, book, cancel) insert `message_draft (person_id, purpose, text, status)` rows **in the same transaction** — this is why compound operations must be single core endpoints, not agent-composed sequences: atomicity lives in core, orchestration lives in the agent.
- Lesson drafts are ready-to-paste Simplified Chinese and identify the student, class type, teacher-facing or guardian-facing purpose, and concrete local time; move notices show the old → new time.
- The console shows the drafts queue: contact + ready-to-paste text + copy button. Paste into WeChat, tap "sent" (logged). Unsent drafts stay visibly pending.
- The agent can also file standalone drafts (renewal reminders) via `POST /message-drafts`.
- The queue's consumer is swappable: if an automated messaging channel is ever added, it replaces your clipboard — nothing else changes.

## 7. The workflows ("full agentic" in practice)

| Workflow | Trigger | What the agent does | Owner click? |
|---|---|---|---|
| **New sign-up** | You paste the info blob | Create person + guardian, propose package + payment, book recurring lessons, draft welcome message | Payment only |
| **Arrange / reschedule** | You paste the parent's request | Check credits + availability + conflicts, book or move, draft notices to parent + teacher | No |
| **请假 / absence** | Paste | Apply deduction policy, offer makeup slots, draft reply | No |
| **Renewal watch** | Autonomous, daily | Scan low balances + expiring subscriptions, draft reminders, summarize | No (drafts wait for you anyway) |
| **No-show follow-up** | Autonomous, after lesson blocks | Cross-check attendance vs schedule, flag anomalies, draft follow-ups | No |
| **Daily digest** | Autonomous, morning | Today's lessons, pending drafts, pending confirmations, yesterday's income | — |
| **Weekly schedule draft** | Autonomous, Friday | Propose next week's schedule from recurring patterns + the week's requests | Bulk-apply via pending action |

Autonomous runs are the same loop, headless, scheduled inside the agent service. Their output can only ever be operational writes, drafts, and pending actions — an unattended run can never move money or send anything.

## 8. The loop (sketch)

```ts
// apps/agent/src/loop.ts — tools call the core API like any client
for (const call of response.tool_calls ?? []) {
  const tool = registry[call.function.name];
  // owner-only endpoints aren't in the registry as direct calls —
  // they exist only as propose_* tools that hit POST /pending-actions
  const input = JSON.parse(call.function.arguments);
  const result = await tool.execute(input); // → api.ts → core REST
  results.push({ role: "tool", tool_call_id: call.id, content: result });
}
```

Plus: manual loop (not the SDK tool runner) for logging/streaming control, max-iteration cap, per-conversation history persisted in the agent's own tables. Still a small service — a few hundred lines.

## 9. Audit & safety

- Core logs every API call with its actor — agent traffic is attributed to the service account + conversation id (sent as a header); confirmations are attributed to you.
- The agent inherits every core invariant by construction — it literally cannot reach the database except through validated endpoints.
- Iteration caps + daily token budget as a cost fuse.
- **Kill switch = revoke the service token** (or flip it read-only in core's role config). No deploy needed, core untouched.
- Data sent to the configured model vendor = conversation + tool returns (scoped responses, not bulk dumps). Review that vendor's data-use and retention terms before production use.

## 10. Cost

Cost depends on the selected OpenAI-compatible vendor and model. Track input/output usage and set vendor-side spend limits before production use; the loop's iteration cap remains the worker-side fuse.

## 11. Build order

The agent service grows with the core, nearly for free (§3):

1. Milestones 1–2 (TECH_STACK.md §6): core skeleton, auth, people — **agent service ships here**: chat UI, people tools, `agent` role + service token. Sign-up works (minus payments).
2. Milestone 3 (catalog + scheduling): arranging tools arrive with the endpoints. Drafts queue ships in core.
3. Milestone 4 (attendance + ledger): 请假 policy, no-show follow-up. `POST /pending-actions` + console cards ship here.
4. Milestone 5 (entitlements + payments): full sign-up incl. payment proposal; renewal watch.
5. Milestone 6 (reports): daily digest, then the autonomous cron runs.
6. Someday, optionally: an automated messaging channel replaces the clipboard as drafts-queue consumer.
