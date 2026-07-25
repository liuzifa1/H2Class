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
- Registry control-plane entries may set `toolExposure: "hidden"`; they remain
  available to typed clients but are intentionally omitted from model tools.
- The sole direct-write capability approved for unattended jobs is declared
  with `autonomousWrite: true` on its registry entry. Autonomous allowlists
  derive this flag alongside readonly and owner-only proposal metadata; never
  identify autonomous writes by endpoint name in the agent worker.
- **SPAs** type their fetch calls from the same definitions.

Adding an endpoint = adding schemas + one registry entry + the core route/service. If you implement a route without a registry entry, the agent can't see it — that's a defect (00-§9).

## Schema rules

- Zod **v4** (`import { z } from "zod"`). Objects that describe tool/endpoint inputs use `.strict()` (maps to `additionalProperties: false`, required for `strict: true` tools).
- Keep schemas JSON-Schema-convertible: no `.transform()`, no `z.date()` (use ISO strings or epoch-ms numbers), no functions/refinements that can't serialize. Enums via `z.enum([...])`.
- Naming: `<domain><Action>Input` / `...Output`; entity schemas `<entity>Schema`. IDs are `z.string()` (UUID), money is **integer fen** `z.number().int()` (never floats) and money field names end in `_fen`; instants are ISO-8601 strings and Asia/Shanghai calendar dates are `YYYY-MM-DD` strings.
- Every field gets `.describe("…")` where the name alone is ambiguous — descriptions flow into the agent's tool schemas and materially improve its accuracy.
- Breaking a schema = breaking clients AND agent tools; prefer additive changes (optional fields), and update all consumers in the same task.
- `lessons_create` is one strict object for tool compatibility. `mode="single"` requires `date`; `mode="recurring"` requires `termId` and `weekday`. Both use Asia/Shanghai-local `startMin`; core converts the resulting lesson instants to UTC.
- Attendance status is `present|absent|excused_leave|late_cancel`; `excused_leave` is the binding wire value. Credit balances are integer sums of append-only ledger deltas.
- Normal `attendance_checkout` and owner-only `attendance_checkout_override` are separate registry contracts with the same strict pickup payload; normal checkout has no override flag.
- `people_list` uses the non-sensitive person schema. `people_get` uses a detail schema whose optional `medicalNotes` field is emitted only for staff/admin callers.
- `entitlements_purchase` is a strict discriminated package/subscription input. Clients supply the exact `priceId` plus product facts, discount, method, and receipt number; they never supply list or paid amounts.
- `payments_refund_quote` is readonly and returns the optimistic `remainingCredits` and integer-fen refund components. `payments_refund` repeats `expectedRemainingCredits` and `expected_refund_amount_fen`; a changed ledger makes execution fail with 409 instead of silently using a stale quote.
