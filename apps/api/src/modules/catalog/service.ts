import type {
  ClassType,
  ClassTypesCreateInput,
  ClassTypesListInput,
  ClassTypesListOutput,
  ClassTypesUpdateInput,
  Price,
  PricesCurrentGetInput,
  PricesListInput,
  PricesListOutput,
  PricesSetInput,
} from "@h2class/shared";
import { and, desc, eq, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Principal } from "../../auth/types";
import { executeMutationPlan, type MutationPlan } from "../../db/mutation-plan";
import { classType, price } from "../../db/schema";

type Database = ReturnType<typeof drizzle>;
type CatalogErrorCode =
  | "class_type_category_locked"
  | "class_type_not_found"
  | "current_price_not_found"
  | "no_changes";

export type CatalogServiceError = {
  kind: "catalog_service_error";
  code: CatalogErrorCode;
  status: 400 | 404 | 409;
};

const fail = (
  status: CatalogServiceError["status"],
  code: CatalogErrorCode,
): never => {
  throw {
    kind: "catalog_service_error",
    status,
    code,
  } satisfies CatalogServiceError;
};

export const isCatalogServiceError = (
  error: unknown,
): error is CatalogServiceError => {
  if (typeof error !== "object" || error === null) return false;
  return Reflect.get(error, "kind") === "catalog_service_error";
};

const errorText = (error: unknown) => {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof Error) messages.push(current.message);
    if (typeof current !== "object" || current === null) break;
    const cause = Reflect.get(current, "cause");
    if (cause === undefined || cause === current) break;
    current = cause;
  }
  return messages.join(" ");
};

const classTypeWriteFailure = (error: unknown): never => {
  if (errorText(error).includes("class_type_category_locked")) {
    fail(409, "class_type_category_locked");
  }
  throw error;
};

const classTypeColumns = {
  id: classType.id,
  name: classType.name,
  capacity: classType.capacity,
  durationMin: classType.durationMin,
  category: classType.category,
  active: classType.active,
};

const priceColumns = {
  id: price.id,
  classTypeId: price.classTypeId,
  unit_amount_fen: price.unitAmountFen,
  effectiveFrom: price.effectiveFrom,
  createdAt: price.createdAt,
};

type PriceRow = {
  id: string;
  classTypeId: string;
  unit_amount_fen: number;
  effectiveFrom: Date;
  createdAt: Date;
};

const serializePrice = (row: PriceRow): Price => ({
  ...row,
  effectiveFrom: row.effectiveFrom.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

const loadClassType = async (
  db: Database,
  id: string,
): Promise<ClassType> => {
  const [row] = await db
    .select(classTypeColumns)
    .from(classType)
    .where(eq(classType.id, id));
  if (row === undefined) return fail(404, "class_type_not_found");
  return row;
};

const loadPrice = async (db: Database, id: string): Promise<Price> => {
  const [row] = await db
    .select(priceColumns)
    .from(price)
    .where(eq(price.id, id));
  if (row === undefined) return fail(404, "current_price_not_found");
  return serializePrice(row);
};

export const createClassType = async (
  d1: D1Database,
  _principal: Principal,
  input: ClassTypesCreateInput,
): Promise<ClassType> => {
  const db = drizzle(d1);
  const id = crypto.randomUUID();
  await db.insert(classType).values({ id, ...input });
  return loadClassType(db, id);
};

export const updateClassType = async (
  d1: D1Database,
  _principal: Principal,
  input: ClassTypesUpdateInput,
): Promise<ClassType> => {
  const db = drizzle(d1);
  await loadClassType(db, input.id);

  const updates: Partial<
    Pick<
      typeof classType.$inferInsert,
      "name" | "capacity" | "durationMin" | "category" | "active"
    >
  > = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.capacity !== undefined) updates.capacity = input.capacity;
  if (input.durationMin !== undefined) updates.durationMin = input.durationMin;
  if (input.category !== undefined) updates.category = input.category;
  if (input.active !== undefined) updates.active = input.active;
  if (Object.keys(updates).length === 0) fail(400, "no_changes");

  try {
    await db.update(classType).set(updates).where(eq(classType.id, input.id));
  } catch (error) {
    classTypeWriteFailure(error);
  }
  return loadClassType(db, input.id);
};

export const listClassTypes = async (
  d1: D1Database,
  _principal: Principal,
  _input: ClassTypesListInput,
): Promise<ClassTypesListOutput> => ({
  classTypes: await drizzle(d1)
    .select(classTypeColumns)
    .from(classType)
    .orderBy(classType.name, classType.id),
});

export const prepareSetPrice = async (
  d1: D1Database,
  _principal: Principal,
  input: PricesSetInput,
): Promise<MutationPlan<Price>> => {
  const db = drizzle(d1);
  await loadClassType(db, input.classTypeId);

  const id = crypto.randomUUID();
  const createdAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const values: typeof price.$inferInsert = {
    id,
    classTypeId: input.classTypeId,
    unitAmountFen: input.unit_amount_fen,
    effectiveFrom: new Date(input.effectiveFrom),
    createdAt,
  };
  return {
    statements: [db.insert(price).values(values)],
    result: serializePrice({
      id,
      classTypeId: values.classTypeId,
      unit_amount_fen: values.unitAmountFen,
      effectiveFrom: values.effectiveFrom,
      createdAt,
    }),
  };
};

export const setPrice = async (
  d1: D1Database,
  principal: Principal,
  input: PricesSetInput,
): Promise<Price> => executeMutationPlan(
  d1,
  await prepareSetPrice(d1, principal, input),
);

export const listPrices = async (
  d1: D1Database,
  _principal: Principal,
  input: PricesListInput,
): Promise<PricesListOutput> => {
  const db = drizzle(d1);
  const rows =
    input.classTypeId === undefined
      ? await db
          .select(priceColumns)
          .from(price)
          .orderBy(
            price.classTypeId,
            desc(price.effectiveFrom),
            desc(price.createdAt),
            desc(price.id),
          )
      : await db
          .select(priceColumns)
          .from(price)
          .where(eq(price.classTypeId, input.classTypeId))
          .orderBy(
            desc(price.effectiveFrom),
            desc(price.createdAt),
            desc(price.id),
          );
  return { prices: rows.map(serializePrice) };
};

export const getCurrentPrice = async (
  d1: D1Database,
  _principal: Principal,
  input: PricesCurrentGetInput,
): Promise<Price> => {
  const db = drizzle(d1);
  await loadClassType(db, input.classTypeId);
  const [row] = await db
    .select(priceColumns)
    .from(price)
    .where(
      and(
        eq(price.classTypeId, input.classTypeId),
        lte(
          price.effectiveFrom,
          new Date(Math.floor(Date.now() / 1_000) * 1_000),
        ),
      ),
    )
    .orderBy(
      desc(price.effectiveFrom),
      desc(price.createdAt),
      desc(price.id),
    );
  if (row === undefined) return fail(404, "current_price_not_found");
  return serializePrice(row);
};
