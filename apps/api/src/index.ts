import { Hono } from "hono";
import { cors } from "hono/cors";
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { healthInputSchema, type HealthResponse } from "@h2class/shared";
import { handleAuth } from "./auth/handler";
import { activityLog } from "./db/schema";
import type { AppEnv } from "./env";
import { audit } from "./middleware/audit";
import { authenticate } from "./middleware/auth";
import { attendanceRoutes } from "./modules/attendance/routes";
import { billingRoutes } from "./modules/billing/routes";
import { catalogRoutes } from "./modules/catalog/routes";
import { draftsRoutes } from "./modules/drafts/routes";
import { feedbackRoutes } from "./modules/feedback/routes";
import { guardianRoutes } from "./modules/guardian/routes";
import { meRoutes } from "./modules/me/routes";
import { peopleRoutes } from "./modules/people/routes";
import { pendingActionRoutes } from "./modules/pending-actions/routes";
import { pickupRoutes } from "./modules/pickup/routes";
import { schedulingRoutes } from "./modules/scheduling/routes";
import { reportsRoutes } from "./modules/reports/routes";
import { clientOrigins } from "./http/admin-origins";

const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: (origin, c) =>
      clientOrigins(c.env, c.req.url).includes(origin) ? origin : null,
    allowHeaders: ["Authorization", "Content-Type"],
    exposeHeaders: ["set-auth-token"],
  }),
);
app.use("*", authenticate);
app.use("*", audit);

app.on(["GET", "POST"], "/auth/*", handleAuth);

app.get("/health", async (c) => {
  healthInputSchema.parse({});
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

app.route("/me", meRoutes);
app.route("/", attendanceRoutes);
app.route("/", billingRoutes);
app.route("/", catalogRoutes);
app.route("/", draftsRoutes);
app.route("/", feedbackRoutes);
app.route("/", guardianRoutes);
app.route("/", peopleRoutes);
app.route("/", pendingActionRoutes);
app.route("/", pickupRoutes);
app.route("/", reportsRoutes);
app.route("/", schedulingRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export default app;
