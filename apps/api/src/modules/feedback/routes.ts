import {
  feedbackCreateInputSchema,
  feedbackListInputSchema,
} from "@h2class/shared";
import { Hono, type Context } from "hono";
import { requireRole } from "../../auth/require-role";
import type { Principal } from "../../auth/types";
import type { AppEnv } from "../../env";
import {
  createFeedback,
  isFeedbackServiceError,
  listFeedback,
} from "./service";

const invalidRequest = (c: Context<AppEnv>) =>
  c.json({ error: "invalid_request" }, 400);

const principal = (c: Context<AppEnv>): Principal => {
  if (c.var.principal === undefined) {
    throw new Error("Authenticated feedback route is missing its principal");
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
  if (isFeedbackServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
};

const canCreateFeedback = requireRole("admin", "staff", "teacher", "agent");
const canReadFeedback = requireRole("admin", "staff", "teacher", "agent");

export const feedbackRoutes = new Hono<AppEnv>();

feedbackRoutes.post(
  "/lessons/:lessonId/feedback",
  canCreateFeedback,
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = feedbackCreateInputSchema.safeParse({
      ...body,
      lessonId: c.req.param("lessonId"),
    });
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await createFeedback(c.env.DB, principal(c), parsed.data);
      c.set("audit", {
        entity: "lesson_feedback",
        entityId: `${result.feedback.lessonId}:${result.feedback.studentId}`,
        summary: `Recorded feedback for student ${result.feedback.studentId} in lesson ${result.feedback.lessonId}; created ${result.drafts.length} guardian draft(s)`,
      });
      return c.json(result, 201);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

feedbackRoutes.get("/feedback", canReadFeedback, async (c) => {
  const parsed = feedbackListInputSchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) return invalidRequest(c);
  try {
    return c.json(await listFeedback(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});
