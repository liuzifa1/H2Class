import { Hono } from "hono";
import { cors } from "hono/cors";
import type { HealthResponse } from "@h2class/shared";

// AGENT.md: this worker holds zero business logic. It talks to the core API
// like any client (service-account token) and keeps only its own state.
type AgentEnv = {
  Bindings: {
    CORE_API_URL: string;
    ANTHROPIC_API_KEY?: string; // secret
    CORE_API_TOKEN?: string; // secret
  };
};

const app = new Hono<AgentEnv>();

app.use("*", cors());

app.get("/health", async (c) => {
  let coreReachable = false;
  try {
    const res = await fetch(new URL("/health", c.env.CORE_API_URL));
    coreReachable = res.ok;
  } catch {
    // core down or CORE_API_URL unset — reported below
  }
  const body: HealthResponse & {
    anthropicKeyConfigured: boolean;
    coreReachable: boolean;
  } = {
    status: "ok",
    service: "agent",
    time: new Date().toISOString(),
    anthropicKeyConfigured: Boolean(c.env.ANTHROPIC_API_KEY),
    coreReachable,
  };
  return c.json(body);
});

// The agent loop (AGENT.md §8: Claude ↔ tools generated from shared schemas)
// lands in milestone 2 alongside auth + the people module.
app.post("/chat", (c) =>
  c.json({ error: "not_implemented", note: "agent loop arrives in milestone 2" }, 501),
);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export default app;
