import type {
  GuardianLink,
  GuardianLinkCreateInput,
  GuardianLinksListInput,
  GuardianLinksListOutput,
  PeopleCreateInput,
  PeopleDeleteInput,
  PeopleDeleteOutput,
  PeopleGetInput,
  PeopleListInput,
  PeopleListOutput,
  PeopleRoleGrantInput,
  PeopleRoleRevokeInput,
  PeopleUpdateInput,
  Person,
  PersonDetail,
  PersonRole,
} from "@h2class/shared";
import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Principal } from "../../auth/types";
import { executeMutationPlan, type MutationPlan } from "../../db/mutation-plan";
import { guardianStudent, person, personRole } from "../../db/schema";

type Database = ReturnType<typeof drizzle>;
type PeopleErrorCode =
  | "forbidden"
  | "guardian_link_exists"
  | "guardian_phone_required"
  | "guardian_role_required"
  | "guardian_student_same_person"
  | "no_changes"
  | "person_not_found"
  | "role_already_granted"
  | "role_not_found";

export type PeopleServiceError = {
  kind: "people_service_error";
  code: PeopleErrorCode;
  status: 400 | 403 | 404 | 409 | 422;
};

const fail = (
  status: PeopleServiceError["status"],
  code: PeopleErrorCode,
): never => {
  throw {
    kind: "people_service_error",
    status,
    code,
  } satisfies PeopleServiceError;
};

export const isPeopleServiceError = (
  error: unknown,
): error is PeopleServiceError => {
  if (typeof error !== "object" || error === null) return false;
  return Reflect.get(error, "kind") === "people_service_error";
};

const isUniqueConstraintError = (error: unknown) =>
  error instanceof Error && error.message.includes("UNIQUE constraint failed");

const personColumns = {
  id: person.id,
  name: person.name,
  phone: person.phone,
  school: person.school,
  grade: person.grade,
  notes: person.notes,
  createdAt: person.createdAt,
};

type PersonRow = {
  id: string;
  name: string;
  phone: string | null;
  school: string | null;
  grade: string | null;
  notes: string | null;
  createdAt: Date;
};

const ROLE_ORDER: PersonRole[] = ["admin", "staff", "teacher", "guardian"];

const sortRoles = (roles: PersonRole[]) =>
  [...roles].sort(
    (left, right) => ROLE_ORDER.indexOf(left) - ROLE_ORDER.indexOf(right),
  );

const serializePerson = (row: PersonRow, roles: PersonRole[]): Person => ({
  ...row,
  roles: sortRoles(roles),
  createdAt: row.createdAt.toISOString(),
});

const loadRoles = async (db: Database, personIds: string[]) => {
  const rolesByPerson = new Map<string, PersonRole[]>();
  if (personIds.length === 0) return rolesByPerson;

  const rows = await db
    .select({ personId: personRole.personId, role: personRole.role })
    .from(personRole)
    .where(inArray(personRole.personId, personIds));

  for (const row of rows) {
    const roles = rolesByPerson.get(row.personId) ?? [];
    roles.push(row.role);
    rolesByPerson.set(row.personId, roles);
  }
  return rolesByPerson;
};

const loadPerson = async (db: Database, id: string): Promise<Person> => {
  const [row] = await db
    .select(personColumns)
    .from(person)
    .where(eq(person.id, id));
  if (row === undefined) return fail(404, "person_not_found");

  const rolesByPerson = await loadRoles(db, [id]);
  return serializePerson(row, rolesByPerson.get(id) ?? []);
};

const requireGuardianPhone = (
  roles: PersonRole[],
  phone: string | null | undefined,
) => {
  if (roles.includes("guardian") && (phone === null || phone === undefined)) {
    fail(422, "guardian_phone_required");
  }
};

const canManageMedicalNotes = (principal: Principal) =>
  principal.roles.some((role) => role === "admin" || role === "staff");

export const createPerson = async (
  d1: D1Database,
  principal: Principal,
  input: PeopleCreateInput,
): Promise<Person> => {
  const db = drizzle(d1);
  const id = crypto.randomUUID();
  const roles = [...new Set(input.roles ?? [])];
  if (
    roles.some((role) => role === "admin" || role === "staff") &&
    !principal.roles.includes("admin")
  ) {
    fail(403, "forbidden");
  }
  if (input.medicalNotes !== undefined && !canManageMedicalNotes(principal)) {
    fail(403, "forbidden");
  }
  requireGuardianPhone(roles, input.phone);

  const insertPerson = db.insert(person).values({
    id,
    name: input.name,
    phone: input.phone ?? null,
    school: input.school ?? null,
    grade: input.grade ?? null,
    notes: input.notes ?? null,
    medicalNotes: input.medicalNotes ?? null,
  });
  const insertRoles = roles.map((role) =>
    db.insert(personRole).values({ personId: id, role }),
  );
  await db.batch([insertPerson, ...insertRoles]);

  return loadPerson(db, id);
};

export const updatePerson = async (
  d1: D1Database,
  principal: Principal,
  input: PeopleUpdateInput,
): Promise<Person> => {
  const db = drizzle(d1);
  const existing = await loadPerson(db, input.id);
  if (input.phone === null && existing.roles.includes("guardian")) {
    fail(422, "guardian_phone_required");
  }
  if (input.medicalNotes !== undefined && !canManageMedicalNotes(principal)) {
    fail(403, "forbidden");
  }

  const updates: Partial<
    Pick<
      typeof person.$inferInsert,
      "name" | "phone" | "school" | "grade" | "notes" | "medicalNotes"
    >
  > = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.phone !== undefined) updates.phone = input.phone;
  if (input.school !== undefined) updates.school = input.school;
  if (input.grade !== undefined) updates.grade = input.grade;
  if (input.notes !== undefined) updates.notes = input.notes;
  if (input.medicalNotes !== undefined) updates.medicalNotes = input.medicalNotes;
  if (Object.keys(updates).length === 0) fail(400, "no_changes");

  await db.update(person).set(updates).where(eq(person.id, input.id));
  return loadPerson(db, input.id);
};

export const getPerson = async (
  d1: D1Database,
  principal: Principal,
  input: PeopleGetInput,
): Promise<PersonDetail> => {
  const db = drizzle(d1);
  const result = await loadPerson(db, input.id);
  if (!canManageMedicalNotes(principal)) return result;
  const [medical] = await db
    .select({ medicalNotes: person.medicalNotes })
    .from(person)
    .where(eq(person.id, input.id));
  return { ...result, medicalNotes: medical?.medicalNotes ?? null };
};

export const listPeople = async (
  d1: D1Database,
  _principal: Principal,
  input: PeopleListInput,
): Promise<PeopleListOutput> => {
  const db = drizzle(d1);
  const nameFilter =
    input.search === undefined
      ? undefined
      : like(person.name, `%${input.search}%`);

  const rows =
    input.role === undefined
      ? await db
          .select(personColumns)
          .from(person)
          .where(nameFilter)
          .orderBy(person.name, person.id)
      : await db
          .select(personColumns)
          .from(person)
          .innerJoin(personRole, eq(personRole.personId, person.id))
          .where(
            nameFilter === undefined
              ? eq(personRole.role, input.role)
              : and(eq(personRole.role, input.role), nameFilter),
          )
          .orderBy(person.name, person.id);

  const rolesByPerson = await loadRoles(
    db,
    rows.map(({ id }) => id),
  );
  return {
    people: rows.map((row) =>
      serializePerson(row, rolesByPerson.get(row.id) ?? []),
    ),
  };
};

export const createGuardianLink = async (
  d1: D1Database,
  _principal: Principal,
  input: GuardianLinkCreateInput,
): Promise<GuardianLink> => {
  const db = drizzle(d1);
  if (input.guardianId === input.studentId) {
    fail(422, "guardian_student_same_person");
  }

  const guardian = await loadPerson(db, input.guardianId);
  await loadPerson(db, input.studentId);
  if (!guardian.roles.includes("guardian")) {
    fail(422, "guardian_role_required");
  }

  const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  try {
    await db.insert(guardianStudent).values({
      guardianId: input.guardianId,
      studentId: input.studentId,
      createdAt,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) fail(409, "guardian_link_exists");
    throw error;
  }

  return {
    guardianId: input.guardianId,
    studentId: input.studentId,
    createdAt: createdAt.toISOString(),
  };
};

export const listGuardianLinks = async (
  d1: D1Database,
  _principal: Principal,
  input: GuardianLinksListInput,
): Promise<GuardianLinksListOutput> => {
  const rows = await drizzle(d1)
    .select({
      guardianId: guardianStudent.guardianId,
      studentId: guardianStudent.studentId,
      createdAt: guardianStudent.createdAt,
    })
    .from(guardianStudent)
    .where(
      and(
        input.guardianId === undefined
          ? undefined
          : eq(guardianStudent.guardianId, input.guardianId),
        input.studentId === undefined
          ? undefined
          : eq(guardianStudent.studentId, input.studentId),
      ),
    )
    .orderBy(
      guardianStudent.studentId,
      guardianStudent.guardianId,
      guardianStudent.createdAt,
    );
  return {
    links: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  };
};

export const prepareGrantPersonRole = async (
  d1: D1Database,
  _principal: Principal,
  input: PeopleRoleGrantInput,
): Promise<MutationPlan<Person>> => {
  const db = drizzle(d1);
  const existing = await loadPerson(db, input.id);
  requireGuardianPhone([input.role], existing.phone);
  if (existing.roles.includes(input.role)) fail(409, "role_already_granted");

  return {
    statements: [
      db.insert(personRole).values({ personId: input.id, role: input.role }),
    ],
    result: {
      ...existing,
      roles: sortRoles([...existing.roles, input.role]),
    },
    mapError: (error): never => {
      if (isUniqueConstraintError(error)) fail(409, "role_already_granted");
      throw error;
    },
  };
};

export const grantPersonRole = async (
  d1: D1Database,
  principal: Principal,
  input: PeopleRoleGrantInput,
): Promise<Person> => executeMutationPlan(
  d1,
  await prepareGrantPersonRole(d1, principal, input),
);

export const prepareRevokePersonRole = async (
  d1: D1Database,
  _principal: Principal,
  input: PeopleRoleRevokeInput,
): Promise<MutationPlan<Person>> => {
  const db = drizzle(d1);
  const existing = await loadPerson(db, input.id);
  if (!existing.roles.includes(input.role)) fail(404, "role_not_found");
  return {
    statements: [
      db
        .delete(personRole)
        .where(
          and(
            eq(personRole.personId, input.id),
            eq(personRole.role, input.role),
          ),
        ),
    ],
    result: {
      ...existing,
      roles: existing.roles.filter((role) => role !== input.role),
    },
  };
};

export const revokePersonRole = async (
  d1: D1Database,
  principal: Principal,
  input: PeopleRoleRevokeInput,
): Promise<Person> => executeMutationPlan(
  d1,
  await prepareRevokePersonRole(d1, principal, input),
);

export const prepareDeletePerson = async (
  d1: D1Database,
  _principal: Principal,
  input: PeopleDeleteInput,
): Promise<MutationPlan<PeopleDeleteOutput & { name: string }>> => {
  const db = drizzle(d1);
  const existing = await loadPerson(db, input.id);
  return {
    statements: [db.delete(person).where(eq(person.id, input.id))],
    result: { id: input.id, deleted: true, name: existing.name },
  };
};

export const deletePerson = async (
  d1: D1Database,
  principal: Principal,
  input: PeopleDeleteInput,
): Promise<PeopleDeleteOutput & { name: string }> => executeMutationPlan(
  d1,
  await prepareDeletePerson(d1, principal, input),
);
