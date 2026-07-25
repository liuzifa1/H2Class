import type {
  GuardianAccount,
  GuardianAccountsCreateInput,
  MyBalanceGetInput,
  MyBalanceGetOutput,
  MyFeedbackListInput,
  MyFeedbackListOutput,
  MyScheduleListInput,
  MyScheduleListOutput,
  MyStudentsListInput,
  MyStudentsListOutput,
} from "@h2class/shared";
import { hashPassword } from "better-auth/crypto";
import { and, desc, eq, gt, lt, sql, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";
import type { Principal } from "../../auth/types";
import {
  attendance,
  classType,
  creditLedger,
  enrollment,
  entitlement,
  guardianStudent,
  lesson,
  lessonFeedback,
  person,
  personRole,
} from "../../db/schema";
import { utcToShanghaiLocalParts } from "../../time/asia-shanghai";

type Database = ReturnType<typeof drizzle>;
type GuardianServiceErrorCode =
  | "email_already_used"
  | "guardian_account_exists"
  | "guardian_person_not_found"
  | "guardian_role_required"
  | "invalid_date_range";

export type GuardianServiceError = {
  kind: "guardian_service_error";
  code: GuardianServiceErrorCode;
  status: 400 | 404 | 409;
};

const fail = (
  code: GuardianServiceErrorCode,
  status: GuardianServiceError["status"] = 400,
): never => {
  throw { kind: "guardian_service_error", code, status } satisfies GuardianServiceError;
};

export const isGuardianServiceError = (
  error: unknown,
): error is GuardianServiceError =>
  typeof error === "object" &&
  error !== null &&
  Reflect.get(error, "kind") === "guardian_service_error";

const guardianPerson = alias(person, "guardian_person");
const studentPerson = alias(person, "student_person");
const teacherPerson = alias(person, "teacher_person");

const scopedStudents = async (
  db: Database,
  principal: Principal,
): Promise<MyStudentsListOutput["students"]> =>
  db
    .select({
      id: studentPerson.id,
      name: studentPerson.name,
      school: studentPerson.school,
      grade: studentPerson.grade,
    })
    .from(guardianStudent)
    .innerJoin(
      guardianPerson,
      and(
        eq(guardianPerson.id, guardianStudent.guardianId),
        eq(guardianPerson.authUserId, principal.id),
      ),
    )
    .innerJoin(studentPerson, eq(studentPerson.id, guardianStudent.studentId))
    .orderBy(studentPerson.name, studentPerson.id);

export const listMyStudents = async (
  d1: D1Database,
  principal: Principal,
  _input: MyStudentsListInput,
): Promise<MyStudentsListOutput> => ({
  students: await scopedStudents(drizzle(d1), principal),
});

export const listMySchedule = async (
  d1: D1Database,
  principal: Principal,
  input: MyScheduleListInput,
): Promise<MyScheduleListOutput> => {
  const rangeStart = new Date(input.startAt);
  const rangeEnd = new Date(input.endAt);
  if (rangeStart >= rangeEnd) fail("invalid_date_range");

  const rows = await drizzle(d1)
    .select({
      lessonId: lesson.id,
      studentId: studentPerson.id,
      studentName: studentPerson.name,
      classTypeId: classType.id,
      classTypeName: classType.name,
      teacherId: teacherPerson.id,
      teacherName: teacherPerson.name,
      startAt: lesson.startAt,
      endAt: lesson.endAt,
      status: lesson.status,
      attendanceStatus: attendance.status,
      checkedInAt: attendance.checkedInAt,
      checkedOutAt: attendance.checkedOutAt,
      pickedUpBy: attendance.pickedUpBy,
    })
    .from(guardianStudent)
    .innerJoin(
      guardianPerson,
      and(
        eq(guardianPerson.id, guardianStudent.guardianId),
        eq(guardianPerson.authUserId, principal.id),
      ),
    )
    .innerJoin(studentPerson, eq(studentPerson.id, guardianStudent.studentId))
    .innerJoin(enrollment, eq(enrollment.studentId, studentPerson.id))
    .innerJoin(lesson, eq(lesson.id, enrollment.lessonId))
    .innerJoin(classType, eq(classType.id, lesson.classTypeId))
    .innerJoin(teacherPerson, eq(teacherPerson.id, lesson.teacherId))
    .leftJoin(
      attendance,
      and(
        eq(attendance.lessonId, lesson.id),
        eq(attendance.studentId, studentPerson.id),
      ),
    )
    .where(and(lt(lesson.startAt, rangeEnd), gt(lesson.endAt, rangeStart)))
    .orderBy(lesson.startAt, studentPerson.name, lesson.id, studentPerson.id);

  return {
    lessons: rows.map((row) => ({
      lessonId: row.lessonId,
      studentId: row.studentId,
      studentName: row.studentName,
      classTypeId: row.classTypeId,
      classTypeName: row.classTypeName,
      teacherId: row.teacherId,
      teacherName: row.teacherName,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      status: row.status,
      attendance:
        row.attendanceStatus === null
          ? null
          : {
              status: row.attendanceStatus,
              checkedInAt: row.checkedInAt?.toISOString() ?? null,
              checkedOutAt: row.checkedOutAt?.toISOString() ?? null,
              pickedUpBy: row.pickedUpBy,
            },
    })),
  };
};

export const getMyBalance = async (
  d1: D1Database,
  principal: Principal,
  _input: MyBalanceGetInput,
): Promise<MyBalanceGetOutput> => {
  const db = drizzle(d1);
  const students = await scopedStudents(db, principal);
  const balanceRows = await db
    .select({
      studentId: studentPerson.id,
      balance: sum(creditLedger.delta),
    })
    .from(guardianStudent)
    .innerJoin(
      guardianPerson,
      and(
        eq(guardianPerson.id, guardianStudent.guardianId),
        eq(guardianPerson.authUserId, principal.id),
      ),
    )
    .innerJoin(studentPerson, eq(studentPerson.id, guardianStudent.studentId))
    .leftJoin(creditLedger, eq(creditLedger.studentId, studentPerson.id))
    .groupBy(studentPerson.id);
  const balances = new Map(
    balanceRows.map((row) => [row.studentId, Number(row.balance ?? 0)]),
  );

  const entitlementRows = await db
    .select({
      id: entitlement.id,
      studentId: entitlement.studentId,
      kind: entitlement.kind,
      classTypeId: entitlement.classTypeId,
      classTypeName: classType.name,
      validFrom: entitlement.validFrom,
      validTo: entitlement.validTo,
      storedStatus: entitlement.status,
      createdAt: entitlement.createdAt,
      remainingCredits: sql<number>`coalesce((select sum(${creditLedger.delta}) from ${creditLedger} where ${creditLedger.entitlementId} = ${entitlement.id}), 0)`,
    })
    .from(guardianStudent)
    .innerJoin(
      guardianPerson,
      and(
        eq(guardianPerson.id, guardianStudent.guardianId),
        eq(guardianPerson.authUserId, principal.id),
      ),
    )
    .innerJoin(entitlement, eq(entitlement.studentId, guardianStudent.studentId))
    .innerJoin(classType, eq(classType.id, entitlement.classTypeId))
    .orderBy(desc(entitlement.createdAt), desc(entitlement.id));

  const today = utcToShanghaiLocalParts(new Date()).date;
  return {
    students: students.map((student) => ({
      studentId: student.id,
      studentName: student.name,
      totalRemainingCredits: balances.get(student.id) ?? 0,
      entitlements: entitlementRows
        .filter((row) => row.studentId === student.id)
        .map((row) => {
          if (row.classTypeId === null) {
            throw new Error(`Entitlement ${row.id} is missing its class type`);
          }
          const remainingCredits = Number(row.remainingCredits ?? 0);
          const status = row.storedStatus === "refunded"
            ? "refunded" as const
            : row.kind === "package"
              ? remainingCredits <= 0
                ? "exhausted" as const
                : "active" as const
              : row.validTo !== null && row.validTo < today
                ? "expired" as const
                : "active" as const;
          return {
            id: row.id,
            kind: row.kind,
            classTypeId: row.classTypeId,
            classTypeName: row.classTypeName,
            remainingCredits: row.kind === "package" ? remainingCredits : null,
            validFrom: row.validFrom,
            validTo: row.validTo,
            status,
            createdAt: row.createdAt.toISOString(),
          };
        }),
    })),
  };
};

export const listMyFeedback = async (
  d1: D1Database,
  principal: Principal,
  _input: MyFeedbackListInput,
): Promise<MyFeedbackListOutput> => {
  const rows = await drizzle(d1)
    .select({
      lessonId: lessonFeedback.lessonId,
      studentId: studentPerson.id,
      studentName: studentPerson.name,
      classTypeId: classType.id,
      classTypeName: classType.name,
      teacherName: teacherPerson.name,
      lessonStartAt: lesson.startAt,
      contentCovered: lessonFeedback.contentCovered,
      homework: lessonFeedback.homework,
      performanceNote: lessonFeedback.performanceNote,
      createdAt: lessonFeedback.createdAt,
    })
    .from(guardianStudent)
    .innerJoin(
      guardianPerson,
      and(
        eq(guardianPerson.id, guardianStudent.guardianId),
        eq(guardianPerson.authUserId, principal.id),
      ),
    )
    .innerJoin(studentPerson, eq(studentPerson.id, guardianStudent.studentId))
    .innerJoin(lessonFeedback, eq(lessonFeedback.studentId, studentPerson.id))
    .innerJoin(lesson, eq(lesson.id, lessonFeedback.lessonId))
    .innerJoin(classType, eq(classType.id, lesson.classTypeId))
    .innerJoin(teacherPerson, eq(teacherPerson.id, lesson.teacherId))
    .orderBy(desc(lesson.startAt), desc(lessonFeedback.createdAt));
  return {
    feedback: rows.map((row) => ({
      ...row,
      lessonStartAt: row.lessonStartAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    })),
  };
};

const provisioningFailure = (error: unknown): never => {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("user_email_unique") || message.includes("user.email")) {
    fail("email_already_used", 409);
  }
  if (
    message.includes("person_auth_user_id_unique") ||
    message.includes("FOREIGN KEY constraint failed")
  ) {
    fail("guardian_account_exists", 409);
  }
  throw error;
};

export const createGuardianAccount = async (
  d1: D1Database,
  _principal: Principal,
  input: GuardianAccountsCreateInput,
): Promise<GuardianAccount> => {
  const db = drizzle(d1);
  const [guardian] = await db
    .select({ id: person.id, name: person.name, authUserId: person.authUserId })
    .from(person)
    .where(eq(person.id, input.personId));
  if (guardian === undefined) return fail("guardian_person_not_found", 404);
  if (guardian.authUserId !== null) fail("guardian_account_exists", 409);
  const [role] = await db
    .select({ personId: personRole.personId })
    .from(personRole)
    .where(
      and(
        eq(personRole.personId, input.personId),
        eq(personRole.role, "guardian"),
      ),
    );
  if (role === undefined) fail("guardian_role_required");

  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  const authUserId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1_000);
  try {
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
           SELECT ?, name, ?, 1, ?, ?
           FROM person
           WHERE id = ? AND auth_user_id IS NULL
             AND EXISTS (
               SELECT 1 FROM person_role
               WHERE person_id = person.id AND role = 'guardian'
             )`,
        )
        .bind(authUserId, email, now, now, input.personId),
      d1
        .prepare(
          `INSERT INTO account
             (id, account_id, provider_id, user_id, password, created_at, updated_at)
           VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
        )
        .bind(accountId, authUserId, authUserId, passwordHash, now, now),
      d1
        .prepare(
          "UPDATE person SET auth_user_id = ? WHERE id = ? AND auth_user_id IS NULL",
        )
        .bind(authUserId, input.personId),
    ]);
  } catch (error) {
    provisioningFailure(error);
  }
  return { personId: input.personId, authUserId, email };
};
