import type {
  PickupPerson,
  PickupPersonsListInput,
  PickupPersonsOutput,
  PickupPersonsSetInput,
} from "@h2class/shared";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Principal } from "../../auth/types";
import { enrollment, lesson, person, pickupPerson } from "../../db/schema";

type Database = ReturnType<typeof drizzle>;
type PickupErrorCode =
  | "duplicate_pickup_person"
  | "forbidden"
  | "person_not_found";

export type PickupServiceError = {
  kind: "pickup_service_error";
  code: PickupErrorCode;
  status: 400 | 403 | 404;
};

const fail = (
  code: PickupErrorCode,
  status: PickupServiceError["status"],
): never => {
  throw { kind: "pickup_service_error", code, status } satisfies PickupServiceError;
};

export const isPickupServiceError = (
  error: unknown,
): error is PickupServiceError =>
  typeof error === "object" &&
  error !== null &&
  Reflect.get(error, "kind") === "pickup_service_error";

const requirePerson = async (db: Database, id: string) => {
  const [row] = await db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.id, id));
  if (row === undefined) fail("person_not_found", 404);
};

const requirePickupReadAccess = async (
  db: Database,
  principal: Principal,
  studentId: string,
) => {
  if (
    principal.roles.some((role) =>
      role === "admin" || role === "staff" || role === "agent"
    )
  ) {
    return;
  }
  if (!principal.roles.includes("teacher")) fail("forbidden", 403);
  const [teacher] = await db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.authUserId, principal.id));
  if (teacher === undefined) return fail("forbidden", 403);
  const [accessible] = await db
    .select({ studentId: enrollment.studentId })
    .from(enrollment)
    .innerJoin(lesson, eq(lesson.id, enrollment.lessonId))
    .where(
      and(
        eq(lesson.teacherId, teacher.id),
        eq(enrollment.studentId, studentId),
      ),
    );
  if (accessible === undefined) fail("forbidden", 403);
};

const pickupColumns = {
  studentId: pickupPerson.studentId,
  name: pickupPerson.name,
  phone: pickupPerson.phone,
  relation: pickupPerson.relation,
};

export const setPickupPersons = async (
  d1: D1Database,
  _principal: Principal,
  input: PickupPersonsSetInput,
): Promise<PickupPersonsOutput> => {
  const db = drizzle(d1);
  await requirePerson(db, input.studentId);
  const names = input.pickupPersons.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    fail("duplicate_pickup_person", 400);
  }

  const values: PickupPerson[] = input.pickupPersons.map((pickup) => ({
    studentId: input.studentId,
    ...pickup,
  }));
  const removeExisting = db
    .delete(pickupPerson)
    .where(eq(pickupPerson.studentId, input.studentId));
  if (values.length === 0) {
    await db.batch([removeExisting]);
  } else {
    await db.batch([removeExisting, db.insert(pickupPerson).values(values)]);
  }
  return { pickupPersons: values };
};

export const listPickupPersons = async (
  d1: D1Database,
  principal: Principal,
  input: PickupPersonsListInput,
): Promise<PickupPersonsOutput> => {
  const db = drizzle(d1);
  await requirePerson(db, input.studentId);
  await requirePickupReadAccess(db, principal, input.studentId);
  return {
    pickupPersons: await db
      .select(pickupColumns)
      .from(pickupPerson)
      .where(eq(pickupPerson.studentId, input.studentId))
      .orderBy(asc(pickupPerson.name)),
  };
};
