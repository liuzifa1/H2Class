# 03 — Shared schemas (`packages/shared`)

Single source of truth for every API contract. Both workers and both SPAs import this package **as TypeScript source** (no build step) — keep it dependency-free except `zod` (v4).

## Endpoint registry (the load-bearing part)

Every core endpoint has exactly one entry:

```ts
// src/registry.ts (shape — extend, don't reinvent)
import { z } from "zod";

export const endpoints = {
  people_create: {
    method: "POST",
    path: "/people",
    description: "Create a person. Call when a new student, guardian, or teacher is mentioned that does not exist yet.",
    input: personCreateInput,      // z.object(...).strict()
    output: personSchema,
    readonly: false,
    ownerOnly: false,
  },
  // ...
} as const satisfies Record<string, EndpointDef>;
```

Consumers:
- **Core** (`apps/api`) validates requests with `input` and types responses with `output`.
- **Agent** (`apps/agent`) generates one tool per entry (brief 02): `description` becomes the tool description — write it prescriptively ("Call when…"), `ownerOnly: true` turns it into a propose-only tool.
- **SPAs** type their fetch calls from the same definitions.

Adding an endpoint = adding schemas + one registry entry + the core route/service. If you implement a route without a registry entry, the agent can't see it — that's a defect (00-§9).

## Schema rules

- Zod **v4** (`import { z } from "zod"`). Objects that describe tool/endpoint inputs use `.strict()` (maps to `additionalProperties: false`, required for `strict: true` tools).
- Keep schemas JSON-Schema-convertible: no `.transform()`, no `z.date()` (use ISO strings or epoch-ms numbers), no functions/refinements that can't serialize. Enums via `z.enum([...])`.
- Naming: `<domain><Action>Input` / `...Output`; entity schemas `<entity>Schema`. IDs are `z.string()` (UUID), money is **integer cents** `z.number().int()` (never floats), dates-in-APIs are ISO-8601 strings.
- Every field gets `.describe("…")` where the name alone is ambiguous — descriptions flow into the agent's tool schemas and materially improve its accuracy.
- Breaking a schema = breaking clients AND agent tools; prefer additive changes (optional fields), and update all consumers in the same task.
