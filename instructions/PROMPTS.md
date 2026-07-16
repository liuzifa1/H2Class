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
   instructions/02-agent-service.md (follow its Claude API facts EXACTLY —
   your training data about the Anthropic API may be outdated),
   instructions/03-shared-schemas.md. Also ../AGENT.md §5 and §8.

2. SCOPE — in apps/agent:
   - src/api.ts: typed fetch client for the core API using CORE_API_TOKEN;
     base URL from CORE_API_URL.
   - src/tools.ts: generate the tool array from packages/shared's endpoint
     registry per brief 02 (ownerOnly entries become propose_<name> tools
     that call POST /pending-actions — if core does not yet expose
     /pending-actions, propose_* tools return an is_error tool_result saying
     the capability is pending; do NOT invent the endpoint).
   - src/loop.ts: the manual loop per brief 02 (streaming, ALL tool results
     in one user message, MAX_ITERATIONS=24, pause_turn handling).
   - src/index.ts: POST /chat — validate the caller by forwarding their
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
   - model "claude-opus-4-8"; thinking {type:"adaptive"}; NEVER send
     temperature/top_p/top_k/budget_tokens (they 400); no assistant prefill.
   - Zero business logic in this worker (00-§8) — every fact comes from a
     core endpoint response.
   - cache_control on the last system block; tool array in stable sorted
     order.

6. PLAN BEFORE CODE. 7. VERIFY: typecheck · agent + core running locally ·
   curl an SSE chat that triggers people_list and returns real data · a chat
   asking for a role grant must yield a proposal/pending message, never a
   direct grant · /chat without a valid admin token → 401/403.
8. REPORT as per template.
```

---

Milestones 3+ get their prompts written the same way when you reach them: template + the relevant briefs + an explicit deliverables list from TECH_STACK.md §6.
