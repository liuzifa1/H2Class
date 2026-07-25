import type { MiddlewareHandler } from "hono";
import type { Role } from "./types";
import type { AppEnv } from "../env";

export const requireRole = (...allowedRoles: Role[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const principal = c.var.principal;
    if (principal === undefined) {
      return c.json({ error: "unauthorized" }, 401);
    }

    if (!principal.roles.some((role) => allowedRoles.includes(role))) {
      return c.json({ error: "forbidden" }, 403);
    }

    await next();
  };
