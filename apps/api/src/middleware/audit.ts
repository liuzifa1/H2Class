import type { MiddlewareHandler } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { activityLog } from "../db/schema";
import type { AppEnv } from "../env";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Logs every successful mutating request. Runs after the handler and off the
// response path (waitUntil), so auditing never adds latency or breaks a request.
export const audit: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (!MUTATING.has(c.req.method) || c.res.status >= 400) return;

  const actor = c.var.principal?.id;
  if (actor === undefined) {
    throw new Error("Successful mutation is missing its audit principal");
  }
  const action = `${c.req.method} ${new URL(c.req.url).pathname}`;
  const details = c.var.audit;

  c.executionCtx.waitUntil(
    (async () => {
      try {
        await drizzle(c.env.DB).insert(activityLog).values({
          actor,
          action,
          entity: details?.entity,
          entityId: details?.entityId,
          summary: details?.summary,
        });
      } catch (err) {
        console.error("audit insert failed", err);
      }
    })(),
  );
};
