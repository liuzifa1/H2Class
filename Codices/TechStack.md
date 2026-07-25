# H2Class — Tech Stack & Concrete Design

Companion to [ARCHITECTURE.md](ARCHITECTURE.md). That file says *what* the system is; this file says *exactly which tools* and *how the code is organized*.

> **Deployment decision (2026-07): the Workers variant in §5.1 is what's built.** Wherever the §1–§5 baseline (Fastify / Prisma / PostgreSQL / Railway) conflicts with §5.1 (Hono / Drizzle / D1 / Cloudflare Workers), §5.1 and the [instructions/](instructions/) briefs win.

Guiding rule for every choice: mainstream, well-documented, boring. One language (TypeScript) across backend + both web apps, so you learn one ecosystem.

## 1. Stack at a glance

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere (except iOS) | One language for API + web + admin; types catch mistakes early |
| API framework | Fastify | Simple, fast, minimal magic — easier to learn than NestJS |
| Validation | Zod | Every request body/query validated by a schema; schemas shared with web clients |
| ORM / DB access | Prisma | Schema file → migrations → typed queries; best docs for beginners |
| Database | PostgreSQL 16 | See ARCHITECTURE §2.5 |
| Authentication | better-auth (email/password + bearer plugin) | Handles password hashing (argon2), sessions, rate limiting — never write your own crypto |
| Web client + admin | React + Vite + TanStack Query + Tailwind CSS | Static SPA output for Pages; TanStack Query manages API calls/caching |
| UI components | shadcn/ui | Copy-paste components, good tables/forms for the admin console |
| iOS | SwiftUI + URLSession, token in Keychain | Native, no third-party frameworks needed |
| Agent service | Separate worker (`apps/agent`) + OpenAI-compatible Chat Completions over `fetch` | Operates the core via the public API like any client — zero business logic, tools generated from `packages/shared` schemas (AGENT.md) |
| Monorepo | pnpm workspaces | One repo, shared types between API and web apps |
| API hosting | Railway (Node service + Postgres plugin) | Push-to-deploy, managed Postgres with daily backups, ~$10/mo |
| Frontend hosting | Cloudflare Pages (two projects: web, admin) | Free, CDN, deploy on push |
| CI/CD | GitHub + auto-deploy (Railway & Pages watch `main`) | No pipeline config needed to start |

> **Mainland China note:** if parents/teachers are primarily in mainland China, Cloudflare Pages and Railway can be slow or unreliable there. The same stack runs unchanged on an Aliyun/Tencent Cloud VPS (Docker) + their managed PostgreSQL + their CDN for static files — but a custom domain then requires ICP filing (备案). Decide based on where your users are before buying infrastructure.

## 2. Repository layout

```
h2class/
├── apps/
│   ├── api/            # CORE module: database, business logic, REST API (Hono on Workers)
│   ├── agent/          # AGENT module: OpenAI-compatible loop; calls core like a client (AGENT.md)
│   ├── web/            # parent-facing SPA (React + Vite)
│   ├── admin/          # staff console SPA (React + Vite)
│   └── ios/            # Xcode project (SwiftUI)
├── packages/
│   └── shared/         # Zod schemas + TS types shared by api/agent/web/admin
├── ARCHITECTURE.md
└── TECH_STACK.md
```

`packages/shared` is the trick that keeps clients honest: the API validates requests with the same Zod schemas the web apps use to type their calls. iOS can't consume TS types — keep its models in Swift by hand for v1 (generate from OpenAPI later if it gets tedious).

## 3. Root server modules

```
apps/api/src/
├── server.ts               # boot: register plugins, mount routes
├── lib/
│   ├── db.ts               # Prisma client (one instance)
│   ├── auth.ts             # better-auth setup + requireRole() guard
│   ├── audit.ts            # activity-log hook (runs after every write)
│   └── errors.ts           # typed error responses
└── modules/                # one folder per domain module
    ├── people/             # persons, roles, guardian↔student links
    ├── catalog/            # class types (1v1/1v2/group), versioned prices
    ├── scheduling/         # lessons, enrollments, conflict checks
    ├── attendance/         # check-in/out, statuses, deduction policy
    ├── entitlements/       # packages, subscriptions, credit ledger
    ├── payments/           # payments, refunds → income truth
    ├── reports/            # balances, income, expiring subs, teacher settlement
    ├── crm/                # leads, trials, follow-ups (v1.5 — ARCHITECTURE §3.9)
    └── audit/              # query endpoint for the activity log
```

K12 additions (ARCHITECTURE §3.9) live inside existing modules: lesson feedback → `attendance`, teacher rates + settlement → `reports`, terms & holiday calendar → `scheduling`, pickup/safety + academic profile → `people`.

Every module has the same three files — this pattern is the whole backend architecture:

```
modules/scheduling/
├── routes.ts     # HTTP endpoints: parse + validate (Zod) + call service
├── service.ts    # business logic: conflict checks, transactions
└── schemas.ts    # Zod schemas for this module's requests/responses
```

**Request lifecycle** (identical for every endpoint):

```
HTTP request
  → auth middleware   (bearer token → load session + person + roles)
  → route             (Zod validates body/params; requireRole() checks permission)
  → service function  (business logic; DB writes inside ONE Prisma transaction)
  → audit hook        (append actor/action/entity to activity log)
  → JSON response
```

Rules that keep it maintainable:

- Routes never touch the database directly — only services do.
- Anything that writes 2+ rows (group check-in!) is one `prisma.$transaction`.
- Services throw typed errors; one global handler turns them into JSON.

## 4. Authentication — concrete design

better-auth mounted on Fastify does the heavy lifting. What you configure:

- **Method:** email (or phone) + password. Passwords hashed with argon2 by the library — you never store or compare raw passwords.
- **Sessions:** login returns an opaque bearer token (better-auth bearer plugin). Server stores the session in Postgres; every request sends `Authorization: Bearer <token>`.
- **Token storage:** iOS → Keychain. Web/admin → localStorage (simple; acceptable at this scale — revisit if you ever embed third-party scripts).
- **Session length:** 30 days rolling; logout = delete the session row (instantly revocable, unlike JWTs).
- **Account creation:** no public self-signup. The owner provisions guardian accounts from the admin console and gives the credentials to the guardian; students normally have no login.
- **Roles:** stored on the person record (`admin`, `staff`, `teacher`, `guardian`). One guard function used in every route:

```ts
app.post("/lessons", { preHandler: requireRole("staff") }, createLesson);
```

Permission model v1 — keep it to exactly this, resist anything finer-grained:

| Role | Can |
|---|---|
| admin | everything, incl. prices, refunds, ledger adjustments, user management |
| staff | scheduling, check-in/out, payments, people; not prices/refunds/adjustments |
| teacher | see own schedule; check-in/out own lessons |
| guardian | read-only: own kids' schedule, balance, attendance history |

## 5. Infrastructure — concrete setup

```
GitHub repo (main branch)
  ├─ push → Railway  ─ builds apps/api ───→ api.yourdomain.com   (core)
  ├─ push → Railway  ─ builds apps/agent ─→ agent.yourdomain.com (chat endpoint for admin console)
  │           └─ PostgreSQL plugin (daily backups ON; agent uses its own schema for conversations)
  ├─ push → CF Pages ─ builds apps/web ──→ app.yourdomain.com
  └─ push → CF Pages ─ builds apps/admin ─→ admin.yourdomain.com
```

- **Railway project:** two services (`api` and `agent`, Node 22) + one PostgreSQL database. Enable daily backups in the Postgres settings. Secrets live in Railway env vars — never in the repo: core gets `DATABASE_URL`, `BETTER_AUTH_SECRET`; the agent gets `OPENAI_API_KEY`, its core service token (`CORE_API_TOKEN`), and its own DB URL/schema.
- **Cloudflare Pages:** two projects pointing at the same repo, build commands `pnpm --filter web build` / `pnpm --filter admin build`. Set `VITE_API_URL=https://api.yourdomain.com`.
- **DNS:** domain on Cloudflare; `api` CNAME → Railway, `app`/`admin` → Pages.
- **CORS:** API allows origins `app.yourdomain.com` and `admin.yourdomain.com` only.
- **Environments:** local + production. Local dev runs Postgres via `docker-compose up` and the API via `pnpm dev`. Add staging only when it hurts.
- **Migrations:** `prisma migrate dev` locally; `prisma migrate deploy` runs automatically on Railway deploy (release command).
- **Cost:** ≈ $10–15/month (Railway) + domain. Pages is free.

### 5.1 Deployment variant: all-on-Cloudflare-Workers

For small-scale (few users per instance), the entire backend can run on Workers instead of Railway — same architecture, three substitutions:

| Baseline (§1) | Workers variant | Notes |
|---|---|---|
| Fastify | **Hono** | Runs on Workers *and* Node — keeps portability |
| Prisma | **Drizzle** | First-class D1 support, edge-native |
| PostgreSQL (Railway) | **D1** (SQLite) | Time Travel point-in-time restore; plus a scheduled export to R2 as belt-and-braces backup |

- Two Workers (`core`, `agent`) preserve the service-token boundary and independent kill switch; Cron Triggers run the autonomous agent jobs; the agent uses the Workers-native `fetch` API for its OpenAI-compatible vendor; better-auth works on Workers/D1. Paid plan ($5/mo) recommended — password hashing needs more than free-tier CPU.
- **Known trade-off:** D1 has atomic *batches* but no interactive transactions. Compound writes (reschedule + drafts) batch fine; read-then-write conflict checks have a theoretical race window — irrelevant at single-admin concurrency, and true invariants (no double-booking) are backed by unique constraints.
- Middle path if real Postgres transactions are wanted: Workers compute + serverless Postgres (Neon/Supabase free tier) via Hyperdrive; Prisma can stay.
- Decision rule: few users per instance → Workers variant (cheaper, zero ops). If it ever outgrows D1, the Hono codebase moves to Node + Postgres with modest effort (swap driver + auth adapter; the API surface and agent are untouched).

## 6. Build order

Each milestone is usable on its own — deploy from milestone 1 onward.

1. **Skeleton** — monorepo, Fastify hello-world, Prisma + local Postgres, deploy pipeline working end to end (a `/health` endpoint live on `api.yourdomain.com`).
2. **Auth + people** — better-auth wired, roles, admin can create people. Admin SPA: login + people list.
3. **Catalog + scheduling** — class types, versioned prices, create lessons, conflict checks. Admin: calendar/table of lessons.
4. **Attendance + ledger** — check-in/out, deduction policy, append-only ledger, balance query. iOS app starts here (login + today's lessons + check-in) — this is the core loop.
5. **Entitlements + payments** — sell packages/subscriptions, record payments, renewal-expiry queries.
6. **Reports + web client** — income/balance reports in admin; parent-facing SPA (schedule + balance).

Activity-log middleware is written in milestone 1 and applies to everything after — see ARCHITECTURE §3.8.

The **agent service** (AGENT.md) ships at milestone 2 and grows automatically with every later milestone: each endpoint's Zod schema in `packages/shared` doubles as its agent-tool schema, so every new endpoint is agent-operable the day it lands. The message-drafts queue arrives with milestone 3; the `agent` role, `POST /pending-actions`, and the confirmation cards with milestone 4.
