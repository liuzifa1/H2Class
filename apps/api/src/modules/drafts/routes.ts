import {
  draftsCreateInputSchema,
  draftsListInputSchema,
  draftsMarkSentInputSchema,
} from "@h2class/shared";
import { Hono, type Context } from "hono";
import { requireRole } from "../../auth/require-role";
import type { Principal } from "../../auth/types";
import type { AppEnv } from "../../env";
import {
  createDraft,
  isDraftsServiceError,
  listDrafts,
  markDraftSent,
} from "./service";

const invalidRequest = (c: Context<AppEnv>) =>
  c.json({ error: "invalid_request" }, 400);

const principal = (c: Context<AppEnv>): Principal => {
  if (c.var.principal === undefined) {
    throw new Error("Authenticated drafts route is missing its principal");
  }
  return c.var.principal;
};

const jsonBody = async (c: Context<AppEnv>): Promise<unknown> =>
  c.req.json().catch(() => undefined);

const queryObject = (c: Context<AppEnv>) =>
  Object.fromEntries(new URL(c.req.url).searchParams);

const handleServiceError = (c: Context<AppEnv>, error: unknown): Response => {
  if (isDraftsServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
};

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
const canManageDrafts = requireRole("admin", "staff", "agent");

export const draftsRoutes = new Hono<AppEnv>();

draftsRoutes.post("/message-drafts", canManageDrafts, async (c) => {
  const parsed = draftsCreateInputSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    const result = await createDraft(c.env.DB, principal(c), parsed.data);
    c.set("audit", {
      entity: "message_draft",
      entityId: result.id,
      summary: oneLine(`Created ${result.purpose} draft for person ${result.personId}`),
    });
    return c.json(result, 201);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

draftsRoutes.get("/message-drafts", canManageDrafts, async (c) => {
  const parsed = draftsListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    return c.json(await listDrafts(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

draftsRoutes.post("/message-drafts/:id/mark-sent", canManageDrafts, async (c) => {
  const parsed = draftsMarkSentInputSchema.safeParse({ id: c.req.param("id") });
  if (!parsed.success) return invalidRequest(c);

  try {
    const result = await markDraftSent(c.env.DB, principal(c), parsed.data);
    c.set("audit", {
      entity: "message_draft",
      entityId: result.id,
      summary: oneLine(`Marked ${result.purpose} draft sent for person ${result.personId}`),
    });
    return c.json(result);
  } catch (error) {
    return handleServiceError(c, error);
  }
});
