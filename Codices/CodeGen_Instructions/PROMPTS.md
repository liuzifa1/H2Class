# Task prompts for implementation models

How to dispatch work to a cheaper model, and the ready-to-use prompts for milestone 2.

## Dispatch rules

- **One task = one session.** Never give a whole milestone in one prompt; each prompt below is sized for a single focused session.
- **Sequence matters.** M2-1 → M2-2 → M2-3 (each builds on the previous).
- **Review gate:** before merging anything that touches `credit_ledger`, `payment`, migrations, or auth, have a stronger model (or the owner) review the diff against `instructions/00-project-brief.md`'s invariants.
- Model guidance: core/auth/money code → mid-tier model minimum; SPA scaffolding and styling → cheapest tier is fine.

## The template

```text
## Task: <one line>

You are implementing part of H2Class, a pnpm monorepo running on Cloudflare
Workers (Hono + Drizzle/D1 + Zod v4). You do not have the project's design
history — the briefs below contain everything you need. Do not improvise
beyond them.

1. READ FIRST, completely, before writing any code:
   - instructions/00-project-brief.md        (global invariants — binding)
   - instructions/<component brief(s)>
   - <specific design-doc sections, if relevant>

2. SCOPE — build exactly this:
   - <deliverables, with file paths>

3. OUT OF SCOPE — do not touch:
   - <files/areas>

4. APPROVED EXCEPTIONS for this task (overrides the no-new-deps rule):
   - <explicitly approved dependencies/config, or "none">

5. CONSTRAINTS MOST AT RISK in this task (repeated from the briefs on purpose):
   - <2–4 items>

6. PLAN BEFORE CODE: output a short plan (tables, endpoints, files) and check
   it against the briefs. If the plan needs anything the briefs don't cover —
   a dependency, an undecided policy, a missing endpoint — STOP and output
   your questions instead of code.

7. VERIFY (run all; paste the output in your report):
   - pnpm typecheck
   - pnpm db:migrate:local        # if migrations changed — must apply on a fresh DB
   - <specific curl smoke tests, including one 400 and one 403 case>

8. REPORT: files changed and why · verification output · deviations from the
   briefs (target: none — any deviation must be flagged, not silent).
```

---

## M2-1 — Core: auth, roles, principal-aware audit

```text
## Task: add authentication, roles, and a service-account token to the core API

You are implementing part of H2Class, a pnpm monorepo running on Cloudflare
Workers (Hono + Drizzle/D1 + Zod v4). You do not have the project's design
history — the briefs below contain everything you need. Do not improvise.

1. READ FIRST: instructions/00-project-brief.md, instructions/01-core-api.md.

2. SCOPE — in apps/api:
   - Integrate better-auth (Drizzle/D1 adapter, email+password, bearer tokens).
     Mount its handler under /auth/*. No public self-signup: seed one admin
     account via a documented one-off script or SQL in the migration notes.
   - Tables via migration: better-auth's required tables, plus person_role
     (person_id, role) with role ∈ admin|staff|teacher|guardian. (The person
     table itself is task M2-2; for now roles may attach to the auth user id.)
   - Auth middleware: reads the bearer token, sets c.var.principal =
     { id, roles } for handlers. requireRole(...roles) guard helper.
   - Service-account auth: if Authorization equals the AGENT_SERVICE_TOKEN
     secret (wrangler secret), principal = { id: "agent", roles: ["agent"] }.
     Rotating that secret is the agent kill switch — no other agent auth path.
   - GET /me → { id, roles } for any authenticated principal.
   - Update the audit middleware to take actor from the principal and DELETE
     the temporary x-actor header path. Remove POST /dev/ping.
   - Protect everything except /health and /auth/* behind authentication.

3. OUT OF SCOPE: people module (M2-2), the agent worker (M2-3), any SPA.

4. APPROVED EXCEPTIONS: dependency "better-auth" (latest) in apps/api only.

5. CONSTRAINTS MOST AT RISK:
   - Audit middleware must keep logging every successful mutation (00-§6).
   - Password hashing must run on Workers (better-auth's default scrypt is
     fine); never store or log plaintext.
   - Error shape { "error": "snake_case_code" }; 401 vs 403 must be distinct.

6. PLAN BEFORE CODE (stop and ask if better-auth's D1/Workers setup requires
   anything not listed here).

7. VERIFY: pnpm typecheck · fresh pnpm db:migrate:local · curl: login → /me
   with token (200), /me without token (401), a requireRole("admin") test
   route hit with the AGENT_SERVICE_TOKEN (403), and confirm an activity_log
   row shows the real actor id.

8. REPORT as per template.
```

## M2-2 — Core: people module

```text
## Task: implement the people module (persons, roles, guardian↔student links)

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md, instructions/01-core-api.md,
   instructions/03-shared-schemas.md.

2. SCOPE:
   - packages/shared: person schemas + endpoint registry entries (create the
     registry file per brief 03 if it does not exist yet) for:
     people_create, people_update, people_get, people_list (filter by role,
     name search), guardian_link_create (guardian↔student),
     people_role_grant / people_role_revoke (ownerOnly: true).
   - apps/api migration: person (id, name, phone, school?, grade?, notes?,
     created_at), guardian_student (guardian_id, student_id, UNIQUE pair),
     person_role now references person; link auth users to person via
     person.auth_user_id (nullable — students usually have no login).
   - apps/api src/modules/people/: routes.ts + service.ts per brief 01.
     Guardian phone is REQUIRED when creating a person with role guardian.
     Role grant/revoke and person delete are owner-only (403 for agent).
   - Audit rows must carry entity="person", entity_id, and a one-line summary.

3. OUT OF SCOPE: auth internals (done in M2-1), agent worker, scheduling.

4. APPROVED EXCEPTIONS: none.

5. CONSTRAINTS MOST AT RISK:
   - Every endpoint validated by the shared schema and present in the
     registry (00-§9) — the agent's tools are generated from it.
   - .strict() input objects; ids are UUID strings; no z.date().
   - Migrations append-only; UNIQUE constraint on guardian_student pair.

6. PLAN BEFORE CODE. 7. VERIFY: typecheck · fresh migrate · curl happy path,
   one 400 (schema), one 403 (role grant with agent token) · audit row check.
8. REPORT as per template.
```

## M2-3 — Agent service v1 (chat + people tools)

```text
## Task: implement the agent worker's chat loop with tools generated from the registry

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md,
   instructions/02-agent-service.md (follow its OpenAI-compatible API facts
   exactly),
   instructions/03-shared-schemas.md. Also ../AGENT.md §5 and §8.

2. SCOPE — in apps/agent:
   - src/api.ts: typed fetch client for the core API using CORE_API_TOKEN;
     base URL from CORE_API_URL.
   - src/tools.ts: generate the tool array from packages/shared's endpoint
     registry per brief 02 (ownerOnly entries become propose_<name> tools
     that call POST /pending-actions — if core does not yet expose
     /pending-actions, propose_* tools return an is_error tool_result saying
     the capability is pending; do NOT invent the endpoint).
   - src/loop.ts: the manual OpenAI tool-call loop per brief 02 (streaming,
     every tool result returned, MAX_ITERATIONS=24).
   - src/index.ts: POST /v1/chat/completions — validate the caller by forwarding their
     bearer token to core GET /me and requiring role admin; stream the
     model's text back as SSE; honor AGENT_DISABLED=1 → 503.
   - Conversation persistence in the agent's own D1 (new binding AGENT_DB,
     database h2class-agent): conversation + message tables, own migration
     setup mirroring apps/api's (wrangler d1 migrations, separate dir).
   - src/prompt.ts per brief 02's system-prompt section.

3. OUT OF SCOPE: core endpoints, admin SPA, cron jobs, pending-action
   execution UI.

4. APPROVED EXCEPTIONS: none (all deps already present).

5. CONSTRAINTS MOST AT RISK:
   - Vendor-neutral OpenAI-compatible Chat Completions via direct fetch;
     pass through the request model and do not add vendor-specific fields.
   - Zero business logic in this worker (00-§8) — every fact comes from a
     core endpoint response.
   - Tool array in stable sorted order; no assistant prefill.

6. PLAN BEFORE CODE. 7. VERIFY: typecheck · agent + core running locally ·
   curl an SSE chat that triggers people_list and returns real data · a chat
   asking for a role grant must yield a proposal/pending message, never a
   direct grant · /v1/chat/completions without a valid admin token → 401/403.
8. REPORT as per template.
```

---

## M3-1 — Core: catalog (class types + versioned prices)

```text
## Task: implement the catalog module (class types, versioned price list)

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md, instructions/01-core-api.md,
   instructions/03-shared-schemas.md. Also ../ARCHITECTURE.md §3.2.

2. SCOPE:
   - Migration: class_type (id, name, capacity, duration_min, category
     素质类|托管|学科, active) and price (id, class_type_id, unit_amount_fen
     INTEGER, effective_from, created_at). Prices are APPEND-ONLY versions —
     current price = latest effective_from ≤ now. Money is integer 分 (fen);
     never floats.
   - packages/shared + registry entries: class_types_create, class_types_update,
     class_types_list; prices_set (ownerOnly: true), prices_list (includes
     history), prices_current_get. Follow the existing people_* naming style.
   - apps/api src/modules/catalog/: routes + service per brief 01. prices_set
     INSERTS a new version — updating or deleting a price row is forbidden.

3. OUT OF SCOPE: scheduling, entitlements, discounts (a discount is recorded
   on the sale in M5, never by editing a price).

4. APPROVED EXCEPTIONS: none.

5. CONSTRAINTS MOST AT RISK:
   - Price rows are immutable versions (00 invariants) — historical income
     must never silently change.
   - Money = integer fen everywhere; schema field names end in _fen.
   - ownerOnly on prices_set: agent token must get 403.

6. PLAN BEFORE CODE. 7. VERIFY: typecheck · fresh migrate · curl: create type,
   set price twice, prices_current_get returns the newer, prices_list shows
   both · prices_set with agent token → 403 · one 400 schema case.
8. REPORT as per template.
```

## M3-2 — Core: scheduling foundations (availability, closures, terms)

```text
## Task: teacher availability, closure calendar, and terms

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md, instructions/01-core-api.md,
   instructions/03-shared-schemas.md. Also ../ARCHITECTURE.md §3.5 and §3.9
   (Holiday & term calendar).

2. SCOPE:
   - Migration: teacher_availability (teacher_id, weekday 0-6, start_min,
     end_min — minutes from local midnight), availability_exception
     (teacher_id, date, available bool, start_min?, end_min?), closure_day
     (date UNIQUE, reason), term (id, name e.g. 2026秋季, start_date, end_date).
   - Registry + module endpoints: availability_set (replaces a teacher's
     weekly pattern atomically in one batch), availability_get,
     availability_exception_set, closure_days_set, closure_days_list,
     terms_create, terms_list.
   - TIME RULE (binding, brief 01): all instants stored as UTC epoch;
     schedule times are wall-clock in Asia/Shanghai; weekday/minute patterns
     are local. Dates are "YYYY-MM-DD" local strings.

3. OUT OF SCOPE: lessons/conflicts (M3-3), rooms (explicitly deferred).

4. APPROVED EXCEPTIONS: none. (No date libraries — write the small
   Asia/Shanghai helpers by hand; the offset is fixed +08:00, no DST.)

5. CONSTRAINTS MOST AT RISK:
   - Replacing a weekly pattern = delete + insert in ONE db.batch (00-§5).
   - UNIQUE(closure_day.date); UNIQUE(teacher_availability slot) to prevent
     duplicate patterns.
   - Non-teacher person id in availability endpoints → 400 role check.

6. PLAN BEFORE CODE. 7. VERIFY: typecheck · fresh migrate · curl: set a
   pattern, replace it, get reflects replacement only · closure day dedupe
   (second insert → 400 or idempotent per your plan — state which) · 403 case
   (availability_set with a guardian-role token if available, else document).
8. REPORT as per template.
```

## M3-3 — Core: lessons + message drafts queue

```text
## Task: lessons (book/move/cancel, conflicts, free slots) + transactional message drafts

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md, instructions/01-core-api.md,
   instructions/03-shared-schemas.md. Also ../ARCHITECTURE.md §3.5 and
   ../AGENT.md §6 (drafts are part of every lesson mutation).

2. SCOPE:
   - Migration: lesson (id, class_type_id, teacher_id, start_at, end_at,
     status scheduled|completed|cancelled, makeup_for_lesson_id NULLABLE
     REFERENCES lesson, term_id?, created_at), enrollment (lesson_id,
     student_id, UNIQUE pair), message_draft (id, person_id, purpose, text,
     status draft|sent, created_at, sent_at?).
   - Registry + modules scheduling/ and drafts/:
     lessons_create (single or recurring-by-weekday over a term; skips
     closure_days), lessons_move, lessons_cancel, lessons_get, lessons_list
     (by range/teacher/student), free_slots_find (teacher availability minus
     existing lessons minus closures), enrollments_add, enrollments_remove,
     drafts_list, drafts_mark_sent, drafts_create (for standalone agent
     drafts).
   - CONFLICT RULE: reject overlap for the same teacher and for the same
     student (overlap query inside the same batch step; document the D1
     read-then-write caveat exactly as brief 01 describes it).
   - DRAFTS RULE: lessons_create/move/cancel insert guardian- and
     teacher-facing drafts IN THE SAME db.batch as the mutation. Draft text:
     Simplified Chinese, concrete (student, subject, old→new time).

3. OUT OF SCOPE: attendance, credits (M4) — booking does not deduct anything.

4. APPROVED EXCEPTIONS: none.

5. CONSTRAINTS MOST AT RISK:
   - Mutation + its drafts = ONE atomic batch (00-§5) — never two calls.
   - Recurring creation must skip closure_days and cap at the term bounds.
   - enrollments_add must not exceed class_type.capacity → 400
     "class_full".

6. PLAN BEFORE CODE. 7. VERIFY: typecheck · fresh migrate · curl: book a
   recurring set across a closure day (verify the skip), move one lesson and
   list its two drafts, teacher-overlap booking → 400 conflict, capacity
   overflow → 400 class_full · drafts_mark_sent flips status and is audited.
8. REPORT as per template.
```

## M3-4 — Admin console SPA v1 (frontend-only task)

```text
## Task: scaffold apps/admin — login, agent chat, people, drafts queue

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md, instructions/04-admin-console.md,
   instructions/02-agent-service.md §Public chat contract.

2. SCOPE — new package apps/admin (React + Vite + TypeScript):
   - Auth: email+password against core /auth/*; keep the bearer token;
     VITE_CORE_URL + VITE_AGENT_URL from env; 401 anywhere → login screen.
   - Chat page: streams POST {VITE_AGENT_URL}/v1/chat/completions
     (chat.completion.chunk SSE + data: [DONE]); send conversation_id from
     the x-conversation-id response header on follow-ups; conversation list
     in localStorage for now.
   - People page: list/search/create/edit against core (people_* endpoints).
   - Drafts page: pending drafts with copy-to-clipboard + "已发送" button
     (drafts_mark_sent); sent items collapse below.
   - Minimal, clean, desktop-first; Simplified Chinese UI labels.

3. OUT OF SCOPE: core and agent code (bug reports instead of fixes),
   pending-action cards (M4-3), scheduling UI (chat is the scheduling UI).

4. APPROVED EXCEPTIONS: creating apps/admin with react, react-dom, vite,
   @vitejs/plugin-react, typescript, @tanstack/react-query, tailwindcss.
   Nothing else without asking.

5. CONSTRAINTS MOST AT RISK:
   - Never send OPENAI_* or core service tokens from the browser — the SPA
     only ever holds the owner's own session token.
   - SSE parsing must handle multi-byte UTF-8 (Chinese) split across chunks.
   - All API types imported from @h2class/shared — no hand-written copies.

6. PLAN BEFORE CODE. 7. VERIFY: pnpm typecheck · pnpm --filter admin build ·
   manual: login, a chat that lists people, copy+mark a draft · screenshot or
   text description of each page in the report.
8. REPORT as per template.
```

---

## M4-1 — Core: credit ledger + attendance (the money loop)

```text
## Task: append-only credit ledger, attendance check-in/out, deduction policy

⚠ REVIEW GATE: a stronger model or the owner must review this diff.

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md (invariants — all of them),
   instructions/01-core-api.md, ../ARCHITECTURE.md §3.4, §3.6, §3.9 (pickup).

2. SCOPE:
   - Migration: credit_ledger (id, student_id, entitlement_id NULLABLE until
     M5, delta INTEGER credits, kind purchase|attendance|adjustment|refund,
     lesson_id?, reason, created_by, created_at) — NO update/delete paths;
     deduction_policy (attendance_status → deducts bool, editable config,
     seeded: present=true, absent=true, excused=false, late_cancel=true);
     attendance (lesson_id, student_id, status
     present|absent|excused_leave|late_cancel, checked_in_at?, checked_out_at?,
     picked_up_by?, marked_by, UNIQUE(lesson_id, student_id)).
   - Registry + attendance module: attendance_checkin (BULK: one call takes
     the lesson id + per-student statuses → in ONE db.batch writes N
     attendance rows + N ledger deltas per deduction_policy + drafts to each
     guardian), attendance_checkout (records time + picked_up_by),
     attendance_list, leave_request (marks excused ahead of time, policy
     applied), balances_get (student → SUM(delta), and per-student list),
     deduction_policy_get / deduction_policy_set (ownerOnly),
     ledger_adjustment_create (ownerOnly), ledger_list (paginated, readonly).

3. OUT OF SCOPE: entitlements/payments (M5 — ledger rows may carry NULL
   entitlement_id until then), lesson feedback (M4-4), iOS.

4. APPROVED EXCEPTIONS: none.

5. CONSTRAINTS MOST AT RISK:
   - Ledger is APPEND-ONLY; balance is ALWAYS derived by SUM — never store a
     counter anywhere (00 invariant #1).
   - Group check-in is ONE atomic batch: attendance + ledger + drafts
     together or nothing.
   - Deduction follows deduction_policy config — never hardcode statuses.
   - ledger_adjustment_create and deduction_policy_set: 403 for agent token.

6. PLAN BEFORE CODE. 7. VERIFY: typecheck · fresh migrate · curl: bulk
   check-in of 3 students (1 excused) → exactly 2 ledger rows, 3 attendance
   rows, 3 drafts; balances_get reflects −2; repeat same check-in → UNIQUE
   rejection, ledger unchanged (prove no double-deduct) · 403 adjustment with
   agent token · audit rows present.
8. REPORT as per template.
```

## M4-2 — Core: pending actions (the confirm gate)

```text
## Task: pending-actions endpoints — agent proposes, owner executes

⚠ REVIEW GATE: a stronger model or the owner must review this diff.

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md, instructions/01-core-api.md,
   ../AGENT.md §5 (the four-step gate — implement it exactly).

2. SCOPE:
   - Migration: pending_action (id, endpoint_name — a key of the shared
     registry, payload_json, summary, status pending|executed|rejected|expired,
     created_by, created_at, expires_at = created_at + 1h, resolved_by?,
     resolved_at?, result_json?).
   - Registry + module: pending_actions_create (agent-callable; validates
     payload against the target registry entry's input schema AND that the
     target is ownerOnly; stores; returns id + summary),
     pending_actions_list (pending first), pending_actions_execute
     (ADMIN ONLY — re-validates the STORED payload against the schema, checks
     expiry, dispatches to the target service function under the admin
     principal, stores result, audits with both creator and executor),
     pending_actions_reject (admin only, with optional reason).
   - Execution dispatch: a server-side map from registry endpoint_name to
     service function — add a registry→service dispatch table with exhaustive
     `satisfies` typing so a new ownerOnly endpoint fails typecheck until
     it's wired here.

3. OUT OF SCOPE: console UI (M4-3), agent tools (already emit propose_* —
   verify the shape matches, report any mismatch instead of changing agent
   code).

4. APPROVED EXCEPTIONS: none.

5. CONSTRAINTS MOST AT RISK:
   - Execute runs the STORED payload — nothing from the execute request body
     may alter it (AGENT.md §5.3).
   - Re-validate at execute time; expired → 410 "pending_action_expired".
   - pending_actions_execute/reject: admin only — 403 for the agent token.

6. PLAN BEFORE CODE. 7. VERIFY: typecheck · fresh migrate · curl: agent token
   proposes a role grant → admin lists → executes → role actually granted +
   both audit rows; reject path; expired action → 410; agent token calling
   execute → 403; tampered execute body ignored (prove stored payload wins).
8. REPORT as per template.
```

## M4-3 — Admin console: pending-action cards (frontend-only)

```text
## Task: pending-actions page — confirm/reject cards

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md, instructions/04-admin-console.md,
   ../AGENT.md §5.

2. SCOPE — in apps/admin: a Pending Actions page: card per pending action
   (human summary large, exact payload in a collapsible <pre>), 确认执行 and
   拒绝 buttons calling pending_actions_execute/reject, optimistic refresh,
   executed/rejected history below. Badge with pending count in the nav.

3. OUT OF SCOPE: core/agent code.
4. APPROVED EXCEPTIONS: none (deps already approved in M3-4).
5. CONSTRAINTS MOST AT RISK: show the EXACT stored payload — never re-derive
   or prettify values (amounts especially); expired actions render disabled.
6. PLAN BEFORE CODE. 7. VERIFY: typecheck · build · manual flow against a
   seeded pending action (describe or screenshot).
8. REPORT as per template.
```

## M4-4 — Core: lesson feedback + pickup safety (K12 v1 items)

```text
## Task: lesson feedback records + pickup authorization

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md, instructions/01-core-api.md,
   ../ARCHITECTURE.md §3.9 (Lesson feedback, Pickup & safety).

2. SCOPE:
   - Migration: lesson_feedback (lesson_id, student_id, content_covered,
     homework, performance_note, created_by, created_at, UNIQUE(lesson_id,
     student_id)); pickup_person (student_id, name, phone, relation);
     person.medical_notes TEXT column (append-only migration).
   - Registry + endpoints: feedback_create (teacher writes bullets; also
     inserts a guardian-facing draft in the same batch — the agent may later
     polish wording via drafts_create, but feedback always produces at least
     the raw draft), feedback_list (by student/lesson),
     pickup_persons_set (per student, batch replace), pickup_persons_list.
   - attendance_checkout: validate picked_up_by against pickup_person names
     when the student has any registered; unknown name → 400
     "unknown_pickup_person". The bypass is a separate ownerOnly
     attendance_checkout_override endpoint; normal checkout has no flag.

3. OUT OF SCOPE: iOS UI (M4-5), agent prompt changes.
4. APPROVED EXCEPTIONS: none.
5. CONSTRAINTS MOST AT RISK: feedback + its draft = one batch; medical notes
   are sensitive (PIPL) — never include them in drafts or agent tool list
   output; only people_get for staff/admin returns them.
6. PLAN BEFORE CODE. 7. VERIFY: typecheck · fresh migrate · curl feedback →
   draft exists; checkout with unregistered name → 400; medical_notes absent
   from people_list output (prove it).
8. REPORT as per template.
```

## M4-5 — iOS teacher app v1 (optional, parallel track)

```text
## Task: SwiftUI teacher app — login, today's lessons, check-in/out, feedback

[Same preamble as the template. Requires a Mac with Xcode; the model writes
Swift sources + setup instructions, the owner creates the Xcode project.]

1. READ FIRST: instructions/00-project-brief.md, instructions/06-ios-app.md.

2. SCOPE — apps/ios sources: login (email+password → bearer in Keychain),
   Today screen (lessons_list filtered to me, tap → roster), bulk check-in
   (per-student status picker matching attendance_checkin's statuses),
   check-out with pickup-person picker, feedback form (three text fields →
   feedback_create). Errors surface the API's error code verbatim.

3. OUT OF SCOPE: any scheduling/booking UI, guardian data beyond the roster.
4. APPROVED EXCEPTIONS: none — URLSession + SwiftUI only, no packages.
5. CONSTRAINTS MOST AT RISK: token in Keychain (never UserDefaults); the
   check-in call is ONE bulk request per lesson, not N requests.
6. PLAN BEFORE CODE. 7. VERIFY: swift build if possible; otherwise compile
   instructions + a walkthrough of each screen's request/response pairs.
8. REPORT as per template.
```

---

## M5-1 — Core: entitlements + payments (money in)

```text
## Task: entitlements (packages & subscriptions), payments, refunds

⚠ REVIEW GATE: a stronger model or the owner must review this diff.

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md (invariants),
   instructions/01-core-api.md, ../ARCHITECTURE.md §3.3, §3.7, §3.9
   (discounts & receipts, arrears).

2. SCOPE:
   - Migration: entitlement (id, student_id, kind package|subscription,
     class_type_id?, credits_total? for package, valid_from?, valid_to? for
     subscription, price_id REFERENCES price — the version sold at, status
     active|exhausted|expired|refunded, created_at); payment (id,
     entitlement_id, price_id, guardian_id, list_amount_fen, discount_fen DEFAULT 0,
     paid_amount_fen, method wechat|cash|other, receipt_no UNIQUE, note,
     created_by, created_at).
   - Registry + module: entitlements_purchase (ownerOnly — ONE batch:
     entitlement + payment + ledger +N purchase row (packages) + receipt
     draft to guardian), entitlements_list (per student, with derived
     remaining = SUM of that entitlement's ledger), payments_list,
     payments_refund (ownerOnly — ONE batch: negative ledger row kind=refund
     + payment row negative amounts + entitlement status=refunded + draft;
     refund amount computed as floor(original paid amount × remaining credits
     / purchased credits)), payments_refund_quote (readonly, returns the
     optimistic expected values before confirming via pending action),
     arrears_list (students with negative or zero balance and a future
     lesson).
   - Wire attendance's ledger rows to consume the oldest matching active
     package (entitlement_id no longer NULL for new deductions; document the
     legacy-null backfill note). Trusteeship attendance validates an active
     subscription and does not deduct credits.

3. OUT OF SCOPE: renewal-watch agent job (M5-2), reports (M6).
4. APPROVED EXCEPTIONS: none.
5. CONSTRAINTS MOST AT RISK:
   - Every money movement is ledger rows in ONE batch — purchase and refund
     are single endpoints, never agent-composed sequences (00-§5).
   - payment references the price VERSION (price_id) — list_amount comes
     from it, discount is recorded on the payment, prices are never edited.
   - All three: entitlements_purchase, payments_refund, plus existing
     ledger_adjustment_create → 403 for agent token (propose_* only).
6. PLAN BEFORE CODE. 7. VERIFY: typecheck · fresh migrate · curl: purchase a
   20-credit package (check ledger +20, receipt draft, remaining=20) · a
   check-in deducts against it · refund computes remaining × price and
   writes the negative pair · agent token on purchase → 403 · duplicate
   receipt_no → 400.
8. REPORT as per template.
```

## M5-2 — Agent: renewal watch (first autonomous job)

```text
## Task: agent cron — daily renewal watch

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md, instructions/02-agent-service.md
   (§Autonomous runs — binding), ../AGENT.md §7.

2. SCOPE — in apps/agent:
   - wrangler.jsonc: cron trigger 23:00 UTC (= 07:00 Asia/Shanghai).
   - scheduled() handler: runs the SAME loop headless with a fixed job prompt:
     scan entitlements_list/arrears_list via core, file one Chinese renewal
     draft per affected guardian (drafts_create), then write ONE summary
     conversation into AGENT_DB (job log: counts, students, draft ids).
   - Guard: job output may only be reads + drafts + pending actions — assert
     this in code by restricting the tool registry passed to the job loop to
     readonly + drafts_create + propose_* (build the restricted set from the
     registry flags, don't hand-list names).
   - Idempotence: skip a guardian if an unsent renewal draft for the same
     student already exists (drafts_list check inside the job prompt AND a
     code-level filter).

3. OUT OF SCOPE: core endpoints, other jobs (M6-3), console UI.
4. APPROVED EXCEPTIONS: none.
5. CONSTRAINTS MOST AT RISK:
   - Restricted tool set built from registry flags (readonly ∪ drafts ∪
     propose_*) — an unattended run must be UNABLE to write anything else.
   - MAX_ITERATIONS still applies; on hitting it the job logs partial state.
   - No duplicate drafts on re-run (idempotence check above).
6. PLAN BEFORE CODE. 7. VERIFY: typecheck · `wrangler dev --test-scheduled`
   + curl the __scheduled endpoint twice → drafts created once, job log rows
   both times, second run reports skips.
8. REPORT as per template.
```

---

## M6-1 — Core: reports + teacher pay

```text
## Task: teacher rates + settlement, income and balance reports

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md, instructions/01-core-api.md,
   ../ARCHITECTURE.md §3.9 (Teacher pay 课时费).

2. SCOPE:
   - Migration: teacher_rate (teacher_id, class_type_id, rate_fen,
     effective_from) — versioned exactly like price; append-only.
   - Registry + reports module (ALL readonly except teacher_rates_set):
     teacher_rates_set (ownerOnly), teacher_rates_list,
     reports_teacher_settlement (teacher × month → attended lessons ×
     applicable rate version; itemized + total), reports_income (payments by
     month/class_type, gross/discount/net), reports_balances (per-student
     remaining credits + subscription end dates), reports_daily (today's
     lessons, yesterday's income, pending drafts/actions counts — the digest
     source).
   - Settlement counts a lesson for the teacher when ANY student attendance
     for it is `present` (group = one teaching unit, not per student) — state
     this rule in the endpoint description.

3. OUT OF SCOPE: SPA pages, agent digest job (M6-3).
4. APPROVED EXCEPTIONS: none.
5. CONSTRAINTS MOST AT RISK:
   - Reports are pure SELECTs over ledger/payments/attendance — never write,
     never store computed totals (derive, don't cache).
   - Rate versioning: settlement uses the rate effective AT the lesson time,
     not today's.
6. PLAN BEFORE CODE. 7. VERIFY: typecheck · fresh migrate · seed a month of
   data via existing endpoints, then curl each report and hand-check one
   teacher's settlement against the raw rows (show the arithmetic in the
   report).
8. REPORT as per template.
```

## M6-2 — Parent web SPA + guardian-scoped core endpoints

```text
## Task: guardian read-only endpoints + apps/web parent portal

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md, instructions/01-core-api.md,
   instructions/05-web-client.md.

2. SCOPE:
   - Core: my_students_list, my_schedule_list, my_balance_get,
     my_feedback_list — each derives the guardian from the SESSION principal
     and returns ONLY data for students linked via guardian_student. No id
     parameters accepted from the client at all. requireRole("guardian").
     medical_notes and other families' data must be unreachable by
     construction.
   - apps/web (same approved stack as apps/admin): guardian login, schedule
     view (upcoming lessons), balance + entitlement expiry, attendance +
     feedback history. Read-only; Simplified Chinese; mobile-first.

3. OUT OF SCOPE: any write endpoint for guardians (leave requests still go
   through the owner's WeChat → chat flow), admin console.
4. APPROVED EXCEPTIONS: creating apps/web with the same dependency set
   approved for apps/admin in M3-4.
5. CONSTRAINTS MOST AT RISK:
   - Scoping lives in the SQL (JOIN through guardian_student on the session
     person) — never trust a client-supplied student id (there are none).
   - A guardian token hitting staff endpoints (people_list etc.) must 403 —
     verify current role guards cover this and report if not.
6. PLAN BEFORE CODE. 7. VERIFY: typecheck · build · curl each my_* endpoint
   with two different guardian accounts → disjoint results; guardian token on
   people_list → 403 · manual walkthrough of the SPA.
8. REPORT as per template.
```

## M6-3 — Agent: daily digest, no-show follow-up, weekly schedule draft

```text
## Task: remaining autonomous jobs

[Same preamble as the template.]

1. READ FIRST: instructions/00-project-brief.md, instructions/02-agent-service.md
   (§Autonomous runs), ../AGENT.md §7. Reuse M5-2's job harness — extend,
   don't duplicate.

2. SCOPE — in apps/agent:
   - Cron schedule: daily digest 07:00 CST (reports_daily → one summary
     conversation the console shows as "今日简报"), no-show follow-up 21:00
     CST (attendance vs lessons cross-check via core lists; anomalies →
     guardian drafts + digest note), weekly schedule draft Friday 17:00 CST
     (propose next week from recurring patterns: emit ONE pending action per
     bulk-apply batch via propose_*, never direct writes).
   - Job registry in code: name → cron → prompt → allowed-tool filter, so
     adding a job is one entry.
3. OUT OF SCOPE: core endpoints, console rendering of the digest (report
   what the console needs and stop).
4. APPROVED EXCEPTIONS: none.
5. CONSTRAINTS MOST AT RISK:
   - Same restricted tool set rule as M5-2 (readonly ∪ drafts ∪ propose_*).
   - Weekly draft: bulk apply is a PENDING ACTION — an unattended run never
     books lessons directly even though lessons_create is agent-callable in
     interactive mode.
   - Cron expressions are UTC in wrangler.jsonc — convert CST times.
6. PLAN BEFORE CODE. 7. VERIFY: typecheck · --test-scheduled each cron ·
   digest conversation exists · weekly run produced pending actions and zero
   lessons · re-run idempotence.
8. REPORT as per template.
```

---

Prompts are written against the briefs as of their milestone; if a contract changed since (check instructions/CHANGELOG.md), the CHANGELOG wins — update the prompt before dispatching, not mid-task.
