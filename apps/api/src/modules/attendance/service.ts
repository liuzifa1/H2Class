import type {
  Attendance,
  AttendanceCheckinInput,
  AttendanceCheckoutInput,
  AttendanceCheckoutOverrideInput,
  AttendanceListInput,
  AttendanceListOutput,
  AttendanceMutationOutput,
  AttendanceStatus,
  BalancesGetInput,
  BalancesGetOutput,
  CreditLedgerEntry,
  DeductionPolicy,
  DeductionPolicyGetOutput,
  DeductionPolicySetInput,
  LeaveRequestInput,
  LedgerAdjustmentCreateInput,
  LedgerListInput,
  LedgerListOutput,
  MessageDraft,
} from "@h2class/shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  notExists,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Principal } from "../../auth/types";
import { executeMutationPlan, type MutationPlan } from "../../db/mutation-plan";
import {
  attendance,
  classType,
  creditLedger,
  deductionPolicy,
  enrollment,
  entitlement,
  guardianStudent,
  lesson,
  messageDraft,
  person,
  pickupPerson,
} from "../../db/schema";
import { formatShanghaiDateTime } from "../../time/asia-shanghai";

type Database = ReturnType<typeof drizzle>;
type AttendanceErrorCode =
  | "attendance_already_recorded"
  | "attendance_not_found"
  | "attendance_not_present"
  | "attendance_roster_mismatch"
  | "adjustment_reason_required"
  | "already_checked_out"
  | "duplicate_student"
  | "forbidden"
  | "invalid_adjustment"
  | "lesson_not_found"
  | "lesson_not_scheduled"
  | "no_eligible_entitlement"
  | "person_not_found"
  | "unknown_pickup_person";

export type AttendanceServiceError = {
  kind: "attendance_service_error";
  code: AttendanceErrorCode;
  status: 400 | 403 | 404 | 409;
};

const fail = (
  code: AttendanceErrorCode,
  status: AttendanceServiceError["status"] = 400,
): never => {
  throw { kind: "attendance_service_error", code, status } satisfies AttendanceServiceError;
};

export const isAttendanceServiceError = (
  error: unknown,
): error is AttendanceServiceError => {
  if (typeof error !== "object" || error === null) return false;
  return Reflect.get(error, "kind") === "attendance_service_error";
};

const attendanceColumns = {
  lessonId: attendance.lessonId,
  studentId: attendance.studentId,
  status: attendance.status,
  checkedInAt: attendance.checkedInAt,
  checkedOutAt: attendance.checkedOutAt,
  pickedUpBy: attendance.pickedUpBy,
  markedBy: attendance.markedBy,
};

type AttendanceRow = {
  lessonId: string;
  studentId: string;
  status: AttendanceStatus;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  pickedUpBy: string | null;
  markedBy: string;
};

const ledgerColumns = {
  id: creditLedger.id,
  studentId: creditLedger.studentId,
  entitlementId: creditLedger.entitlementId,
  delta: creditLedger.delta,
  kind: creditLedger.kind,
  lessonId: creditLedger.lessonId,
  reason: creditLedger.reason,
  createdBy: creditLedger.createdBy,
  createdAt: creditLedger.createdAt,
};

type LedgerRow = {
  id: string;
  studentId: string;
  entitlementId: string | null;
  delta: number;
  kind: "purchase" | "attendance" | "adjustment" | "refund";
  lessonId: string | null;
  reason: string;
  createdBy: string;
  createdAt: Date;
};

type DraftRecord = {
  output: MessageDraft;
  values: typeof messageDraft.$inferInsert;
};

type LedgerCandidate = LedgerRow & { attendanceStatus: AttendanceStatus };

const serializeAttendance = (row: AttendanceRow): Attendance => ({
  ...row,
  checkedInAt: row.checkedInAt?.toISOString() ?? null,
  checkedOutAt: row.checkedOutAt?.toISOString() ?? null,
});

const serializeLedger = (row: LedgerRow): CreditLedgerEntry => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

const loadLessonContext = async (db: Database, lessonId: string) => {
  const [row] = await db
    .select({
      id: lesson.id,
      teacherId: lesson.teacherId,
      startAt: lesson.startAt,
      endAt: lesson.endAt,
      status: lesson.status,
      classTypeId: lesson.classTypeId,
      classTypeName: classType.name,
      classTypeCategory: classType.category,
    })
    .from(lesson)
    .innerJoin(classType, eq(classType.id, lesson.classTypeId))
    .where(eq(lesson.id, lessonId));
  if (row === undefined) return fail("lesson_not_found", 404);
  return row;
};

const principalPersonId = async (db: Database, principal: Principal) => {
  const [row] = await db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.authUserId, principal.id));
  if (row === undefined) return fail("forbidden", 403);
  return row.id;
};

const requireLessonAccess = async (
  db: Database,
  principal: Principal,
  teacherId: string,
) => {
  if (principal.roles.some((role) => ["admin", "staff", "agent"].includes(role))) {
    return;
  }
  if (!principal.roles.includes("teacher")) fail("forbidden", 403);
  if ((await principalPersonId(db, principal)) !== teacherId) {
    fail("forbidden", 403);
  }
};

const loadRoster = async (db: Database, lessonId: string) =>
  db
    .select({ studentId: enrollment.studentId, studentName: person.name })
    .from(enrollment)
    .innerJoin(person, eq(person.id, enrollment.studentId))
    .where(eq(enrollment.lessonId, lessonId))
    .orderBy(enrollment.studentId);

const createDraftRecord = (
  personId: string,
  purpose: string,
  text: string,
  createdAt: Date,
): DraftRecord => {
  const id = crypto.randomUUID();
  return {
    output: {
      id,
      personId,
      purpose,
      text,
      status: "draft",
      createdAt: createdAt.toISOString(),
      sentAt: null,
    },
    values: { id, personId, purpose, text, status: "draft", createdAt, sentAt: null },
  };
};

const STATUS_TEXT: Record<AttendanceStatus, string> = {
  present: "出勤",
  absent: "缺勤",
  excused_leave: "请假",
  late_cancel: "临时取消",
};

const guardianIdsByStudent = async (db: Database, studentIds: string[]) => {
  const result = new Map<string, string[]>();
  const rows = await db
    .select({ studentId: guardianStudent.studentId, guardianId: guardianStudent.guardianId })
    .from(guardianStudent)
    .where(inArray(guardianStudent.studentId, studentIds));
  for (const row of rows) {
    const guardianIds = result.get(row.studentId) ?? [];
    guardianIds.push(row.guardianId);
    result.set(row.studentId, guardianIds);
  }
  return result;
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

const attendanceWriteFailure = (error: unknown): never => {
  const message = errorText(error);
  if (
    message.includes("attendance_lesson_student_unique") ||
    message.includes("attendance.lesson_id, attendance.student_id")
  ) {
    fail("attendance_already_recorded", 409);
  }
  if (message.includes("invalid_attendance_target")) {
    fail("attendance_roster_mismatch");
  }
  if (message.includes("attendance_roster_mismatch")) {
    fail("attendance_roster_mismatch");
  }
  if (message.includes("no_eligible_entitlement")) {
    fail("no_eligible_entitlement");
  }
  throw error;
};

const writeAttendanceBatch = async (
  db: Database,
  attendanceRows: Array<typeof attendance.$inferInsert>,
  ledgerCandidates: LedgerCandidate[],
  drafts: DraftRecord[],
  completeLessonId?: string,
) => {
  const attendanceInsert = db.insert(attendance).values(attendanceRows);
  const ledgerInserts = ledgerCandidates.map((candidate) =>
    db.insert(creditLedger).select(
      db
        .select({
          id: sql<string>`${candidate.id}`.as("id"),
          studentId: sql<string>`${candidate.studentId}`.as("student_id"),
          entitlementId: entitlement.id,
          delta: sql<number>`-1`.as("delta"),
          kind: sql<"attendance">`'attendance'`.as("kind"),
          lessonId: sql<string>`${candidate.lessonId}`.as("lesson_id"),
          reason: sql<string>`${candidate.reason}`.as("reason"),
          createdBy: sql<string>`${candidate.createdBy}`.as("created_by"),
          createdAt: sql<Date>`${Math.floor(candidate.createdAt.getTime() / 1_000)}`.as(
            "created_at",
          ),
        })
        .from(entitlement)
        .innerJoin(
          lesson,
          and(
            eq(lesson.id, candidate.lessonId ?? ""),
            isNull(lesson.makeupForLessonId),
          ),
        )
        .innerJoin(classType, eq(classType.id, lesson.classTypeId))
        .innerJoin(
          deductionPolicy,
          eq(deductionPolicy.attendanceStatus, candidate.attendanceStatus),
        )
        .where(
          and(
            eq(deductionPolicy.deducts, true),
            sql`${classType.category} != '托管'`,
            eq(entitlement.studentId, candidate.studentId),
            eq(entitlement.kind, "package"),
            eq(entitlement.status, "active"),
            eq(entitlement.classTypeId, lesson.classTypeId),
            sql`(select coalesce(sum(${creditLedger.delta}), 0) from ${creditLedger} where ${creditLedger.entitlementId} = ${entitlement.id}) > 0`,
          ),
        )
        .orderBy(entitlement.createdAt, entitlement.id)
        .limit(1),
    ),
  );
  const draftInsert =
    drafts.length === 0
      ? []
      : [db.insert(messageDraft).values(drafts.map(({ values }) => values))];
  const lessonCompletion =
    completeLessonId === undefined
      ? []
      : [
          db
            .update(lesson)
            .set({ status: "completed" })
            .where(
              and(
                eq(lesson.id, completeLessonId),
                eq(lesson.status, "scheduled"),
              ),
            ),
        ];
  try {
    await db.batch([
      attendanceInsert,
      ...ledgerInserts,
      ...draftInsert,
      ...lessonCompletion,
    ]);
  } catch (error) {
    attendanceWriteFailure(error);
  }
  if (ledgerCandidates.length === 0) return [];
  return db
    .select(ledgerColumns)
    .from(creditLedger)
    .where(inArray(creditLedger.id, ledgerCandidates.map(({ id }) => id)))
    .orderBy(creditLedger.id);
};

export const checkInAttendance = async (
  d1: D1Database,
  principal: Principal,
  input: AttendanceCheckinInput,
): Promise<AttendanceMutationOutput> => {
  const db = drizzle(d1);
  const lessonContext = await loadLessonContext(db, input.lessonId);
  await requireLessonAccess(db, principal, lessonContext.teacherId);
  const existingRows = await db
    .select(attendanceColumns)
    .from(attendance)
    .where(eq(attendance.lessonId, input.lessonId));
  if (lessonContext.status !== "scheduled") {
    if (existingRows.length > 0) fail("attendance_already_recorded", 409);
    fail("lesson_not_scheduled");
  }
  const roster = await loadRoster(db, input.lessonId);
  const submittedIds = input.students.map(({ studentId }) => studentId);
  if (new Set(submittedIds).size !== submittedIds.length) fail("duplicate_student");
  const rosterIds = roster.map(({ studentId }) => studentId);
  if (
    submittedIds.length !== rosterIds.length ||
    submittedIds.some((studentId) => !rosterIds.includes(studentId))
  ) {
    fail("attendance_roster_mismatch");
  }

  const statusByStudent = new Map(
    input.students.map(({ studentId, status }) => [studentId, status]),
  );
  const existingByStudent = new Map(existingRows.map((row) => [row.studentId, row]));
  for (const row of existingRows) {
    if (
      row.status !== "excused_leave" ||
      row.checkedInAt !== null ||
      statusByStudent.get(row.studentId) !== "excused_leave"
    ) {
      fail("attendance_already_recorded", 409);
    }
  }
  const remainingRoster = roster.filter(({ studentId }) => !existingByStudent.has(studentId));
  if (remainingRoster.length === 0) fail("attendance_already_recorded", 409);

  const createdAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const attendanceRows: Array<typeof attendance.$inferInsert> = remainingRoster.map(
    ({ studentId }) => ({
      lessonId: input.lessonId,
      studentId,
      status: statusByStudent.get(studentId) ?? "absent",
      checkedInAt: createdAt,
      checkedOutAt: null,
      pickedUpBy: null,
      markedBy: principal.id,
    }),
  );
  const ledgerCandidates: LedgerCandidate[] = attendanceRows.map(
    ({ studentId, status }) => ({
      id: crypto.randomUUID(),
      studentId,
      entitlementId: null,
      delta: -1,
      kind: "attendance",
      lessonId: input.lessonId,
      reason: `课程${input.lessonId}考勤：${STATUS_TEXT[status]}`,
      createdBy: principal.id,
      createdAt,
      attendanceStatus: status,
    }),
  );
  const remainingStudentIds = remainingRoster.map(({ studentId }) => studentId);
  const guardianMap = await guardianIdsByStudent(db, remainingStudentIds);
  const timeText = `${formatShanghaiDateTime(lessonContext.startAt)}—${formatShanghaiDateTime(lessonContext.endAt)}`;
  const drafts = remainingRoster.flatMap(({ studentId, studentName }) => {
    const status = statusByStudent.get(studentId) ?? "absent";
    return (guardianMap.get(studentId) ?? []).map((guardianId) =>
      createDraftRecord(
        guardianId,
        "attendance_recorded_guardian",
        `${studentName}在${timeText}的${lessonContext.classTypeName}课程考勤已记录为“${STATUS_TEXT[status]}”。`,
        createdAt,
      ),
    );
  });

  const ledgerRows = await writeAttendanceBatch(
    db,
    attendanceRows,
    ledgerCandidates,
    drafts,
    input.lessonId,
  );
  const writtenByStudent = new Map(
    attendanceRows.map((row) => [
      row.studentId,
      serializeAttendance({
        ...row,
        checkedInAt: row.checkedInAt ?? null,
        checkedOutAt: row.checkedOutAt ?? null,
        pickedUpBy: row.pickedUpBy ?? null,
      }),
    ]),
  );
  return {
    attendance: roster.map(({ studentId }) => {
      const existing = existingByStudent.get(studentId);
      if (existing !== undefined) return serializeAttendance(existing);
      const written = writtenByStudent.get(studentId);
      if (written === undefined) throw new Error("Attendance result is missing a roster row");
      return written;
    }),
    ledgerEntries: ledgerRows.map(serializeLedger),
    drafts: drafts.map(({ output }) => output),
  };
};

export const requestLeave = async (
  d1: D1Database,
  principal: Principal,
  input: LeaveRequestInput,
): Promise<AttendanceMutationOutput> => {
  const db = drizzle(d1);
  const lessonContext = await loadLessonContext(db, input.lessonId);
  await requireLessonAccess(db, principal, lessonContext.teacherId);
  if (lessonContext.status !== "scheduled") fail("lesson_not_scheduled");
  const roster = await loadRoster(db, input.lessonId);
  const student = roster.find(({ studentId }) => studentId === input.studentId);
  if (student === undefined) return fail("attendance_roster_mismatch");
  const createdAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const attendanceRow: typeof attendance.$inferInsert = {
    lessonId: input.lessonId,
    studentId: input.studentId,
    status: "excused_leave",
    checkedInAt: null,
    checkedOutAt: null,
    pickedUpBy: null,
    markedBy: principal.id,
  };
  const ledgerCandidates: LedgerCandidate[] = [{
    id: crypto.randomUUID(),
    studentId: input.studentId,
    entitlementId: null,
    delta: -1,
    kind: "attendance",
    lessonId: input.lessonId,
    reason: `课程${input.lessonId}考勤：请假`,
    createdBy: principal.id,
    createdAt,
    attendanceStatus: "excused_leave",
  }];
  const guardians = await guardianIdsByStudent(db, [input.studentId]);
  const timeText = `${formatShanghaiDateTime(lessonContext.startAt)}—${formatShanghaiDateTime(lessonContext.endAt)}`;
  const drafts = (guardians.get(input.studentId) ?? []).map((guardianId) =>
    createDraftRecord(
      guardianId,
      "leave_recorded_guardian",
      `${student.studentName}已登记${timeText}的${lessonContext.classTypeName}课程请假。`,
      createdAt,
    ),
  );
  const ledgerRows = await writeAttendanceBatch(
    db,
    [attendanceRow],
    ledgerCandidates,
    drafts,
  );
  return {
    attendance: [serializeAttendance({ ...attendanceRow, checkedInAt: null, checkedOutAt: null, pickedUpBy: null })],
    ledgerEntries: ledgerRows.map(serializeLedger),
    drafts: drafts.map(({ output }) => output),
  };
};

const checkOutAttendanceInternal = async (
  d1: D1Database,
  principal: Principal,
  input: AttendanceCheckoutInput,
): Promise<Attendance> => {
  const db = drizzle(d1);
  const lessonContext = await loadLessonContext(db, input.lessonId);
  await requireLessonAccess(db, principal, lessonContext.teacherId);
  const [existing] = await db
    .select(attendanceColumns)
    .from(attendance)
    .where(
      and(
        eq(attendance.lessonId, input.lessonId),
        eq(attendance.studentId, input.studentId),
      ),
    );
  if (existing === undefined) return fail("attendance_not_found", 404);
  if (existing.status !== "present") fail("attendance_not_present");
  if (existing.checkedOutAt !== null) fail("already_checked_out", 409);
  const checkedOutAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const pickedUpBy = input.pickedUpBy;
  const pickupAuthorization = or(
    notExists(
      db
        .select({ studentId: pickupPerson.studentId })
        .from(pickupPerson)
        .where(eq(pickupPerson.studentId, input.studentId)),
    ),
    exists(
      db
        .select({ studentId: pickupPerson.studentId })
        .from(pickupPerson)
        .where(
          and(
            eq(pickupPerson.studentId, input.studentId),
            eq(pickupPerson.name, pickedUpBy),
          ),
        ),
    ),
  );
  let updated: AttendanceRow[] = [];
  try {
    updated = await db
      .update(attendance)
      .set({ checkedOutAt, pickedUpBy })
      .where(
        and(
          eq(attendance.lessonId, input.lessonId),
          eq(attendance.studentId, input.studentId),
          eq(attendance.status, "present"),
          isNull(attendance.checkedOutAt),
          pickupAuthorization,
        ),
      )
      .returning(attendanceColumns);
  } catch (error) {
    attendanceWriteFailure(error);
  }
  const [result] = updated;
  if (result === undefined) {
    const registered = await db
      .select({ name: pickupPerson.name })
      .from(pickupPerson)
      .where(eq(pickupPerson.studentId, input.studentId));
    if (
      registered.length > 0 &&
      !registered.some(({ name }) => name === pickedUpBy)
    ) {
      fail("unknown_pickup_person");
    }
  }
  if (result === undefined) return fail("already_checked_out", 409);
  return serializeAttendance(result);
};

export const checkOutAttendance = async (
  d1: D1Database,
  principal: Principal,
  input: AttendanceCheckoutInput,
): Promise<Attendance> =>
  checkOutAttendanceInternal(d1, principal, input);

export const prepareCheckOutAttendanceOverride = async (
  d1: D1Database,
  principal: Principal,
  input: AttendanceCheckoutOverrideInput,
): Promise<MutationPlan<Attendance>> => {
  const db = drizzle(d1);
  const lessonContext = await loadLessonContext(db, input.lessonId);
  await requireLessonAccess(db, principal, lessonContext.teacherId);
  const [existing] = await db
    .select(attendanceColumns)
    .from(attendance)
    .where(
      and(
        eq(attendance.lessonId, input.lessonId),
        eq(attendance.studentId, input.studentId),
      ),
    );
  if (existing === undefined) return fail("attendance_not_found", 404);
  if (existing.status !== "present") fail("attendance_not_present");
  if (existing.checkedOutAt !== null) fail("already_checked_out", 409);
  const checkedOutAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  return {
    statements: [
      db
        .update(attendance)
        .set({ checkedOutAt, pickedUpBy: input.pickedUpBy })
        .where(
          and(
            eq(attendance.lessonId, input.lessonId),
            eq(attendance.studentId, input.studentId),
          ),
        ),
    ],
    result: serializeAttendance({
      ...existing,
      checkedOutAt,
      pickedUpBy: input.pickedUpBy,
    }),
    mapError: (error): never => {
      const message = errorText(error);
      if (message.includes("already_checked_out")) {
        fail("already_checked_out", 409);
      }
      if (message.includes("no_eligible_entitlement")) {
        fail("no_eligible_entitlement");
      }
      throw error;
    },
  };
};

export const checkOutAttendanceOverride = async (
  d1: D1Database,
  principal: Principal,
  input: AttendanceCheckoutOverrideInput,
): Promise<Attendance> => executeMutationPlan(
  d1,
  await prepareCheckOutAttendanceOverride(d1, principal, input),
);

export const listAttendance = async (
  d1: D1Database,
  principal: Principal,
  input: AttendanceListInput,
): Promise<AttendanceListOutput> => {
  const db = drizzle(d1);
  const teacherId =
    principal.roles.some((role) => ["admin", "staff", "agent"].includes(role))
      ? undefined
      : await principalPersonId(db, principal);
  const rows = await db
    .select(attendanceColumns)
    .from(attendance)
    .innerJoin(lesson, eq(lesson.id, attendance.lessonId))
    .where(
      and(
        input.lessonId === undefined ? undefined : eq(attendance.lessonId, input.lessonId),
        input.studentId === undefined ? undefined : eq(attendance.studentId, input.studentId),
        teacherId === undefined ? undefined : eq(lesson.teacherId, teacherId),
      ),
    )
    .orderBy(desc(lesson.startAt), asc(attendance.studentId));
  return { attendance: rows.map(serializeAttendance) };
};

export const getBalances = async (
  d1: D1Database,
  _principal: Principal,
  input: BalancesGetInput,
): Promise<BalancesGetOutput> => {
  const db = drizzle(d1);
  if (input.studentId !== undefined) {
    const [student] = await db
      .select({ id: person.id })
      .from(person)
      .where(eq(person.id, input.studentId));
    if (student === undefined) fail("person_not_found", 404);
    const [row] = await db
      .select({ balance: sum(creditLedger.delta) })
      .from(creditLedger)
      .where(eq(creditLedger.studentId, input.studentId));
    return { balances: [{ studentId: input.studentId, balance: Number(row?.balance ?? 0) }] };
  }
  const rows = await db
    .select({ studentId: creditLedger.studentId, balance: sum(creditLedger.delta) })
    .from(creditLedger)
    .groupBy(creditLedger.studentId)
    .orderBy(creditLedger.studentId);
  return {
    balances: rows.map(({ studentId, balance }) => ({ studentId, balance: Number(balance ?? 0) })),
  };
};

export const getDeductionPolicy = async (
  d1: D1Database,
  _principal: Principal,
): Promise<DeductionPolicyGetOutput> => ({
  policies: await drizzle(d1)
    .select({ status: deductionPolicy.attendanceStatus, deducts: deductionPolicy.deducts })
    .from(deductionPolicy)
    .orderBy(deductionPolicy.attendanceStatus),
});

export const prepareSetDeductionPolicy = async (
  d1: D1Database,
  _principal: Principal,
  input: DeductionPolicySetInput,
): Promise<MutationPlan<DeductionPolicy>> => {
  const db = drizzle(d1);
  return {
    statements: [
      db
        .insert(deductionPolicy)
        .values({ attendanceStatus: input.status, deducts: input.deducts })
        .onConflictDoUpdate({
          target: deductionPolicy.attendanceStatus,
          set: { deducts: input.deducts },
        }),
    ],
    result: input,
  };
};

export const setDeductionPolicy = async (
  d1: D1Database,
  principal: Principal,
  input: DeductionPolicySetInput,
): Promise<DeductionPolicy> => executeMutationPlan(
  d1,
  await prepareSetDeductionPolicy(d1, principal, input),
);

export const prepareCreateLedgerAdjustment = async (
  d1: D1Database,
  principal: Principal,
  input: LedgerAdjustmentCreateInput,
): Promise<MutationPlan<CreditLedgerEntry>> => {
  if (input.delta === 0) fail("invalid_adjustment");
  if (input.reason.trim().length === 0) fail("adjustment_reason_required");
  const db = drizzle(d1);
  const [student] = await db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.id, input.studentId));
  if (student === undefined) fail("person_not_found", 404);
  const row: LedgerRow = {
    id: crypto.randomUUID(),
    studentId: input.studentId,
    entitlementId: null,
    delta: input.delta,
    kind: "adjustment",
    lessonId: null,
    reason: input.reason.trim(),
    createdBy: principal.id,
    createdAt: new Date(Math.floor(Date.now() / 1_000) * 1_000),
  };
  return {
    statements: [db.insert(creditLedger).values(row)],
    result: serializeLedger(row),
  };
};

export const createLedgerAdjustment = async (
  d1: D1Database,
  principal: Principal,
  input: LedgerAdjustmentCreateInput,
): Promise<CreditLedgerEntry> => executeMutationPlan(
  d1,
  await prepareCreateLedgerAdjustment(d1, principal, input),
);

export const listLedger = async (
  d1: D1Database,
  _principal: Principal,
  input: LedgerListInput,
): Promise<LedgerListOutput> => {
  const db = drizzle(d1);
  const where = and(
    input.studentId === undefined ? undefined : eq(creditLedger.studentId, input.studentId),
    input.kind === undefined ? undefined : eq(creditLedger.kind, input.kind),
  );
  const [totalRow] = await db.select({ value: count() }).from(creditLedger).where(where);
  const rows = await db
    .select(ledgerColumns)
    .from(creditLedger)
    .where(where)
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  return {
    entries: rows.map(serializeLedger),
    total: totalRow?.value ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
};
