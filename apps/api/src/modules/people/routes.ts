import {
  guardianLinkCreateInputSchema,
  guardianLinksListInputSchema,
  peopleCreateInputSchema,
  peopleDeleteInputSchema,
  peopleGetInputSchema,
  peopleListInputSchema,
  peopleRoleGrantInputSchema,
  peopleRoleRevokeInputSchema,
  peopleUpdateInputSchema,
} from "@h2class/shared";
import { Hono, type Context } from "hono";
import { requireRole } from "../../auth/require-role";
import type { Principal } from "../../auth/types";
import type { AppEnv } from "../../env";
import {
  createGuardianLink,
  createPerson,
  deletePerson,
  getPerson,
  grantPersonRole,
  isPeopleServiceError,
  listGuardianLinks,
  listPeople,
  revokePersonRole,
  updatePerson,
} from "./service";

const invalidRequest = (c: Context<AppEnv>) =>
  c.json({ error: "invalid_request" }, 400);

const principal = (c: Context<AppEnv>): Principal => {
  if (c.var.principal === undefined) {
    throw new Error("Authenticated people route is missing its principal");
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
  if (isPeopleServiceError(error)) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
};

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

const setAudit = (c: Context<AppEnv>, entityId: string, summary: string) => {
  c.set("audit", { entity: "person", entityId, summary: oneLine(summary) });
};

export const peopleRoutes = new Hono<AppEnv>();

const canManagePeople = requireRole("admin", "staff", "agent");

peopleRoutes.post("/people", canManagePeople, async (c) => {
  const parsed = peopleCreateInputSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    const result = await createPerson(c.env.DB, principal(c), parsed.data);
    setAudit(c, result.id, `Created person ${result.name}`);
    return c.json(result, 201);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

peopleRoutes.patch("/people/:id", canManagePeople, async (c) => {
  const body = inputObject(await jsonBody(c));
  const parsed = peopleUpdateInputSchema.safeParse({
    ...body,
    id: c.req.param("id"),
  });
  if (!parsed.success) return invalidRequest(c);

  try {
    const result = await updatePerson(c.env.DB, principal(c), parsed.data);
    setAudit(c, result.id, `Updated person ${result.name}`);
    return c.json(result);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

peopleRoutes.get("/people/:id", canManagePeople, async (c) => {
  const parsed = peopleGetInputSchema.safeParse({ id: c.req.param("id") });
  if (!parsed.success) return invalidRequest(c);

  try {
    return c.json(await getPerson(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

peopleRoutes.get("/people", canManagePeople, async (c) => {
  const parsed = peopleListInputSchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) return invalidRequest(c);

  try {
    return c.json(await listPeople(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

peopleRoutes.post("/guardian-links", canManagePeople, async (c) => {
  const parsed = guardianLinkCreateInputSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    const result = await createGuardianLink(
      c.env.DB,
      principal(c),
      parsed.data,
    );
    setAudit(
      c,
      result.guardianId,
      `Linked guardian ${result.guardianId} to student ${result.studentId}`,
    );
    return c.json(result, 201);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

peopleRoutes.get("/guardian-links", canManagePeople, async (c) => {
  const parsed = guardianLinksListInputSchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) return invalidRequest(c);

  try {
    return c.json(await listGuardianLinks(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

peopleRoutes.post(
  "/people/:id/roles",
  requireRole("admin"),
  async (c) => {
    const body = inputObject(await jsonBody(c));
    const parsed = peopleRoleGrantInputSchema.safeParse({
      ...body,
      id: c.req.param("id"),
    });
    if (!parsed.success) return invalidRequest(c);

    try {
      const result = await grantPersonRole(c.env.DB, principal(c), parsed.data);
      setAudit(
        c,
        result.id,
        `Granted ${parsed.data.role} role to ${result.name}`,
      );
      return c.json(result);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

peopleRoutes.delete(
  "/people/:id/roles/:role",
  requireRole("admin"),
  async (c) => {
    const parsed = peopleRoleRevokeInputSchema.safeParse({
      id: c.req.param("id"),
      role: c.req.param("role"),
    });
    if (!parsed.success) return invalidRequest(c);

    try {
      const result = await revokePersonRole(
        c.env.DB,
        principal(c),
        parsed.data,
      );
      setAudit(
        c,
        result.id,
        `Revoked ${parsed.data.role} role from ${result.name}`,
      );
      return c.json(result);
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);

peopleRoutes.delete(
  "/people/:id",
  requireRole("admin"),
  async (c) => {
    const parsed = peopleDeleteInputSchema.safeParse({
      id: c.req.param("id"),
    });
    if (!parsed.success) return invalidRequest(c);

    try {
      const result = await deletePerson(c.env.DB, principal(c), parsed.data);
      setAudit(c, result.id, `Deleted person ${result.name}`);
      return c.json({ id: result.id, deleted: result.deleted });
    } catch (error) {
      return handleServiceError(c, error);
    }
  },
);
