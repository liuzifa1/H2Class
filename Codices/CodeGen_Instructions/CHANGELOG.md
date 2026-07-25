# Implementation contract change log

## 2026-07-16 — Teacher settlement, operational reports, and schedule bulk apply

- Teacher/class-type rates are append-only safe-integer-fen versions. The database requires a teacher-role target, a unique teacher/class/effective instant, integer UTC epochs, and rejects every update or delete.
- Monthly settlement counts one teaching unit when any student attendance is `present`, applies the rate version effective at lesson start, and itemizes its arithmetic. Missing rates remain `null` with `rateMissing: true`; `total_fen` is the exact rated-only subtotal and `incomplete` prevents it being mistaken for a final payroll figure. Historical settlement remains readable after the person's current teacher role is revoked, while creating a new rate still requires that role.
- Income is derived from signed sale/refund payment rows by Asia/Shanghai month and class type; balances derive only from the append-only ledger plus subscription validity; the daily report returns named local-day lessons, prior-day signed income, unsent drafts, and pending unexpired actions. Report sums use exact integer arithmetic with safe JSON-number bounds.
- `lessons_bulk_apply` is a strict owner-only batch of 1–24 explicit single-lesson specifications. Direct agent calls receive 403; generated tools propose it through pending actions. Confirmed execution prepares every lesson, enrollment, and Simplified-Chinese draft in one D1 batch, with all-or-nothing rollback on any conflict.

## 2026-07-16 — Guardian portal and owner-provisioned accounts

- Guardians receive owner-provisioned email/password accounts; public self-signup remains disabled. `guardian_accounts_create` is an admin-only hidden control-plane endpoint that hashes the password before one atomic auth-user/account/person-link batch and never returns or audits plaintext.
- The four `/my/...` endpoints derive the guardian from the authenticated session and scope every result through `guardian_student` in core SQL. They accept no student id, and guardian principals receive 403 on staff/admin modules.
- `apps/web` is a mobile-first Simplified-Chinese read-only portal for linked students, upcoming schedule, ledger-derived balances and subscriptions, attendance, and feedback. It calls only Better Auth, `/me`, and `/my/...`.
- `CLIENT_ORIGINS` now configures both production SPAs; legacy `ADMIN_ORIGINS` is combined for compatibility. A locally served API trusts the admin and guardian Vite origins on ports 5173 and 5174.

## 2026-07-16 — Remaining autonomous jobs

- The 07:00 Asia/Shanghai trigger (`0 23 * * *` UTC) now dispatches renewal first and then a `reports_daily` digest. The digest advertises and executes only that one tool, uses one titled conversation, `今日简报`, and preserves signed income as integer fen.
- The 21:00 Asia/Shanghai no-show job (`0 13 * * *` UTC) follows up only explicit `absent` attendance after lesson end. Its executor admits a draft only when successful core results observed in that invocation prove the exact student is on an ended, non-cancelled lesson and has an exact absent row. Missing attendance, wrong-student rows, future lessons, cancelled lessons, and model claims cannot authorize a draft. Drafts use `no_show:<lesson UUID>:<student UUID>` and remain structurally deduplicated.
- The Friday 17:00 Asia/Shanghai weekly job (`0 9 * * 5` UTC) conservatively projects signatures seen in at least three of the previous four weeks. It filters closures, existing lessons, inactive types, and unavailable slots, then files at most one `lessons_bulk_apply` pending action (24 explicit lessons maximum); it never books directly. Exact pending payloads are deduplicated, and the first validated proposal call consumes the run-level attempt cap before POST so neither distinct payloads nor ambiguous failed-POST retries can create a second action.
- Autonomous conversations have an optional display title, while every invocation retains its immutable `job_run` lifecycle and tool/draft/proposal metrics. Stateful mock verification covers all three schedules, reruns, missing-attendance non-accusation, and zero direct weekly lesson writes.
- Registry-generated OpenAI tool schemas now preserve strict discriminated-union branches while also merging their properties into the root object shape required by strict tool consumers. The generated `propose_entitlements_purchase` schema accepts both package and subscription variants and rejects undeclared keys.

## 2026-07-16 — Autonomous renewal watch

- The agent's `scheduled()` handler now dispatches the daily renewal watch at `0 23 * * *` UTC through an extensible job registry and the same OpenAI-compatible streamed tool loop used by chat. Headless runs select their vendor model from `OPENAI_MODEL`.
- Autonomous tools are a registry-derived, execution-enforced subset: visible readonly endpoints, entries explicitly marked `autonomousWrite: true` (currently only `drafts_create`), and visible owner-only endpoints exposed only as `propose_*`. Hidden control-plane tools, operational writes, and `drafts_mark_sent` are unavailable.
- Renewal defaults are all arrears, active packages at three or fewer remaining credits, and active subscriptions expiring within 14 Asia/Shanghai calendar days. Drafts are consolidated per guardian+student and use `renewal:<student UUID>`.
- Both the prompt and executor check for an unsent draft by exact recipient/purpose/status before creation. Each invocation persists one summary conversation and one explicit `completed|partial|failed` job-run row with student and draft metrics.

## 2026-07-16 — Entitlements, payments, and package refunds

- Package and trusteeship-subscription purchases reference an exact immutable `price_id`; core derives list/paid amounts and writes entitlement, payment, purchase ledger entry (packages only), and guardian receipt draft in one batch. Zero-paid purchases are rejected.
- Payments and the credit ledger are append-only. Package attendance consumes the oldest matching positive-balance active package by deterministic FIFO; a deducting write without one aborts atomically. Makeup attendance still does not deduct.
- Trusteeship check-in/out requires an active subscription covering the lesson's Asia/Shanghai date and never consumes a package credit.
- `payments_refund_quote` computes `floor(original paid × remaining / purchased credits)`. Owner-only refund execution carries optimistic expected values, returns 409 when stale, and atomically appends the negative payment/ledger rows, marks the entitlement refunded, and creates the guardian draft. Subscription refunds are unsupported in v1.
- Package sales are bounded so every proportional refund multiplication remains within the exact-integer range; refund floors use `BigInt` arithmetic before converting the final integer-fen result back to a number.
- Arrears derive the earliest genuinely uncovered future lesson: an active matching trusteeship subscription covering that lesson's Asia/Shanghai date suppresses the false zero-ledger arrears signal, while later uncovered lessons still surface the student.
- Class types referenced by any entitlement cannot cross the `托管`/non-`托管` category boundary; the database rejects the change with `class_type_category_locked` so sold billing semantics and attendance behavior cannot drift.
- Entitlement `exhausted|expired` status is derived on reads; only active/refunded lifecycle facts are persisted. Legacy null-entitlement ledger rows are preserved and intentionally not guessed during migration.

## 2026-07-16 — Pending-action confirm gate

- Pending actions use statuses `pending|executed|rejected|expired`, expire after one hour, and always execute the canonical stored payload; execute request bodies are ignored.
- An immutable resolution claim, the prepared owner-only mutation, stored result, and resolved status commit in one D1 batch. Target failure rolls everything back and leaves the proposal pending.
- Admin control-plane endpoints remain in the shared registry for typed clients but are hidden from generated model tools. Owner-only business entries generate `propose_*` tools and are covered by an exhaustive dispatch map.

## 2026-07-16 — Lesson feedback and pickup safety

- `feedback_create` writes the unique lesson/student feedback row and at least one raw guardian-facing Simplified-Chinese draft in the same D1 batch.
- Authorized pickup people are replaced as one complete batch. Normal checkout accepts an unregistered name only when the student has no pickup list; otherwise it returns `unknown_pickup_person`.
- The pickup safety bypass is the separate owner-only `attendance_checkout_override` endpoint. Normal checkout has no override flag, and the agent service account receives 403 on the override endpoint.
- Sensitive `person.medical_notes` can be written only by staff/admin, is absent from `people_list`, and is returned by `people_get` only to staff/admin callers. Feedback drafts never include it.

## 2026-07-16 — Attendance and append-only credit ledger

- Attendance uses the binding `excused_leave` status; the seeded policy deducts for present, absent, and late-cancel statuses.
- Policy-driven ledger deductions are conditional writes inside the attendance batch. Credit-ledger updates/deletes, duplicate lesson/student deductions, and makeup-lesson deductions are rejected by the database.
- Bulk check-in atomically writes attendance, applicable `-1` ledger entries, and linked-guardian message drafts.
- Bulk check-in also completes the lesson atomically. Attendance freezes lesson times/status and enrollment membership; a database roster-count guard closes concurrent enrollment races.
- Checkout is restricted to present students, and ledger reasons must contain non-whitespace text in both shared validation and the database.

## 2026-07-16 — Lessons and transactional message drafts

- Lesson wall-clock inputs use Asia/Shanghai local dates/minutes and persist as UTC instants. Weekly recurrence is term-bounded and skips closure dates.
- Teacher/student overlap and capacity checks run authoritatively in SQLite triggers inside the write statement because D1 has no interactive transactions; any failure aborts the lesson/enrollment/draft batch.
- Bulk attendance check-in completes the lesson atomically, and enrollment rows become immutable once attendance exists so roster and lesson history cannot diverge.
- Lesson create/move/cancel insert teacher and linked-guardian Simplified-Chinese drafts in the same `db.batch()`. Booking does not deduct credits.

## 2026-07-16 — People owner-only operations

- Person role grants, role revocations, and person deletion are admin-only.
- The core returns 403 for the agent service account on these operations; agent tools expose them only as owner-confirmation proposals.
- Non-admin principals may create teacher/guardian records, but cannot assign initial `admin` or `staff` roles through `people_create`.

## 2026-07-16 — Admin browser authentication

- Better Auth and Hono CORS use the same combined `CLIENT_ORIGINS` plus legacy `ADMIN_ORIGINS` allowlist; local admin and guardian Vite origins are added only while the API itself runs on localhost.
- The core exposes the Better Auth `set-auth-token` response header so the cross-origin admin SPA can retain its bearer token.

## 2026-07-16 — Agent model API and public chat endpoint

- Supersedes the Claude/Anthropic-specific requirements in the original M2-3 task.
- The agent now calls a vendor-selected OpenAI-compatible Chat Completions API using `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and the request's `model` value. There is no Anthropic SDK or fixed model.
- The public agent route is `POST /v1/chat/completions` and streams OpenAI-compatible SSE chunks. `conversation_id` is the H2Class extension used to resume persisted agent conversations.
- Tool calls use OpenAI `tools`/`tool_calls` messages. Registry ordering remains stable, every tool result is returned, and `MAX_ITERATIONS=24` remains unchanged.
- The core authorization boundary, owner-only proposal behavior, D1 persistence, and zero-business-logic rule are unchanged.
