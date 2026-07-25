import {
  pendingActionsCreateInputSchema,
  pendingActionsExecuteInputSchema,
  pendingActionsListInputSchema,
  pendingActionsRejectInputSchema,
} from "@h2class/shared";
import { Hono, type Context } from "hono";
import { requireRole } from "../../auth/require-role";
import type { Principal } from "../../auth/types";
import type { AppEnv } from "../../env";
import { isAttendanceServiceError } from "../attendance/service";
import { isBillingServiceError } from "../billing/service";
import { isCatalogServiceError } from "../catalog/service";
import { isPeopleServiceError } from "../people/service";
import { isReportsServiceError } from "../reports/service";
import { isSchedulingServiceError } from "../scheduling/service";
import {
  createPendingAction,
  executePendingAction,
  isPendingActionServiceError,
  listPendingActions,
  rejectPendingAction,
} from "./service";

const invalidRequest = (c: Context<AppEnv>) =>
  c.json({ error: "invalid_request" }, 400);

const jsonBody = async (c: Context<AppEnv>): Promise<unknown> =>
  c.req.json().catch(() => undefined);

const inputObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const principal = (c: Context<AppEnv>): Principal => {
  if (c.var.principal === undefined) {
    throw new Error("Authenticated pending-action route is missing its principal");
  }
  return c.var.principal;
};

const handleServiceError = (c: Context<AppEnv>, error: unknown): Response => {
  if (isPendingActionServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  if (isPeopleServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  if (isCatalogServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  if (isAttendanceServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  if (isBillingServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  if (isReportsServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  if (isSchedulingServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
};

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
const canAccessProposals = requireRole("admin", "agent");

export const pendingActionRoutes = new Hono<AppEnv>();

pendingActionRoutes.post("/pending-actions", canAccessProposals, async (c) => {
  const parsed = pendingActionsCreateInputSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return invalidRequest(c);
  try {
    const result = await createPendingAction(c.env.DB, principal(c), parsed.data);
    c.set("audit", {
      entity: "pending_action",
      entityId: result.id,
      summary: oneLine(`Proposed ${result.endpointName}: ${result.summary}`),
    });
    return c.json(result, 201);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

pendingActionRoutes.get("/pending-actions", canAccessProposals, async (c) => {
  const parsed = pendingActionsListInputSchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) return invalidRequest(c);
  return c.json(await listPendingActions(c.env.DB, principal(c), parsed.data));
});

pendingActionRoutes.post(
  "/pending-actions/:id/execute",
  requireRole("admin"),
  async (c) => {
    // The execute body is intentionally unread: only the stored payload is used.
    const parsed = pendingActionsExecuteInputSchema.safeParse({
      id: c.req.param("id"),
    });
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await executePendingAction(c.env.DB, principal(c), parsed.data);
      c.set("audit", {
        entity: "pending_action",
        entityId: result.id,
        summary: oneLine(
          `Executed proposal ${result.id} created by ${result.createdBy} as ${result.endpointName}: ${result.summary}`,
        ),
      });
      return c.json(result);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

pendingActionRoutes.post(
  "/pending-actions/:id/reject",
  requireRole("admin"),
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = pendingActionsRejectInputSchema.safeParse({
      ...body,
      id: c.req.param("id"),
    });
    if (!parsed.success) return invalidRequest(c);
    try {
      const result = await rejectPendingAction(c.env.DB, principal(c), parsed.data);
      c.set("audit", {
        entity: "pending_action",
        entityId: result.id,
        summary: oneLine(
          `Rejected proposal ${result.id} created by ${result.createdBy} as ${result.endpointName}${parsed.data.reason === undefined ? "" : `: ${parsed.data.reason}`}`,
        ),
      });
      return c.json(result);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);
