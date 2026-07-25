import {
  classTypesCreateInputSchema,
  classTypesListInputSchema,
  classTypesUpdateInputSchema,
  pricesCurrentGetInputSchema,
  pricesListInputSchema,
  pricesSetInputSchema,
} from "@h2class/shared";
import { Hono, type Context } from "hono";
import { requireRole } from "../../auth/require-role";
import type { Principal } from "../../auth/types";
import type { AppEnv } from "../../env";
import {
  createClassType,
  getCurrentPrice,
  isCatalogServiceError,
  listClassTypes,
  listPrices,
  setPrice,
  updateClassType,
} from "./service";

const invalidRequest = (c: Context<AppEnv>) =>
  c.json({ error: "invalid_request" }, 400);

const principal = (c: Context<AppEnv>): Principal => {
  if (c.var.principal === undefined) {
    throw new Error("Authenticated catalog route is missing its principal");
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
  if (isCatalogServiceError(error)) {
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

export const catalogRoutes = new Hono<AppEnv>();

const canAccessCatalog = requireRole("admin", "staff", "agent");

catalogRoutes.post("/class-types", canAccessCatalog, async (c) => {
  const parsed = classTypesCreateInputSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    const result = await createClassType(c.env.DB, principal(c), parsed.data);
    setAudit(c, "class_type", result.id, `Created class type ${result.name}`);
    return c.json(result, 201);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

catalogRoutes.patch("/class-types/:id", canAccessCatalog, async (c) => {
  const body = inputObject(await jsonBody(c));
  const parsed = classTypesUpdateInputSchema.safeParse({
    ...body,
    id: c.req.param("id"),
  });
  if (!parsed.success) return invalidRequest(c);

  try {
    const result = await updateClassType(c.env.DB, principal(c), parsed.data);
    setAudit(c, "class_type", result.id, `Updated class type ${result.name}`);
    return c.json(result);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

catalogRoutes.get("/class-types", canAccessCatalog, async (c) => {
  const parsed = classTypesListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    return c.json(await listClassTypes(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

catalogRoutes.post("/prices", requireRole("admin"), async (c) => {
  const parsed = pricesSetInputSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    const result = await setPrice(c.env.DB, principal(c), parsed.data);
    setAudit(
      c,
      "price",
      result.id,
      `Set ${result.unit_amount_fen} fen price for class type ${result.classTypeId} effective ${result.effectiveFrom}`,
    );
    return c.json(result, 201);
  } catch (error) {
    return handleServiceError(c, error);
  }
});

catalogRoutes.get("/prices", canAccessCatalog, async (c) => {
  const parsed = pricesListInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    return c.json(await listPrices(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});

catalogRoutes.get("/prices/current", canAccessCatalog, async (c) => {
  const parsed = pricesCurrentGetInputSchema.safeParse(queryObject(c));
  if (!parsed.success) return invalidRequest(c);

  try {
    return c.json(await getCurrentPrice(c.env.DB, principal(c), parsed.data));
  } catch (error) {
    return handleServiceError(c, error);
  }
});
