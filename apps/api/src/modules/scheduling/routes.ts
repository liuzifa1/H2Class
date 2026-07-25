import {
  availabilityExceptionSetInputSchema,
  availabilityGetInputSchema,
  availabilitySetInputSchema,
  closureDaysListInputSchema,
  closureDaysSetInputSchema,
  enrollmentsAddInputSchema,
  enrollmentsRemoveInputSchema,
  freeSlotsFindInputSchema,
  lessonsCancelInputSchema,
  lessonsBulkApplyInputSchema,
  lessonsCreateInputSchema,
  lessonsGetInputSchema,
  lessonsListInputSchema,
  lessonsMoveInputSchema,
  termsCreateInputSchema,
  termsListInputSchema,
} from "@h2class/shared";
import { Hono, type Context } from "hono";
import { requireRole } from "../../auth/require-role";
import type { Principal } from "../../auth/types";
import type { AppEnv } from "../../env";
import {
  addEnrollment,
  bulkApplyLessons,
  cancelLesson,
  createLessons,
  createTerm,
  findFreeSlots,
  getAvailability,
  getLesson,
  isSchedulingServiceError,
  listClosureDays,
  listLessons,
  listTerms,
  moveLesson,
  removeEnrollment,
  setAvailability,
  setAvailabilityException,
  setClosureDay,
} from "./service";

const invalidRequest = (c: Context<AppEnv>) =>
  c.json({ error: "invalid_request" }, 400);

const principal = (c: Context<AppEnv>): Principal => {
  if (c.var.principal === undefined) {
    throw new Error("Authenticated scheduling route is missing its principal");
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
  if (isSchedulingServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
};

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

const setAudit = (
  c: Context<AppEnv>,
  entity: string,
  entityId: string,
  summary: string,
) => c.set("audit", { entity, entityId, summary: oneLine(summary) });

const canManageSchedule = requireRole("admin", "staff", "agent");
const canReadSchedule = requireRole("admin", "staff", "teacher", "agent");

export const schedulingRoutes = new Hono<AppEnv>();

schedulingRoutes.post(
  "/lessons/bulk-apply",
  requireRole("admin"),
  async (c) => {
    const parsed = lessonsBulkApplyInputSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await bulkApplyLessons(c.env.DB, principal(c), parsed.data);
      const firstId = result.lessons[0]?.id ?? "none";
      setAudit(
        c,
        "lesson",
        firstId,
        `Bulk applied ${result.lessons.length} lesson(s) with ${result.drafts.length} message draft(s)`,
      );
      return c.json(result, 201);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

schedulingRoutes.post("/lessons", canManageSchedule, async (c) => {
  const parsed = lessonsCreateInputSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    const result = await createLessons(c.env.DB, principal(c), parsed.data);
    const firstId = result.lessons[0]?.id ?? "none";
    setAudit(
      c,
      "lesson",
      firstId,
      `Created ${result.lessons.length} lesson(s) with ${result.drafts.length} message draft(s)`,
    );
    return c.json(result, 201);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

schedulingRoutes.patch("/lessons/:id/move", canManageSchedule, async (c) => {
  const body = inputObject(await jsonBody(c));
  const parsed = lessonsMoveInputSchema.safeParse({
    ...body,
    id: c.req.param("id"),
  });
  if (!parsed.success) return invalidRequest(c);

  try {
    const result = await moveLesson(c.env.DB, principal(c), parsed.data);
    setAudit(
      c,
      "lesson",
      result.lesson.id,
      `Moved lesson ${result.lesson.id} to ${result.lesson.startAt} and created ${result.drafts.length} message draft(s)`,
    );
    return c.json(result);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

schedulingRoutes.post("/lessons/:id/cancel", canManageSchedule, async (c) => {
  const body = inputObject(await jsonBody(c));
  const parsed = lessonsCancelInputSchema.safeParse({
    ...body,
    id: c.req.param("id"),
  });
  if (!parsed.success) return invalidRequest(c);

  try {
    const result = await cancelLesson(c.env.DB, principal(c), parsed.data);
    setAudit(
      c,
      "lesson",
      result.lesson.id,
      `Cancelled lesson ${result.lesson.id} and created ${result.drafts.length} message draft(s)`,
    );
    return c.json(result);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

schedulingRoutes.get("/lessons/:id", canReadSchedule, async (c) => {
  const parsed = lessonsGetInputSchema.safeParse({ id: c.req.param("id") });
  if (!parsed.success) return invalidRequest(c);

  try {
    return c.json(await getLesson(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

schedulingRoutes.get("/lessons", canReadSchedule, async (c) => {
  const parsed = lessonsListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    return c.json(await listLessons(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

schedulingRoutes.get("/free-slots", canReadSchedule, async (c) => {
  const parsed = freeSlotsFindInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    return c.json(await findFreeSlots(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

schedulingRoutes.post(
  "/lessons/:lessonId/enrollments",
  canManageSchedule,
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = enrollmentsAddInputSchema.safeParse({
      ...body,
      lessonId: c.req.param("lessonId"),
    });
    if (!parsed.success) return invalidRequest(c);

    try {
      const result = await addEnrollment(c.env.DB, principal(c), parsed.data);
      setAudit(
        c,
        "enrollment",
        `${result.lessonId}:${result.studentId}`,
        `Enrolled student ${result.studentId} in lesson ${result.lessonId}`,
      );
      return c.json(result, 201);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

schedulingRoutes.delete(
  "/lessons/:lessonId/enrollments/:studentId",
  canManageSchedule,
  async (c) => {
    const parsed = enrollmentsRemoveInputSchema.safeParse({
      lessonId: c.req.param("lessonId"),
      studentId: c.req.param("studentId"),
    });
    if (!parsed.success) return invalidRequest(c);

    try {
      const result = await removeEnrollment(
        c.env.DB,
        principal(c),
        parsed.data,
      );
      setAudit(
        c,
        "enrollment",
        `${result.lessonId}:${result.studentId}`,
        `Removed student ${result.studentId} from lesson ${result.lessonId}`,
      );
      return c.json(result);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

schedulingRoutes.put(
  "/teachers/:teacherId/availability",
  canManageSchedule,
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = availabilitySetInputSchema.safeParse({
      ...body,
      teacherId: c.req.param("teacherId"),
    });
    if (!parsed.success) return invalidRequest(c);

    try {
      const result = await setAvailability(c.env.DB, principal(c), parsed.data);
      setAudit(
        c,
        "teacher_availability",
        result.teacherId,
        `Replaced weekly availability for teacher ${result.teacherId} with ${result.slots.length} slots`,
      );
      return c.json(result);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

schedulingRoutes.get(
  "/teachers/:teacherId/availability",
  canReadSchedule,
  async (c) => {
    const parsed = availabilityGetInputSchema.safeParse({
      ...queryObject(c),
      teacherId: c.req.param("teacherId"),
    });
    if (!parsed.success) return invalidRequest(c);

    try {
      return c.json(await getAvailability(c.env.DB, principal(c), parsed.data));
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

schedulingRoutes.put(
  "/teachers/:teacherId/availability-exceptions/:date",
  canManageSchedule,
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = availabilityExceptionSetInputSchema.safeParse({
      ...body,
      teacherId: c.req.param("teacherId"),
      date: c.req.param("date"),
    });
    if (!parsed.success) return invalidRequest(c);

    try {
      const result = await setAvailabilityException(
        c.env.DB,
        principal(c),
        parsed.data,
      );
      setAudit(
        c,
        "availability_exception",
        `${result.teacherId}:${result.date}`,
        `Set availability exception for teacher ${result.teacherId} on ${result.date}`,
      );
      return c.json(result);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

schedulingRoutes.put(
  "/closure-days/:date",
  canManageSchedule,
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = closureDaysSetInputSchema.safeParse({
      ...body,
      date: c.req.param("date"),
    });
    if (!parsed.success) return invalidRequest(c);

    try {
      const result = await setClosureDay(c.env.DB, principal(c), parsed.data);
      setAudit(c, "closure_day", result.date, `Set closure day ${result.date}: ${result.reason}`);
      return c.json(result);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

schedulingRoutes.get("/closure-days", canReadSchedule, async (c) => {
  const parsed = closureDaysListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    return c.json(await listClosureDays(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

schedulingRoutes.post("/terms", canManageSchedule, async (c) => {
  const parsed = termsCreateInputSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    const result = await createTerm(c.env.DB, principal(c), parsed.data);
    setAudit(c, "term", result.id, `Created term ${result.name}`);
    return c.json(result, 201);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

schedulingRoutes.get("/terms", canReadSchedule, async (c) => {
  const parsed = termsListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    return c.json(await listTerms(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});
