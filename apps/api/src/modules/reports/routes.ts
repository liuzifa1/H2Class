import {
  reportsBalancesInputSchema,
  reportsDailyInputSchema,
  reportsIncomeInputSchema,
  reportsTeacherSettlementInputSchema,
  teacherRatesListInputSchema,
  teacherRatesSetInputSchema,
} from "@h2class/shared";
import { Hono, type Context } from "hono";
import { requireRole } from "../../auth/require-role";
import type { Principal } from "../../auth/types";
import type { AppEnv } from "../../env";
import {
  getBalancesReport,
  getDailyReport,
  getIncomeReport,
  getTeacherSettlement,
  isReportsServiceError,
  listTeacherRates,
  setTeacherRate,
} from "./service";

const invalidRequest = (c: Context<AppEnv>) =>
  c.json({ error: "invalid_request" }, 400);

const principal = (c: Context<AppEnv>): Principal => {
  if (c.var.principal === undefined) {
    throw new Error("Authenticated reports route is missing its principal");
  }
  return c.var.principal;
};

const jsonBody = async (c: Context<AppEnv>): Promise<unknown> =>
  c.req.json().catch(() => undefined);

const queryObject = (c: Context<AppEnv>) =>
  Object.fromEntries(new URL(c.req.url).searchParams);

const handleServiceError = (c: Context<AppEnv>, error: unknown): Response => {
  if (isReportsServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
};

const canReadReports = requireRole("admin", "staff", "agent");

export const reportsRoutes = new Hono<AppEnv>();

reportsRoutes.post("/teacher-rates", requireRole("admin"), async (c) => {
  const parsed = teacherRatesSetInputSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    const result = await setTeacherRate(c.env.DB, principal(c), parsed.data);
    c.set("audit", {
      entity: "teacher_rate",
      entityId: `${result.teacherId}:${result.classTypeId}:${result.effectiveFrom}`,
      summary: `Set ${result.rate_fen} fen teacher rate for ${result.teacherId}/${result.classTypeId} effective ${result.effectiveFrom}`,
    });
    return c.json(result, 201);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

reportsRoutes.get("/teacher-rates", canReadReports, async (c) => {
  const parsed = teacherRatesListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await listTeacherRates(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

reportsRoutes.get("/reports/teacher-settlement", canReadReports, async (c) => {
  const parsed = reportsTeacherSettlementInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await getTeacherSettlement(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

reportsRoutes.get("/reports/income", canReadReports, async (c) => {
  const parsed = reportsIncomeInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await getIncomeReport(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

reportsRoutes.get("/reports/balances", canReadReports, async (c) => {
  const parsed = reportsBalancesInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await getBalancesReport(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

reportsRoutes.get("/reports/daily", canReadReports, async (c) => {
  const parsed = reportsDailyInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await getDailyReport(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});
