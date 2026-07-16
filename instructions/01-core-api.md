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
- Roles on a person: `admin`, `staff`, `teacher`, `guardian`, plus the machine role `agent` (service account, long-lived API key, revocable — revoking it is the agent kill switch).
- `requireRole(...roles)` guard per route. **Owner-only list** (403 for `agent` and everyone below `admin`): record/refund payment, ledger adjustment, price create, any hard delete, bulk-apply, `POST /pending-actions/:id/execute`.
- The audit middleware's actor must come from the authenticated principal, replacing the current `x-actor` placeholder header (remove that in milestone 2 — it is a scaffold-only stand-in).

## Pending actions (the agent's confirm gate)

- Table: `pending_action(id, endpoint, payload_json, summary, status: proposed|executed|rejected|expired, created_by, expires_at, executed_by, executed_at)`.
- `POST /pending-actions` (roles: `agent`, `admin`): validates `payload` against the target endpoint's shared schema **at creation**.
- `POST /pending-actions/:id/execute` (role: `admin`): re-validate → dispatch to the same service function the real endpoint uses → mark executed. Deterministic: execute the stored payload byte-for-byte; never re-interpret it.
- Expiry ~1h; expired actions are not executable.

## Database conventions

- snake_case table/column names; text UUID PKs; `created_at` on everything mutable-adjacent; FK columns `<entity>_id`.
- Migrations: edit `src/db/schema.ts` → `pnpm db:generate` (drizzle-kit writes SQL into `migrations/`) → review the SQL → `pnpm db:migrate:local`. Append-only; never edit applied migrations.
- Back invariants with constraints, not just checks in code: e.g. `UNIQUE(teacher_id, starts_at)` guards double-booking even if two writers race (D1 has no interactive transactions).

## Domain model you must not deviate from (ARCHITECTURE.md §3)

- `person` (+ `person_role`, `guardian_student` link). One person, many roles. Guardian phone number is mandatory at enrollment — it's the disaster-recovery CRM.
- `class_type` (name, capacity 1/2/N, duration) and `price` (versioned — see 00-§2).
- `lesson` (class_type, teacher, starts/ends, `makeup_for_lesson_id` nullable) + `enrollment` (student↔lesson). A 1v4 group lesson = 1 lesson row + 4 enrollments.
- `attendance_event` — timestamped, records who marked it, status per 00-§3; check-in/out for trusteeship validates an active subscription covers the date.
- `credit_ledger` — append-only (00-§1): `+N purchase`, `-1 attended`, `±n adjustment(reason)`.
- `entitlement` — two kinds: credit package (N credits, optional expiry) and trusteeship subscription (valid_from/valid_to). A student may hold both.
- `payment` — the only source of income truth; references the price row and the entitlement it purchased.
- `message_draft` (00-§5) and `activity_log` (exists).
- Scheduling writes check conflicts for teacher AND student, and (later milestone) skip closure-calendar days.

## Gotchas

- `count()` and friends return possibly-undefined rows under `noUncheckedIndexedAccess` — destructure with defaults.
- D1 `batch()` fails atomically; surface the failure as one 409/422 with a code, not a half-applied state.
- Never expose another family's data on guardian-scoped endpoints: guardian queries filter by the authenticated guardian's linked students, enforced in the service (not just the route).
- CORS: allow only the SPA origins in production config.
