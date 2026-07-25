# H2Class

Class arrangement & logging system for a small K12 tutoring / trusteeship business, operated primarily through an AI agent. Runs entirely on Cloudflare Workers.

**Design docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [TECH_STACK.md](TECH_STACK.md) (§5.1 = Workers variant) · [AGENT.md](AGENT.md)
**Implementation briefs** (for models/contributors without design context): [instructions/](instructions/)

## Layout

```
apps/api         CORE module — database (D1), business logic, REST API (Hono + Drizzle)
apps/agent       AGENT module — OpenAI-compatible loop and autonomous jobs
apps/admin       owner/staff SPA — chat, confirmations, drafts, and people fallback
apps/web         guardian SPA — scoped schedule, balances, attendance, and feedback
packages/shared  Zod schemas and endpoint registry shared by every client
```

## Local development

```sh
pnpm install
pnpm db:migrate:local       # apply core D1 migrations
pnpm db:migrate:agent:local # apply agent D1 migrations
pnpm dev:api               # core on http://localhost:8787
pnpm dev:agent             # agent on http://localhost:8788 (separate terminal)
pnpm dev:admin             # owner console on http://localhost:5173
pnpm dev:web               # guardian portal on http://localhost:5174
```

Smoke test:

```sh
curl http://localhost:8787/health     # core + D1 row count
curl http://localhost:8788/health     # agent + core reachability
curl http://localhost:8787/me                 # 401 without a bearer token
```

Copy `apps/api/.dev.vars.example` and `apps/agent/.dev.vars.example` to
`.dev.vars` in their respective app directories, then fill in the local-only
secrets and the selected OpenAI-compatible vendor settings. The core trusts
both local Vite origins automatically; production SPA origins belong in its
comma-separated `CLIENT_ORIGINS` variable.

## Deployment

Production uses four Workers: two code Workers (`api`, `agent`) and two
Workers Static Assets deployments (`admin`, `web`). The backend Workers bind
to separate D1 databases.

Follow [CLOUDFLARE_HANDOFF.md](CLOUDFLARE_HANDOFF.md) for the exact split
between Cloudflare account actions and repository configuration. The first
operator step is:

```sh
pnpm --filter @h2class/api exec wrangler login
pnpm --filter @h2class/api exec wrangler d1 create h2class
pnpm --filter @h2class/agent exec wrangler d1 create h2class-agent
```

Workers **paid plan ($5/mo)** is expected: password hashing (milestone 2) needs more CPU than the free tier allows.

## Milestones (TECH_STACK.md §6)

1. ✅ Skeleton: monorepo, both workers, D1 + migrations, audit middleware, health checks
2. ✅ Auth (better-auth) + people module + **agent service v1**
3. ✅ Catalog + scheduling + drafts queue + admin SPA
4. ✅ Attendance + credit ledger + pending-action confirmation gates
5. ✅ Entitlements + payments + renewal watch
6. ✅ Reports + guardian SPA + autonomous cron runs
