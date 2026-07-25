import {
  guardianAccountsCreateInputSchema,
  myBalanceGetInputSchema,
  myFeedbackListInputSchema,
  myScheduleListInputSchema,
  myStudentsListInputSchema,
} from "@h2class/shared";
import { Hono, type Context } from "hono";
import { requireRole } from "../../auth/require-role";
import type { Principal } from "../../auth/types";
import type { AppEnv } from "../../env";
import {
  createGuardianAccount,
  getMyBalance,
  isGuardianServiceError,
  listMyFeedback,
  listMySchedule,
  listMyStudents,
} from "./service";

const invalidRequest = (c: Context<AppEnv>) =>
  c.json({ error: "invalid_request" }, 400);

const principal = (c: Context<AppEnv>): Principal => {
  if (c.var.principal === undefined) {
    throw new Error("Authenticated guardian route is missing its principal");
  }
  return c.var.principal;
};

const queryObject = (c: Context<AppEnv>) =>
  Object.fromEntries(new URL(c.req.url).searchParams);

const jsonBody = async (c: Context<AppEnv>): Promise<unknown> =>
  c.req.json().catch(() => undefined);

const handleServiceError = (c: Context<AppEnv>, error: unknown): Response => {
  if (isGuardianServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
};

const guardianOnly = requireRole("guardian");

export const guardianRoutes = new Hono<AppEnv>();

guardianRoutes.get("/my/students", guardianOnly, async (c) => {
  const parsed = myStudentsListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await listMyStudents(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

guardianRoutes.get("/my/schedule", guardianOnly, async (c) => {
  const parsed = myScheduleListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await listMySchedule(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

guardianRoutes.get("/my/balance", guardianOnly, async (c) => {
  const parsed = myBalanceGetInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await getMyBalance(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

guardianRoutes.get("/my/feedback", guardianOnly, async (c) => {
  const parsed = myFeedbackListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await listMyFeedback(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

guardianRoutes.post(
  "/guardian-accounts",
  requireRole("admin"),
  async (c) => {
    const parsed = guardianAccountsCreateInputSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await createGuardianAccount(
        c.env.DB,
        principal(c),
        parsed.data,
      );
      c.set("audit", {
        entity: "person",
        entityId: result.personId,
        summary: `Provisioned guardian login for person ${result.personId}`,
      });
      return c.json(result, 201);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);
