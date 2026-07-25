# 01 — Core API (`apps/api`)

The only backend. Hono on Cloudflare Workers, Drizzle on D1. Owns the database, every business rule, and the REST API that all clients (admin SPA, parent SPA, iOS, **and the agent**) consume.

## Module pattern

One folder per domain under `src/modules/`; every endpoint follows the same lifecycle:

```
src/
├── index.ts                  # app wiring: cors → auth → audit → routes
├── env.ts                    # Bindings type (DB, secrets)
├── db/schema.ts              # ALL Drizzle tables (single file until it hurts)
├── middleware/
│   ├── audit.ts              # exists — do not modify without approval
│   └── auth.ts               # milestone 2: session/bearer → c.set("principal")
└── modules/<domain>/
    ├── routes.ts             # parse+validate (schema from @h2class/shared) → call service → respond
    └── service.ts            # business logic; takes (db, principal, input); composes db.batch()
```

Rules:
- Routes never touch Drizzle directly; services never read headers. Validation only via the shared schema (`schema.parse` / `safeParse`) — no hand-rolled checks.
- A service that writes ≥2 rows returns the prepared statements composed into ONE `db.batch([...])` (invariant 00-§4). Include the `message_draft` inserts in that batch (00-§5).
- Cross-module calls go service→service (import the function), never via HTTP to yourself.

## Auth & roles (from milestone 2)

- better-auth with the Drizzle/D1 adapter; bearer tokens (`Authorization: Bearer …`) for all clients.
- Store Better Auth's signing/encryption key in the `BETTER_AUTH_SECRET`
  Worker secret. It must be independent from `AGENT_SERVICE_TOKEN`.
- Roles on a person: `admin`, `staff`, `teacher`, `guardian`, plus the machine role `agent` (service account, long-lived API key, revocable — revoking it is the agent kill switch).
- `requireRole(...roles)` guard per route. **Owner-only list** (403 for `agent` and everyone below `admin`): record/refund payment, ledger adjustment, price create, pickup-authorization checkout override, any hard delete, bulk-apply, `POST /pending-actions/:id/execute`.
- The audit middleware's actor must come from the authenticated principal, replacing the current `x-actor` placeholder header (remove that in milestone 2 — it is a scaffold-only stand-in).

## Pending actions (the agent's confirm gate)

- Table: `pending_action(id, endpoint_name, payload_json, summary, status: pending|executed|rejected|expired, created_by, created_at, expires_at, resolved_by, resolved_at, result_json)`.
- `POST /pending-actions` (roles: `agent`, `admin`): validates `payload` against the target endpoint's shared schema **at creation**.
- `POST /pending-actions/:id/execute` (role: `admin`): re-validate → dispatch to the same service function the real endpoint uses → mark executed. Deterministic: execute the stored payload byte-for-byte; never re-interpret it.
- Expiry ~1h; expired actions are not executable.
- Execute/reject are registry contracts for typed clients but are hidden from
  generated agent tools. Owner-only business endpoints remain visible only as
  `propose_*` tools; adding one makes the exhaustive core dispatch fail
  typecheck until its prepared mutation is wired.

## Database conventions

- snake_case table/column names; text UUID PKs; `created_at` on everything mutable-adjacent; FK columns `<entity>_id`.
- Time rule: store instants as UTC epoch values. Lesson wall-clock input, weekday patterns, and minute-from-midnight values use Asia/Shanghai local time (fixed UTC+08:00, no DST). Calendar-only dates are `YYYY-MM-DD` local strings.
- Migrations: edit `src/db/schema.ts` → `pnpm db:generate` (drizzle-kit writes SQL into `migrations/`) → review the SQL → `pnpm db:migrate:local`. Append-only; never edit applied migrations.
- Back invariants with constraints, not just checks in code. D1 has no interactive transactions: a friendly read-check cannot lock the later write. Lesson overlap and class-capacity checks therefore run again in SQLite triggers inside the batched `INSERT`/`UPDATE` statement; a conflict aborts the whole batch. `UNIQUE(teacher_id, start_at)` and `UNIQUE(lesson_id, student_id)` additionally guard exact duplicates.

## Domain model you must not deviate from (ARCHITECTURE.md §3)

- `person` (+ `person_role`, `guardian_student` link). One person, many roles. Guardian phone number is mandatory at enrollment — it's the disaster-recovery CRM.
- `class_type` (name, capacity 1/2/N, duration, category, active) and append-only `price` versions. Money is integer fen (`unit_amount_fen`); current price is the latest `effective_from` not later than now. Price rows are never updated or deleted (see 00-§2).
- `lesson` (class_type, teacher, starts/ends, `makeup_for_lesson_id` nullable) + `enrollment` (student↔lesson). A 1v4 group lesson = 1 lesson row + 4 enrollments.
- `attendance_event` — timestamped, records who marked it, status per 00-§3; check-in/out for trusteeship validates an active subscription covers the date.
- `credit_ledger` — append-only (00-§1): `+N purchase`, `-1 attended`, `±n adjustment(reason)`.
- `entitlement` — two kinds: credit package (N credits) and trusteeship subscription (inclusive `valid_from`/`valid_to`). A student may hold both. The database persists only the lifecycle facts `active|refunded`; reads derive `exhausted|expired` from the append-only ledger and Shanghai-local validity date.
- `payment` — the append-only source of income truth; every sale and refund row references the exact price version and entitlement. Purchase list amounts are derived in core (`unit_amount_fen × credits_total` for packages; one price unit for a subscription), never accepted from a client.
- `message_draft` (00-§5) and `activity_log` (exists).
- Scheduling writes check conflicts for teacher AND student. Weekly term recurrence is inclusive of the term bounds and skips closure-calendar days.
- Scheduling foundations: `teacher_availability` stores local weekday/minute slots; replacing a pattern is one atomic delete+insert batch. `availability_exception` overrides one local date, `closure_day.date` is unique, and `term` provides inclusive local date bounds.
- Lesson create/move/cancel writes their teacher- and linked-guardian-facing Simplified-Chinese `message_draft` rows in the same `db.batch()` as the lesson mutation. Booking never deducts credits.
- `credit_ledger` is append-only at the database level. Non-trusteeship attendance deductions are conditional `INSERT ... SELECT` statements against the current `deduction_policy` and the oldest matching active package (FIFO by entitlement `created_at,id`) inside the same D1 batch as attendance and guardian drafts. A deducting attendance write with no eligible positive-balance package aborts the batch; makeup lessons never deduct. Trusteeship check-in/out instead requires a matching active subscription covering the lesson's Shanghai-local date and writes no credit entry.
- Package refunds are quote-then-confirm operations. The readonly quote uses `floor(original_paid_amount_fen × remaining_credits / credits_total)`; execution requires the quoted remaining credits and refund amount, rejects stale values with 409, and atomically appends the negative payment/ledger rows, marks the entitlement refunded, and creates the guardian draft. Subscription refunds are unsupported in v1.
- Lesson feedback is unique by lesson/student. Creating feedback and at least one linked-guardian raw Simplified-Chinese draft is one D1 batch.
- Authorized pickup people are a complete per-student replacement list. Normal checkout validates the exact pickup name when a list exists; bypass is a separate admin-only endpoint, never a request flag.
- `person.medical_notes` is sensitive: only staff/admin may write it or receive it from `people_get`; it is never selected for `people_list` or included in drafts.

## Gotchas

- `count()` and friends return possibly-undefined rows under `noUncheckedIndexedAccess` — destructure with defaults.
- D1 `batch()` fails atomically; surface lesson conflicts and capacity failures as 400 business errors, not a half-applied state.
- Never expose another family's data on guardian-scoped endpoints: guardian queries filter by the authenticated guardian's linked students, enforced in the service (not just the route).
- CORS: allow only the SPA origins in production config.
