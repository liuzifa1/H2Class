import { Hono } from "hono";
import { cors } from "hono/cors";
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { HealthResponse } from "@h2class/shared";
import { activityLog } from "./db/schema";
import type { AppEnv } from "./env";
import { audit } from "./middleware/audit";

const app = new Hono<AppEnv>();

app.use("*", cors());
app.use("*", audit);

app.get("/health", async (c) => {
  const db = drizzle(c.env.DB);
  const [row] = await db.select({ n: count() }).from(activityLog);
  const body: HealthResponse = {
    status: "ok",
    service: "core",
    time: new Date().toISOString(),
    db: { reachable: true, activityLogRows: row?.n ?? 0 },
  };
  return c.json(body);
});

// Temporary: proves the audit middleware writes. Removed when real modules land.
app.post("/dev/ping", (c) => c.json({ pong: true }));

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export default app;
