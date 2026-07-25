import { meInputSchema, type MeResponse } from "@h2class/shared";
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { getMe } from "./service";

export const meRoutes = new Hono<AppEnv>().get("/", (c) => {
  meInputSchema.parse({});
  const body: MeResponse = getMe(c.var.principal);
  return c.json(body);
});
