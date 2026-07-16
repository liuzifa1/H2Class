# 00 — Project brief (read before every task)

## What this is

H2Class runs a small Chinese K12 tutoring / after-school-care (托管) center owned by one person. It tracks students, guardians, teachers, class scheduling, attendance check-in/out, prepaid class credits, subscriptions, and payments. The owner operates the system primarily by **chatting with an AI agent**; web forms are the fallback. There is **no WeChat automation** — the owner relays messages manually, and the system prepares copy-paste-ready drafts.

Money is involved: prepaid class credits are money-equivalent. Treat correctness accordingly.

## Topology (everything runs on Cloudflare)

```
apps/api    "core"  — Cloudflare Worker: Hono + Drizzle + D1. ALL business logic and data.
apps/agent  "agent" — Cloudflare Worker: Claude agent loop. ZERO business logic; calls core's REST API.
packages/shared     — Zod v4 schemas: single source of truth for every endpoint's input/output.
apps/admin  — owner/staff SPA (React + Vite, Cloudflare Pages)   [milestone 3+]
apps/web    — parent read-mostly SPA                              [milestone 6]
apps/ios    — teacher check-in app (SwiftUI)                      [milestone 4+]
```

Stack versions (pinned in package.json — don't bump without approval): TypeScript 5.x strict, Hono 4, Drizzle 0.45 + D1, Zod **4** (`import { z } from "zod"`), wrangler 4, pnpm workspaces, `@anthropic-ai/sdk` (agent only).

## Non-negotiable invariants — the things you'd miss without context

1. **Credit ledger is append-only.** A student's remaining classes is `SUM(ledger entries)`, never a stored counter. Corrections are new entries (with reason), never UPDATEs or DELETEs of old ones.
2. **Prices are versioned.** Never UPDATE a price row; insert a new one with an effective date. Sales/purchases reference the exact price row id they were sold at.
3. **Attendance→deduction is a configurable policy**, not hardcoded. Statuses: `present`, `absent`, `excused_leave` (请假), `late_cancel`. Which of these deduct a credit comes from a policy config, read at write time.
4. **Atomicity via `db.batch()`.** D1 has NO interactive transactions. Any compound write (e.g. group check-in = N attendance rows + N ledger rows + N message drafts) must be composed as one `db.batch([...])` — all statements prepared up front. Read-check-then-write races are additionally backed by UNIQUE constraints (e.g. teacher double-booking). Never split a compound write across multiple requests or sequential awaits.
5. **Message drafts are part of the transaction.** A state change that should notify someone (lesson moved → parent + teacher notices) inserts its `message_draft` rows in the SAME batch as the change. Drafts are written in Simplified Chinese, ready to paste into WeChat.
6. **Audit everything.** Global middleware logs every successful mutating request to `activity_log` with the acting principal. Never bypass, remove, or conditionally skip it.
7. **Owner-only endpoints.** Payments, refunds, ledger adjustments, price changes, any hard delete, and bulk-apply operations require the `admin` role. The agent's `agent` role must receive **403** on these — it proposes via `POST /pending-actions` instead, and the owner confirms in the console (stored payload executed under the owner's session, re-validated at execution time).
8. **The agent worker contains zero business logic.** If you find yourself computing balances or checking conflicts in `apps/agent`, stop — that code belongs in a core endpoint.
9. **Every new endpoint gets its schema in `packages/shared`** and an entry in the endpoint registry. That registry auto-generates the agent's tools — an endpoint missing from it is invisible to the agent, which is a bug by definition.

## Global code conventions

- TypeScript strict; `verbatimModuleSyntax` is ON — type-only imports must use `import type`. `noUncheckedIndexedAccess` is ON — indexing may be `undefined`; handle it.
- No `any`. No classes where a function works. Small files, named exports.
- Domain entity ids: `text` primary keys via `crypto.randomUUID()`. Timestamps: Drizzle `integer(..., { mode: "timestamp" })` storing UTC instants. Business timezone is **Asia/Shanghai** — convert at display/parse edges only, never store local wall-clock.
- API error shape: `{ "error": "snake_case_code" }` (+ optional `message`), correct HTTP status. Never leak stack traces or SQL.
- User-facing strings (drafts, parent/teacher text): Simplified Chinese. Code, comments, logs: English.
- **No new dependencies** without the owner's approval — the allowed set is what's already in each package.json.
- Secrets only via wrangler secrets / `.dev.vars` (gitignored). Never in code, config, or docs. `ANTHROPIC_API_KEY` exists only on the agent worker.
- Workers runtime: web APIs (`fetch`, `crypto`), no Node `fs`/`net`; `nodejs_compat` is enabled but don't lean on it without need.

## Verification (definition of done)

```sh
pnpm typecheck                 # must pass with zero errors
pnpm db:migrate:local          # if you added a migration: applies cleanly on a fresh local DB
pnpm dev:api                   # then exercise your endpoint with curl, including a failure case
```

- New/changed endpoint → prove: happy path, one validation failure (400), one authz failure (403) if role-gated, and that an audit row appeared.
- Migrations are append-only files in `apps/api/migrations/`. NEVER edit an already-committed migration; add a new one.
- If your change alters any contract described in these briefs, update the brief in the same task.

## When docs disagree

`instructions/` (these files) > TECH_STACK.md §5.1 (Workers variant) > older baseline text elsewhere. If something is genuinely undecided, stop and ask the owner.
