import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { MiddlewareHandler } from "hono";
import { createAuth } from "../auth/config";
import type { Auth } from "../auth/config";
import type { Principal } from "../auth/types";
import { person, personRole } from "../db/schema";
import type { AppEnv } from "../env";

const isPublicPath = (pathname: string) =>
  pathname === "/health" ||
  pathname === "/auth" ||
  pathname.startsWith("/auth/");

export const resolveHumanPrincipal = async (
  auth: Auth,
  d1: D1Database,
  headers: Headers,
): Promise<Principal | null> => {
  const authSession = await auth.api.getSession({ headers });
  if (authSession === null) return null;

  const rows = await drizzle(d1)
    .select({ role: personRole.role })
    .from(personRole)
    .innerJoin(person, eq(person.id, personRole.personId))
    .where(eq(person.authUserId, authSession.user.id));

  return {
    id: authSession.user.id,
    roles: rows.map(({ role }) => role),
  };
};

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  if (pathname === "/health") {
    await next();
    return;
  }

  const authorization = c.req.header("authorization");
  const serviceToken = c.env.AGENT_SERVICE_TOKEN;

  if (
    !isPublicPath(pathname) &&
    typeof serviceToken === "string" &&
    serviceToken.length > 0 &&
    authorization === `Bearer ${serviceToken}`
  ) {
    c.set("principal", { id: "agent", roles: ["agent"] });
    await next();
    return;
  }

  const auth = createAuth(c.env, new URL(c.req.url).origin);
  const principal = await resolveHumanPrincipal(auth, c.env.DB, c.req.raw.headers);
  if (principal !== null) c.set("principal", principal);

  if (isPublicPath(pathname)) {
    await next();
    return;
  }

  if (principal === null) {
    return c.json({ error: "unauthorized" }, 401);
  }

  await next();
};
