import {
  endpoints,
  pendingActionSchema,
  type EndpointName,
  type PendingAction,
  type PendingActionsCreateInput,
  type PendingActionsExecuteInput,
  type PendingActionsListInput,
  type PendingActionsListOutput,
  type PendingActionsRejectInput,
  type ProposalEndpointName,
} from "@h2class/shared";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Principal } from "../../auth/types";
import {
  pendingAction,
  pendingActionResolution,
} from "../../db/schema";
import { ownerActionDispatch } from "./owner-action-dispatch";

type Database = ReturnType<typeof drizzle>;
type PendingActionErrorCode =
  | "invalid_pending_target"
  | "invalid_pending_payload"
  | "pending_action_expired"
  | "pending_action_not_found"
  | "pending_action_not_pending"
  | "pending_action_payload_invalid";

export type PendingActionServiceError = {
  kind: "pending_action_service_error";
  code: PendingActionErrorCode;
  status: 400 | 404 | 409 | 410;
};

const fail = (
  code: PendingActionErrorCode,
  status: PendingActionServiceError["status"],
): never => {
  throw {
    kind: "pending_action_service_error",
    code,
    status,
  } satisfies PendingActionServiceError;
};

export const isPendingActionServiceError = (
  error: unknown,
): error is PendingActionServiceError =>
  typeof error === "object" &&
  error !== null &&
  Reflect.get(error, "kind") === "pending_action_service_error";

const actionColumns = {
  id: pendingAction.id,
  endpointName: pendingAction.endpointName,
  payloadJson: pendingAction.payloadJson,
  summary: pendingAction.summary,
  status: pendingAction.status,
  createdBy: pendingAction.createdBy,
  createdAt: pendingAction.createdAt,
  expiresAt: pendingAction.expiresAt,
  resolvedBy: pendingAction.resolvedBy,
  resolvedAt: pendingAction.resolvedAt,
  resultJson: pendingAction.resultJson,
};

type ActionRow = typeof pendingAction.$inferSelect;

const parseJson = (value: string, errorCode: PendingActionErrorCode): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail(errorCode, 409);
  }
};

const effectiveStatus = (row: ActionRow, now: Date) =>
  row.status === "pending" && row.expiresAt.getTime() <= now.getTime()
    ? "expired" as const
    : row.status;

const serializeAction = (row: ActionRow, now = new Date()): PendingAction =>
  pendingActionSchema.parse({
    id: row.id,
    endpointName: row.endpointName,
    payload: parseJson(row.payloadJson, "pending_action_payload_invalid"),
    summary: row.summary,
    status: effectiveStatus(row, now),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    result:
      row.resultJson === null
        ? null
        : parseJson(row.resultJson, "pending_action_payload_invalid"),
  });

const loadAction = async (db: Database, id: string): Promise<ActionRow> => {
  const [row] = await db
    .select(actionColumns)
    .from(pendingAction)
    .where(eq(pendingAction.id, id));
  if (row === undefined) return fail("pending_action_not_found", 404);
  return row;
};

const isProposalEndpointName = (value: string): value is ProposalEndpointName => {
  if (!Object.prototype.hasOwnProperty.call(endpoints, value)) return false;
  const endpoint = endpoints[value as EndpointName];
  return endpoint.ownerOnly &&
    !("toolExposure" in endpoint && endpoint.toolExposure === "hidden");
};

const validatedPayload = (name: ProposalEndpointName, payload: unknown) => {
  const parsed = endpoints[name].input.safeParse(payload);
  if (!parsed.success) return fail("invalid_pending_payload", 400);
  return parsed.data;
};

const storedPayload = (row: ActionRow): {
  name: ProposalEndpointName;
  payload: unknown;
} => {
  if (!isProposalEndpointName(row.endpointName)) {
    return fail("pending_action_payload_invalid", 409);
  }
  const raw = parseJson(row.payloadJson, "pending_action_payload_invalid");
  const parsed = endpoints[row.endpointName].input.safeParse(raw);
  if (!parsed.success) return fail("pending_action_payload_invalid", 409);
  return { name: row.endpointName, payload: parsed.data };
};

const requirePending = (row: ActionRow, now: Date) => {
  if (row.status !== "pending") fail("pending_action_not_pending", 409);
  if (row.expiresAt.getTime() <= now.getTime()) {
    fail("pending_action_expired", 410);
  }
};

const mapResolutionError = (
  error: unknown,
  targetMapError?: (error: unknown) => never,
): never => {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("pending_action_expired")) {
    fail("pending_action_expired", 410);
  }
  if (
    message.includes("pending_action_not_pending") ||
    message.includes("pending_action_resolution.pending_action_id")
  ) {
    fail("pending_action_not_pending", 409);
  }
  if (targetMapError !== undefined) targetMapError(error);
  throw error;
};

export const createPendingAction = async (
  d1: D1Database,
  principal: Principal,
  input: PendingActionsCreateInput,
): Promise<PendingAction> => {
  if (!isProposalEndpointName(input.endpoint)) {
    return fail("invalid_pending_target", 400);
  }
  const payload = validatedPayload(input.endpoint, input.payload);
  const payloadJson = JSON.stringify(payload);
  const createdAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1_000);
  const row: ActionRow = {
    id: crypto.randomUUID(),
    endpointName: input.endpoint,
    payloadJson,
    summary: ownerActionDispatch[input.endpoint].summary(payload),
    status: "pending",
    createdBy: principal.id,
    createdAt,
    expiresAt,
    resolvedBy: null,
    resolvedAt: null,
    resultJson: null,
  };
  await drizzle(d1).insert(pendingAction).values(row);
  return serializeAction(row, createdAt);
};

export const listPendingActions = async (
  d1: D1Database,
  _principal: Principal,
  _input: PendingActionsListInput,
): Promise<PendingActionsListOutput> => {
  const now = new Date();
  const rows = await drizzle(d1)
    .select(actionColumns)
    .from(pendingAction)
    .orderBy(desc(pendingAction.createdAt), desc(pendingAction.id));
  const actions = rows.map((row) => serializeAction(row, now));
  actions.sort((left, right) => {
    const leftRank = left.status === "pending" ? 0 : 1;
    const rightRank = right.status === "pending" ? 0 : 1;
    return leftRank - rightRank;
  });
  return { actions };
};

export const executePendingAction = async (
  d1: D1Database,
  principal: Principal,
  input: PendingActionsExecuteInput,
): Promise<PendingAction> => {
  const db = drizzle(d1);
  const existing = await loadAction(db, input.id);
  const resolvedAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  requirePending(existing, resolvedAt);
  const { name, payload } = storedPayload(existing);
  const plan = await ownerActionDispatch[name].prepare(d1, principal, payload);
  const parsedResult = endpoints[name].output.safeParse(plan.result);
  if (!parsedResult.success) {
    throw new Error(`Owner-action result for ${name} failed its shared schema`);
  }
  const resultJson = JSON.stringify(parsedResult.data);

  try {
    await db.batch([
      db.insert(pendingActionResolution).values({
        pendingActionId: existing.id,
        claimedAt: resolvedAt,
      }),
      ...plan.statements,
      db
        .update(pendingAction)
        .set({
          status: "executed",
          resolvedBy: principal.id,
          resolvedAt,
          resultJson,
        })
        .where(
          and(
            eq(pendingAction.id, existing.id),
            eq(pendingAction.status, "pending"),
          ),
        ),
    ]);
  } catch (error) {
    mapResolutionError(error, plan.mapError);
  }

  return serializeAction({
    ...existing,
    status: "executed",
    resolvedBy: principal.id,
    resolvedAt,
    resultJson,
  }, resolvedAt);
};

export const rejectPendingAction = async (
  d1: D1Database,
  principal: Principal,
  input: PendingActionsRejectInput,
): Promise<PendingAction> => {
  const db = drizzle(d1);
  const existing = await loadAction(db, input.id);
  const resolvedAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  requirePending(existing, resolvedAt);
  const resultJson =
    input.reason === undefined
      ? null
      : JSON.stringify({ reason: input.reason.trim() });
  try {
    await db.batch([
      db.insert(pendingActionResolution).values({
        pendingActionId: existing.id,
        claimedAt: resolvedAt,
      }),
      db
        .update(pendingAction)
        .set({
          status: "rejected",
          resolvedBy: principal.id,
          resolvedAt,
          resultJson,
        })
        .where(
          and(
            eq(pendingAction.id, existing.id),
            eq(pendingAction.status, "pending"),
          ),
        ),
    ]);
  } catch (error) {
    mapResolutionError(error);
  }
  return serializeAction({
    ...existing,
    status: "rejected",
    resolvedBy: principal.id,
    resolvedAt,
    resultJson,
  }, resolvedAt);
};
