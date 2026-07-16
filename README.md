# H2Class

Class arrangement & logging system for a small K12 tutoring / trusteeship business, operated primarily through an AI agent. Runs entirely on Cloudflare Workers.

**Design docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [TECH_STACK.md](TECH_STACK.md) (§5.1 = Workers variant) · [AGENT.md](AGENT.md)
**Implementation briefs** (for models/contributors without design context): [instructions/](instructions/)

## Layout

```
apps/api      CORE module — database (D1), business logic, REST API (Hono + Drizzle)
apps/agent    AGENT module — Claude loop; calls the core API like a client
packages/shared  Zod schemas shared by core, clients, and agent tools
apps/web, apps/admin — arrive in milestones 3–6
```

## Local development

```sh
pnpm install
pnpm db:migrate:local      # apply D1 migrations to the local database
pnpm dev:api               # core on http://localhost:8787
pnpm dev:agent             # agent on http://localhost:8788 (separate terminal)
```

Smoke test:

```sh
curl http://localhost:8787/health     # core + D1 row count
curl http://localhost:8788/health     # agent + core reachability
curl -X POST http://localhost:8787/dev/ping   # writes an activity_log row (audit middleware)
```

For local agent secrets: `cp apps/agent/.dev.vars.example apps/agent/.dev.vars` and fill in.

## First deploy (one-time, needs your Cloudflare account)

```sh
pnpm exec wrangler login                      # opens browser

# 1. Create the production database and wire it up
cd apps/api
pnpm exec wrangler d1 create h2class          # prints a database_id
#   → paste that id into apps/api/wrangler.jsonc (database_id)
pnpm db:migrate:remote

# 2. Deploy both workers
pnpm deploy                                   # from apps/api
cd ../agent
pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm exec wrangler secret put CORE_API_TOKEN  # placeholder until milestone 2
pnpm deploy
```

Then in the Cloudflare dashboard: attach custom domains (`api.<domain>` → h2class-api, `agent.<domain>` → h2class-agent), set the agent's `CORE_API_URL` var to `https://api.<domain>`, and enable **D1 Time Travel / scheduled export** for backups — this database is the business.

Workers **paid plan ($5/mo)** is expected: password hashing (milestone 2) needs more CPU than the free tier allows.

## Milestones (TECH_STACK.md §6)

1. ✅ Skeleton: monorepo, both workers, D1 + migrations, audit middleware, health checks
2. Auth (better-auth) + people module + **agent service v1** (chat + people tools)
3. Catalog + scheduling + drafts queue + admin SPA
4. Attendance + credit ledger + pending-actions (confirm gates)
5. Entitlements + payments + renewal watch
6. Reports + parent web SPA + autonomous cron runs
