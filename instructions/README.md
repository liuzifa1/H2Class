# Implementation briefs

These briefs let a model (or contributor) **without the project's design history** implement components safely. The design docs (../ARCHITECTURE.md, ../TECH_STACK.md, ../AGENT.md) are the *why*; these files are the *how* — distilled, imperative, and current.

## Protocol for every task

1. Read [00-project-brief.md](00-project-brief.md) **fully** — it contains the invariants that are easy to violate without context.
2. Read the brief for the component your task touches (below). If a task spans two components (e.g. a new endpoint + its agent tool), read both.
3. If the task needs an endpoint, schema, table, or decision that doesn't exist and isn't described here: **stop and report — do not invent it.** Guessing wrong on this project corrupts money-equivalent data.
4. Definition of done is in 00 §Verification. A task is not done because it compiles.

| Component | Brief | Code |
|---|---|---|
| Global rules (always read) | [00-project-brief.md](00-project-brief.md) | — |
| Core API (database, business logic, REST) | [01-core-api.md](01-core-api.md) | `apps/api` |
| Agent service (Claude loop) | [02-agent-service.md](02-agent-service.md) | `apps/agent` |
| Shared schemas (endpoint registry) | [03-shared-schemas.md](03-shared-schemas.md) | `packages/shared` |
| Admin console SPA | [04-admin-console.md](04-admin-console.md) | `apps/admin` |
| Parent web SPA | [05-web-client.md](05-web-client.md) | `apps/web` |
| iOS app (teachers) | [06-ios-app.md](06-ios-app.md) | `apps/ios` |

Keep briefs current: if your change alters a contract described here, updating the brief is part of the task.

**Dispatching work:** copy a prompt from [PROMPTS.md](PROMPTS.md) — it has the reusable template plus ready-made prompts for the next milestone's tasks.
