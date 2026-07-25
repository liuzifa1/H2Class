import {
  pickupPersonsListInputSchema,
  pickupPersonsSetInputSchema,
} from "@h2class/shared";
import { Hono, type Context } from "hono";
import { requireRole } from "../../auth/require-role";
import type { Principal } from "../../auth/types";
import type { AppEnv } from "../../env";
import {
  isPickupServiceError,
  listPickupPersons,
  setPickupPersons,
} from "./service";

const invalidRequest = (c: Context<AppEnv>) =>
  c.json({ error: "invalid_request" }, 400);

const principal = (c: Context<AppEnv>): Principal => {
  if (c.var.principal === undefined) {
    throw new Error("Authenticated pickup route is missing its principal");
  }
  return c.var.principal;
};

const jsonBody = async (c: Context<AppEnv>): Promise<unknown> =>
  c.req.json().catch(() => undefined);

const inputObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const handleServiceError = (c: Context<AppEnv>, error: unknown): Response => {
  if (isPickupServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
};

export const pickupRoutes = new Hono<AppEnv>();

pickupRoutes.put(
  "/students/:studentId/pickup-persons",
  requireRole("admin", "staff", "agent"),
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = pickupPersonsSetInputSchema.safeParse({
      ...body,
      studentId: c.req.param("studentId"),
    });
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await setPickupPersons(c.env.DB, principal(c), parsed.data);
      c.set("audit", {
        entity: "person",
        entityId: parsed.data.studentId,
        summary: `Replaced authorized pickup list for student ${parsed.data.studentId} with ${result.pickupPersons.length} person(s)`,
      });
      return c.json(result);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

pickupRoutes.get(
  "/students/:studentId/pickup-persons",
  requireRole("admin", "staff", "teacher", "agent"),
  async (c) => {
    const parsed = pickupPersonsListInputSchema.safeParse({
      studentId: c.req.param("studentId"),
    });
    if (!parsed.success) return invalidRequest(c);
    try {
      return c.json(await listPickupPersons(c.env.DB, principal(c), parsed.data));
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);
