import {
  attendanceCheckinInputSchema,
  attendanceCheckoutInputSchema,
  attendanceCheckoutOverrideInputSchema,
  attendanceListInputSchema,
  balancesGetInputSchema,
  deductionPolicyGetInputSchema,
  deductionPolicySetInputSchema,
  leaveRequestInputSchema,
  ledgerAdjustmentCreateInputSchema,
  ledgerListInputSchema,
} from "@h2class/shared";
import { Hono, type Context } from "hono";
import { requireRole } from "../../auth/require-role";
import type { Principal } from "../../auth/types";
import type { AppEnv } from "../../env";
import {
  checkInAttendance,
  checkOutAttendance,
  checkOutAttendanceOverride,
  createLedgerAdjustment,
  getBalances,
  getDeductionPolicy,
  isAttendanceServiceError,
  listAttendance,
  listLedger,
  requestLeave,
  setDeductionPolicy,
} from "./service";

const invalidRequest = (c: Context<AppEnv>) =>
  c.json({ error: "invalid_request" }, 400);

const principal = (c: Context<AppEnv>): Principal => {
  if (c.var.principal === undefined) {
    throw new Error("Authenticated attendance route is missing its principal");
  }
  return c.var.principal;
};

const jsonBody = async (c: Context<AppEnv>): Promise<unknown> =>
  c.req.json().catch(() => undefined);

const inputObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const queryObject = (c: Context<AppEnv>) =>
  Object.fromEntries(new URL(c.req.url).searchParams);

const handleServiceError = (c: Context<AppEnv>, error: unknown): Response => {
  if (isAttendanceServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
};

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
const canRecordAttendance = requireRole("admin", "staff", "teacher", "agent");
const canReadAttendance = requireRole("admin", "staff", "teacher", "agent");
const canReadLedger = requireRole("admin", "staff", "agent");

export const attendanceRoutes = new Hono<AppEnv>();

attendanceRoutes.post(
  "/lessons/:lessonId/attendance",
  canRecordAttendance,
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = attendanceCheckinInputSchema.safeParse({
      ...body,
      lessonId: c.req.param("lessonId"),
    });
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await checkInAttendance(c.env.DB, principal(c), parsed.data);
      c.set("audit", {
        entity: "attendance",
        entityId: parsed.data.lessonId,
        summary: oneLine(
          `Checked in ${result.attendance.length} student(s) for lesson ${parsed.data.lessonId}; appended ${result.ledgerEntries.length} ledger entry/entries and ${result.drafts.length} draft(s)`,
        ),
      });
      return c.json(result, 201);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

attendanceRoutes.post(
  "/lessons/:lessonId/attendance/check-out",
  canRecordAttendance,
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = attendanceCheckoutInputSchema.safeParse({
      ...body,
      lessonId: c.req.param("lessonId"),
    });
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await checkOutAttendance(c.env.DB, principal(c), parsed.data);
      c.set("audit", {
        entity: "attendance",
        entityId: `${result.lessonId}:${result.studentId}`,
        summary: oneLine(
          `Checked out student ${result.studentId} from lesson ${result.lessonId}${result.pickedUpBy === null ? "" : ` with ${result.pickedUpBy}`}`,
        ),
      });
      return c.json(result);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

attendanceRoutes.post(
  "/lessons/:lessonId/attendance/check-out/override",
  requireRole("admin"),
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = attendanceCheckoutOverrideInputSchema.safeParse({
      ...body,
      lessonId: c.req.param("lessonId"),
    });
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await checkOutAttendanceOverride(
        c.env.DB,
        principal(c),
        parsed.data,
      );
      c.set("audit", {
        entity: "attendance",
        entityId: `${result.lessonId}:${result.studentId}`,
        summary: oneLine(
          `Overrode pickup authorization and checked out student ${result.studentId} from lesson ${result.lessonId} with ${result.pickedUpBy ?? parsed.data.pickedUpBy}`,
        ),
      });
      return c.json(result);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

attendanceRoutes.get("/attendance", canReadAttendance, async (c) => {
  const parsed = attendanceListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await listAttendance(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

attendanceRoutes.post(
  "/lessons/:lessonId/leave-requests",
  canRecordAttendance,
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = leaveRequestInputSchema.safeParse({
      ...body,
      lessonId: c.req.param("lessonId"),
    });
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await requestLeave(c.env.DB, principal(c), parsed.data);
      c.set("audit", {
        entity: "attendance",
        entityId: `${parsed.data.lessonId}:${parsed.data.studentId}`,
        summary: oneLine(
          `Recorded excused leave for student ${parsed.data.studentId} in lesson ${parsed.data.lessonId}; appended ${result.ledgerEntries.length} ledger entry/entries and ${result.drafts.length} draft(s)`,
        ),
      });
      return c.json(result, 201);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

attendanceRoutes.get("/balances", canReadLedger, async (c) => {
  const parsed = balancesGetInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await getBalances(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

attendanceRoutes.get("/deduction-policy", canReadAttendance, async (c) => {
  const parsed = deductionPolicyGetInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);
  return c.json(await getDeductionPolicy(c.env.DB, principal(c)));
});

attendanceRoutes.put(
  "/deduction-policy/:status",
  requireRole("admin"),
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = deductionPolicySetInputSchema.safeParse({
      ...body,
      status: c.req.param("status"),
    });
    if (!parsed.success) return invalidRequest(c);
    const result = await setDeductionPolicy(c.env.DB, principal(c), parsed.data);
    c.set("audit", {
      entity: "deduction_policy",
      entityId: result.status,
      summary: oneLine(`Set ${result.status} deduction policy to ${result.deducts}`),
    });
    return c.json(result);
  },
);

attendanceRoutes.post(
  "/ledger/adjustments",
  requireRole("admin"),
  async (c) => {
    const parsed = ledgerAdjustmentCreateInputSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await createLedgerAdjustment(c.env.DB, principal(c), parsed.data);
      c.set("audit", {
        entity: "credit_ledger",
        entityId: result.id,
        summary: oneLine(
          `Appended ${result.delta} credit adjustment for student ${result.studentId}: ${result.reason}`,
        ),
      });
      return c.json(result, 201);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

attendanceRoutes.get("/ledger", canReadLedger, async (c) => {
  const query = queryObject(c);
  const parsed = ledgerListInputSchema.safeParse({
    ...query,
    page: query.page === undefined ? undefined : Number(query.page),
    pageSize: query.pageSize === undefined ? undefined : Number(query.pageSize),
  });
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await listLedger(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});
