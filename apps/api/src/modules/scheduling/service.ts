import type {
  Availability,
  AvailabilityException,
  AvailabilityExceptionSetInput,
  AvailabilityGetInput,
  AvailabilitySetInput,
  ClosureDay,
  ClosureDaysListInput,
  ClosureDaysListOutput,
  ClosureDaysSetInput,
  Enrollment,
  EnrollmentsAddInput,
  EnrollmentsRemoveInput,
  EnrollmentsRemoveOutput,
  FreeSlot,
  FreeSlotsFindInput,
  FreeSlotsFindOutput,
  Lesson,
  LessonBulkSpec,
  LessonMutationOutput,
  LessonsBulkApplyInput,
  LessonsBulkApplyOutput,
  LessonsCancelInput,
  LessonsCreateInput,
  LessonsCreateOutput,
  LessonsGetInput,
  LessonsListInput,
  LessonsListOutput,
  LessonsMoveInput,
  MessageDraft,
  Term,
  TermsCreateInput,
  TermsListInput,
  TermsListOutput,
} from "@h2class/shared";
import { and, asc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import type { Principal } from "../../auth/types";
import { executeMutationPlan, type MutationPlan } from "../../db/mutation-plan";
import {
  attendance,
  availabilityException,
  classType,
  closureDay,
  enrollment,
  guardianStudent,
  lesson,
  messageDraft,
  person,
  personRole,
  teacherAvailability,
  term,
} from "../../db/schema";
import {
  addShanghaiLocalDays,
  compareShanghaiLocalDates,
  formatShanghaiDateTime,
  shanghaiLocalDateTimeToUtcDate,
  shanghaiLocalWeekday,
} from "../../time/asia-shanghai";

type Database = ReturnType<typeof drizzle>;
type SchedulingErrorCode =
  | "attendance_history_locked"
  | "attendance_roster_locked"
  | "class_full"
  | "class_type_not_found"
  | "duplicate_student"
  | "duplicate_availability_slot"
  | "enrollment_exists"
  | "enrollment_not_found"
  | "forbidden"
  | "invalid_availability_exception"
  | "invalid_date_range"
  | "invalid_lesson_request"
  | "invalid_time_range"
  | "lesson_not_found"
  | "lesson_not_scheduled"
  | "no_lesson_dates"
  | "person_not_found"
  | "student_conflict"
  | "teacher_conflict"
  | "teacher_role_required"
  | "term_not_found";

export type SchedulingServiceError = {
  kind: "scheduling_service_error";
  code: SchedulingErrorCode;
  status: 400 | 403 | 404 | 409;
};

const fail = (
  code: SchedulingErrorCode,
  status: SchedulingServiceError["status"] = 400,
): never => {
  throw {
    kind: "scheduling_service_error",
    status,
    code,
  } satisfies SchedulingServiceError;
};

export const isSchedulingServiceError = (
  error: unknown,
): error is SchedulingServiceError => {
  if (typeof error !== "object" || error === null) return false;
  return Reflect.get(error, "kind") === "scheduling_service_error";
};

const requireTeacher = async (db: Database, teacherId: string) => {
  const [row] = await db
    .select({ teacherId: personRole.personId })
    .from(personRole)
    .where(
      and(
        eq(personRole.personId, teacherId),
        eq(personRole.role, "teacher"),
      ),
    );
  if (row === undefined) fail("teacher_role_required");
};

const scopedTeacherId = async (
  db: Database,
  principal: Principal,
): Promise<string | null> => {
  if (
    principal.roles.some((role) =>
      ["admin", "staff", "agent"].includes(role),
    )
  ) {
    return null;
  }
  if (!principal.roles.includes("teacher")) return fail("forbidden", 403);
  const [teacher] = await db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.authUserId, principal.id));
  if (teacher === undefined) return fail("forbidden", 403);
  return teacher.id;
};

const requireTeacherScope = async (
  db: Database,
  principal: Principal,
  requestedTeacherId: string,
) => {
  const teacherId = await scopedTeacherId(db, principal);
  if (teacherId !== null && teacherId !== requestedTeacherId) {
    fail("forbidden", 403);
  }
};

const validateSlots = (input: AvailabilitySetInput) => {
  const seen = new Set<string>();
  for (const slot of input.slots) {
    if (slot.startMin >= slot.endMin) fail("invalid_time_range");
    const key = `${slot.weekday}:${slot.startMin}:${slot.endMin}`;
    if (seen.has(key)) fail("duplicate_availability_slot");
    seen.add(key);
  }
};

const loadAvailability = async (
  db: Database,
  teacherId: string,
): Promise<Availability> => {
  const slots = await db
    .select({
      weekday: teacherAvailability.weekday,
      startMin: teacherAvailability.startMin,
      endMin: teacherAvailability.endMin,
    })
    .from(teacherAvailability)
    .where(eq(teacherAvailability.teacherId, teacherId))
    .orderBy(
      teacherAvailability.weekday,
      teacherAvailability.startMin,
      teacherAvailability.endMin,
    );
  const exceptions = await db
    .select({
      teacherId: availabilityException.teacherId,
      date: availabilityException.date,
      available: availabilityException.available,
      startMin: availabilityException.startMin,
      endMin: availabilityException.endMin,
    })
    .from(availabilityException)
    .where(eq(availabilityException.teacherId, teacherId))
    .orderBy(
      availabilityException.date,
      availabilityException.startMin,
      availabilityException.endMin,
    );
  return { teacherId, slots, exceptions };
};

export const setAvailability = async (
  d1: D1Database,
  _principal: Principal,
  input: AvailabilitySetInput,
): Promise<Availability> => {
  const db = drizzle(d1);
  await requireTeacher(db, input.teacherId);
  validateSlots(input);

  await db.batch([
    db
      .delete(teacherAvailability)
      .where(eq(teacherAvailability.teacherId, input.teacherId)),
    ...input.slots.map((slot) =>
      db.insert(teacherAvailability).values({
        teacherId: input.teacherId,
        ...slot,
      }),
    ),
  ]);
  return loadAvailability(db, input.teacherId);
};

export const getAvailability = async (
  d1: D1Database,
  principal: Principal,
  input: AvailabilityGetInput,
): Promise<Availability> => {
  const db = drizzle(d1);
  await requireTeacherScope(db, principal, input.teacherId);
  await requireTeacher(db, input.teacherId);
  return loadAvailability(db, input.teacherId);
};

export const setAvailabilityException = async (
  d1: D1Database,
  _principal: Principal,
  input: AvailabilityExceptionSetInput,
): Promise<AvailabilityException> => {
  const db = drizzle(d1);
  await requireTeacher(db, input.teacherId);
  const hasStart = input.startMin !== undefined;
  const hasEnd = input.endMin !== undefined;
  if (hasStart !== hasEnd) fail("invalid_availability_exception");
  if (
    input.startMin !== undefined &&
    input.endMin !== undefined &&
    input.startMin >= input.endMin
  ) {
    fail("invalid_time_range");
  }

  const values = {
    teacherId: input.teacherId,
    date: input.date,
    available: input.available,
    startMin: input.startMin ?? null,
    endMin: input.endMin ?? null,
  };
  await db
    .insert(availabilityException)
    .values(values)
    .onConflictDoUpdate({
      target: [availabilityException.teacherId, availabilityException.date],
      set: {
        available: values.available,
        startMin: values.startMin,
        endMin: values.endMin,
      },
    });
  return values;
};

export const setClosureDay = async (
  d1: D1Database,
  _principal: Principal,
  input: ClosureDaysSetInput,
): Promise<ClosureDay> => {
  const db = drizzle(d1);
  await db
    .insert(closureDay)
    .values(input)
    .onConflictDoUpdate({
      target: closureDay.date,
      set: { reason: input.reason },
    });
  return input;
};

export const listClosureDays = async (
  d1: D1Database,
  _principal: Principal,
  _input: ClosureDaysListInput,
): Promise<ClosureDaysListOutput> => ({
  closureDays: await drizzle(d1)
    .select({ date: closureDay.date, reason: closureDay.reason })
    .from(closureDay)
    .orderBy(closureDay.date),
});

export const createTerm = async (
  d1: D1Database,
  _principal: Principal,
  input: TermsCreateInput,
): Promise<Term> => {
  if (compareShanghaiLocalDates(input.startDate, input.endDate) > 0) {
    fail("invalid_date_range");
  }
  const result: Term = { id: crypto.randomUUID(), ...input };
  await drizzle(d1).insert(term).values(result);
  return result;
};

export const listTerms = async (
  d1: D1Database,
  _principal: Principal,
  _input: TermsListInput,
): Promise<TermsListOutput> => ({
  terms: await drizzle(d1)
    .select({
      id: term.id,
      name: term.name,
      startDate: term.startDate,
      endDate: term.endDate,
    })
    .from(term)
    .orderBy(asc(term.startDate), asc(term.endDate), asc(term.name), asc(term.id)),
});

const lessonColumns = {
  id: lesson.id,
  classTypeId: lesson.classTypeId,
  teacherId: lesson.teacherId,
  startAt: lesson.startAt,
  endAt: lesson.endAt,
  status: lesson.status,
  makeupForLessonId: lesson.makeupForLessonId,
  termId: lesson.termId,
  createdAt: lesson.createdAt,
};

type LessonRow = {
  id: string;
  classTypeId: string;
  teacherId: string;
  startAt: Date;
  endAt: Date;
  status: "scheduled" | "completed" | "cancelled";
  makeupForLessonId: string | null;
  termId: string | null;
  createdAt: Date;
};

type LessonCandidate = {
  id: string;
  date: string;
  startAt: Date;
  endAt: Date;
};

type DraftRecord = {
  output: MessageDraft;
  values: typeof messageDraft.$inferInsert;
};

type NotificationContext = {
  classTypeName: string;
  teacherId: string;
  teacherName: string;
  students: Array<{
    id: string;
    name: string;
    guardianIds: string[];
  }>;
};

type Interval = { startMin: number; endMin: number };

const serializeLesson = (row: LessonRow, studentIds: string[]): Lesson => ({
  ...row,
  startAt: row.startAt.toISOString(),
  endAt: row.endAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  studentIds,
});

const loadLessonRow = async (db: Database, id: string): Promise<LessonRow> => {
  const [row] = await db
    .select(lessonColumns)
    .from(lesson)
    .where(eq(lesson.id, id));
  if (row === undefined) return fail("lesson_not_found", 404);
  return row;
};

const loadStudentIds = async (db: Database, lessonId: string) =>
  (
    await db
      .select({ studentId: enrollment.studentId })
      .from(enrollment)
      .where(eq(enrollment.lessonId, lessonId))
      .orderBy(enrollment.studentId)
  ).map(({ studentId }) => studentId);

const loadEnrollmentMap = async (db: Database, lessonIds: string[]) => {
  const result = new Map<string, string[]>();
  if (lessonIds.length === 0) return result;
  const rows = await db
    .select({ lessonId: enrollment.lessonId, studentId: enrollment.studentId })
    .from(enrollment)
    .where(inArray(enrollment.lessonId, lessonIds))
    .orderBy(enrollment.lessonId, enrollment.studentId);
  for (const row of rows) {
    const studentIds = result.get(row.lessonId) ?? [];
    studentIds.push(row.studentId);
    result.set(row.lessonId, studentIds);
  }
  return result;
};

const guardianStudentScope = async (
  db: Database,
  principal: Principal,
): Promise<Set<string> | null> => {
  const unrestricted = principal.roles.some((role) =>
    ["admin", "staff", "agent"].includes(role),
  );
  if (unrestricted || !principal.roles.includes("guardian")) return null;
  const [guardian] = await db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.authUserId, principal.id));
  if (guardian === undefined) return fail("forbidden", 403);
  const links = await db
    .select({ studentId: guardianStudent.studentId })
    .from(guardianStudent)
    .where(eq(guardianStudent.guardianId, guardian.id));
  return new Set(links.map(({ studentId }) => studentId));
};

const loadClassContext = async (db: Database, id: string) => {
  const [row] = await db
    .select({
      id: classType.id,
      name: classType.name,
      capacity: classType.capacity,
      durationMin: classType.durationMin,
    })
    .from(classType)
    .where(eq(classType.id, id));
  if (row === undefined) return fail("class_type_not_found", 404);
  return row;
};

const loadTermBounds = async (db: Database, id: string) => {
  const [row] = await db
    .select({ id: term.id, startDate: term.startDate, endDate: term.endDate })
    .from(term)
    .where(eq(term.id, id));
  if (row === undefined) return fail("term_not_found", 404);
  return row;
};

const ensurePeopleExist = async (db: Database, personIds: string[]) => {
  const uniqueIds = [...new Set(personIds)];
  const rows = await db
    .select({ id: person.id })
    .from(person)
    .where(inArray(person.id, uniqueIds));
  if (rows.length !== uniqueIds.length) fail("person_not_found", 404);
};

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
    values: {
      id,
      personId,
      purpose,
      text,
      status: "draft",
      createdAt,
      sentAt: null,
    },
  };
};

const loadNotificationContext = async (
  db: Database,
  classTypeId: string,
  teacherId: string,
  studentIds: string[],
): Promise<NotificationContext> => {
  const classContext = await loadClassContext(db, classTypeId);
  const peopleRows = await db
    .select({ id: person.id, name: person.name })
    .from(person)
    .where(inArray(person.id, [teacherId, ...studentIds]));
  const names = new Map(peopleRows.map((row) => [row.id, row.name]));
  const teacherName = names.get(teacherId);
  if (teacherName === undefined) return fail("person_not_found", 404);

  const guardianRows =
    studentIds.length === 0
      ? []
      : await db
          .select({
            studentId: guardianStudent.studentId,
            guardianId: guardianStudent.guardianId,
          })
          .from(guardianStudent)
          .where(inArray(guardianStudent.studentId, studentIds));
  const guardianIdsByStudent = new Map<string, string[]>();
  for (const row of guardianRows) {
    const guardianIds = guardianIdsByStudent.get(row.studentId) ?? [];
    guardianIds.push(row.guardianId);
    guardianIdsByStudent.set(row.studentId, guardianIds);
  }

  return {
    classTypeName: classContext.name,
    teacherId,
    teacherName,
    students: studentIds.map((id) => ({
      id,
      name: names.get(id) ?? "未命名学生",
      guardianIds: guardianIdsByStudent.get(id) ?? [],
    })),
  };
};

const lessonTimeText = (startAt: Date, endAt: Date) =>
  `${formatShanghaiDateTime(startAt)}—${formatShanghaiDateTime(endAt)}`;

const createBookedDrafts = (
  context: NotificationContext,
  startAt: Date,
  endAt: Date,
  createdAt: Date,
) => {
  const time = lessonTimeText(startAt, endAt);
  const studentNames = context.students.map(({ name }) => name).join("、");
  const drafts = [
    createDraftRecord(
      context.teacherId,
      "lesson_created_teacher",
      `已安排课程：${studentNames}，${context.classTypeName}，${time}。`,
      createdAt,
    ),
  ];
  for (const student of context.students) {
    for (const guardianId of student.guardianIds) {
      drafts.push(
        createDraftRecord(
          guardianId,
          "lesson_created_guardian",
          `${student.name}已安排${context.classTypeName}课程：${time}，授课老师：${context.teacherName}。`,
          createdAt,
        ),
      );
    }
  }
  return drafts;
};

const createMovedDrafts = (
  context: NotificationContext,
  oldStartAt: Date,
  oldEndAt: Date,
  newStartAt: Date,
  newEndAt: Date,
  createdAt: Date,
) => {
  const oldTime = lessonTimeText(oldStartAt, oldEndAt);
  const newTime = lessonTimeText(newStartAt, newEndAt);
  const studentNames = context.students.map(({ name }) => name).join("、");
  const drafts = [
    createDraftRecord(
      context.teacherId,
      "lesson_moved_teacher",
      `课程时间已调整：${studentNames}，${context.classTypeName}，${oldTime} → ${newTime}。`,
      createdAt,
    ),
  ];
  for (const student of context.students) {
    for (const guardianId of student.guardianIds) {
      drafts.push(
        createDraftRecord(
          guardianId,
          "lesson_moved_guardian",
          `${student.name}的${context.classTypeName}课程时间已调整：${oldTime} → ${newTime}，授课老师：${context.teacherName}。`,
          createdAt,
        ),
      );
    }
  }
  return drafts;
};

const createCancelledDrafts = (
  context: NotificationContext,
  startAt: Date,
  endAt: Date,
  reason: string | undefined,
  createdAt: Date,
) => {
  const time = lessonTimeText(startAt, endAt);
  const reasonText = reason === undefined ? "" : `，原因：${reason}`;
  const studentNames = context.students.map(({ name }) => name).join("、");
  const drafts = [
    createDraftRecord(
      context.teacherId,
      "lesson_cancelled_teacher",
      `课程已取消：${studentNames}，${context.classTypeName}，${time}${reasonText}。`,
      createdAt,
    ),
  ];
  for (const student of context.students) {
    for (const guardianId of student.guardianIds) {
      drafts.push(
        createDraftRecord(
          guardianId,
          "lesson_cancelled_guardian",
          `${student.name}的${context.classTypeName}课程已取消：${time}${reasonText}。`,
          createdAt,
        ),
      );
    }
  }
  return drafts;
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

const writeFailure = (error: unknown): never => {
  const message = errorText(error);
  if (
    message.includes("teacher_conflict") ||
    message.includes("lesson_teacher_start_unique") ||
    message.includes("lesson.teacher_id, lesson.start_at")
  ) {
    fail("teacher_conflict");
  }
  if (message.includes("student_conflict")) fail("student_conflict");
  if (message.includes("class_full")) fail("class_full");
  if (message.includes("attendance_roster_locked")) {
    fail("attendance_roster_locked", 409);
  }
  if (message.includes("attendance_history_locked")) {
    fail("attendance_history_locked", 409);
  }
  if (
    message.includes("enrollment_lesson_student_unique") ||
    message.includes("enrollment.lesson_id, enrollment.student_id")
  ) {
    fail("enrollment_exists", 409);
  }
  throw error;
};

const overlaps = (
  left: { startAt: Date; endAt: Date },
  right: { startAt: Date; endAt: Date },
) => left.startAt < right.endAt && left.endAt > right.startAt;

const assertRosterMutable = async (db: Database, lessonId: string) => {
  const [recorded] = await db
    .select({ lessonId: attendance.lessonId })
    .from(attendance)
    .where(eq(attendance.lessonId, lessonId))
    .limit(1);
  if (recorded !== undefined) fail("attendance_roster_locked", 409);
};

const assertLessonHistoryMutable = async (db: Database, lessonId: string) => {
  const [recorded] = await db
    .select({ lessonId: attendance.lessonId })
    .from(attendance)
    .where(eq(attendance.lessonId, lessonId))
    .limit(1);
  if (recorded !== undefined) fail("attendance_history_locked", 409);
};

const assertNoConflicts = async (
  db: Database,
  teacherId: string,
  studentIds: string[],
  candidates: LessonCandidate[],
  excludedLessonId?: string,
) => {
  const first = candidates[0];
  if (first === undefined) return;
  const rangeStart = new Date(
    Math.min(...candidates.map(({ startAt }) => startAt.getTime())),
  );
  const rangeEnd = new Date(
    Math.max(...candidates.map(({ endAt }) => endAt.getTime())),
  );
  const teacherRows = await db
    .select({ id: lesson.id, startAt: lesson.startAt, endAt: lesson.endAt })
    .from(lesson)
    .where(
      and(
        eq(lesson.teacherId, teacherId),
        ne(lesson.status, "cancelled"),
        lt(lesson.startAt, rangeEnd),
        gt(lesson.endAt, rangeStart),
        excludedLessonId === undefined
          ? undefined
          : ne(lesson.id, excludedLessonId),
      ),
    );
  if (teacherRows.some((row) => candidates.some((item) => overlaps(row, item)))) {
    fail("teacher_conflict");
  }

  if (studentIds.length === 0) return;
  const studentRows = await db
    .select({
      lessonId: lesson.id,
      studentId: enrollment.studentId,
      startAt: lesson.startAt,
      endAt: lesson.endAt,
    })
    .from(enrollment)
    .innerJoin(lesson, eq(lesson.id, enrollment.lessonId))
    .where(
      and(
        inArray(enrollment.studentId, studentIds),
        ne(lesson.status, "cancelled"),
        lt(lesson.startAt, rangeEnd),
        gt(lesson.endAt, rangeStart),
        excludedLessonId === undefined
          ? undefined
          : ne(lesson.id, excludedLessonId),
      ),
    );
  if (studentRows.some((row) => candidates.some((item) => overlaps(row, item)))) {
    fail("student_conflict");
  }
};

const recurringDates = async (
  db: Database,
  termId: string,
  weekday: number,
) => {
  const bounds = await loadTermBounds(db, termId);
  const closureRows = await db
    .select({ date: closureDay.date })
    .from(closureDay);
  const closures = new Set(closureRows.map(({ date }) => date));
  const dates: string[] = [];
  for (
    let date = bounds.startDate;
    compareShanghaiLocalDates(date, bounds.endDate) <= 0;
    date = addShanghaiLocalDays(date, 1)
  ) {
    if (shanghaiLocalWeekday(date) === weekday && !closures.has(date)) {
      dates.push(date);
    }
  }
  if (dates.length === 0) fail("no_lesson_dates");
  return dates;
};

export const createLessons = async (
  d1: D1Database,
  _principal: Principal,
  input: LessonsCreateInput,
): Promise<LessonsCreateOutput> => {
  const db = drizzle(d1);
  const classContext = await loadClassContext(db, input.classTypeId);
  await requireTeacher(db, input.teacherId);
  const studentIds = [...new Set(input.studentIds)];
  if (studentIds.length !== input.studentIds.length) fail("duplicate_student");
  if (studentIds.length > classContext.capacity) fail("class_full");
  await ensurePeopleExist(db, studentIds);

  let dates: string[];
  if (input.mode === "recurring") {
    if (
      input.termId === undefined ||
      input.weekday === undefined ||
      input.date !== undefined ||
      input.makeupForLessonId !== undefined
    ) {
      return fail("invalid_lesson_request");
    }
    dates = await recurringDates(db, input.termId, input.weekday);
  } else {
    if (input.date === undefined || input.weekday !== undefined) {
      return fail("invalid_lesson_request");
    }
    dates = [input.date];
    if (input.termId !== undefined) {
      const bounds = await loadTermBounds(db, input.termId);
      if (
        compareShanghaiLocalDates(input.date, bounds.startDate) < 0 ||
        compareShanghaiLocalDates(input.date, bounds.endDate) > 0
      ) {
        fail("invalid_date_range");
      }
    }
    if (input.makeupForLessonId !== undefined) {
      await loadLessonRow(db, input.makeupForLessonId);
    }
  }
  if (input.startMin + classContext.durationMin > 1440) {
    fail("invalid_time_range");
  }

  const createdAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const candidates = dates.map((date): LessonCandidate => ({
    id: crypto.randomUUID(),
    date,
    startAt: shanghaiLocalDateTimeToUtcDate(date, input.startMin),
    endAt: shanghaiLocalDateTimeToUtcDate(
      date,
      input.startMin + classContext.durationMin,
    ),
  }));
  await assertNoConflicts(
    db,
    input.teacherId,
    studentIds,
    candidates,
  );

  const context = await loadNotificationContext(
    db,
    input.classTypeId,
    input.teacherId,
    studentIds,
  );
  const drafts = candidates.flatMap((candidate) =>
    createBookedDrafts(context, candidate.startAt, candidate.endAt, createdAt),
  );
  const lessonRows: Array<typeof lesson.$inferInsert> = candidates.map(
    (candidate) => ({
      id: candidate.id,
      classTypeId: input.classTypeId,
      teacherId: input.teacherId,
      startAt: candidate.startAt,
      endAt: candidate.endAt,
      status: "scheduled",
      makeupForLessonId:
        input.mode === "single" ? (input.makeupForLessonId ?? null) : null,
      termId: input.termId ?? null,
      createdAt,
    }),
  );
  const enrollmentRows: Array<typeof enrollment.$inferInsert> =
    candidates.flatMap((candidate) =>
      studentIds.map((studentId) => ({ lessonId: candidate.id, studentId })),
    );

  try {
    await db.batch([
      db.insert(lesson).values(lessonRows),
      db.insert(enrollment).values(enrollmentRows),
      db.insert(messageDraft).values(drafts.map(({ values }) => values)),
    ]);
  } catch (error) {
    writeFailure(error);
  }

  return {
    lessons: candidates.map((candidate) =>
      serializeLesson(
        {
          id: candidate.id,
          classTypeId: input.classTypeId,
          teacherId: input.teacherId,
          startAt: candidate.startAt,
          endAt: candidate.endAt,
          status: "scheduled",
          makeupForLessonId:
            input.mode === "single" ? (input.makeupForLessonId ?? null) : null,
          termId: input.termId ?? null,
          createdAt,
        },
        studentIds,
      ),
    ),
    drafts: drafts.map(({ output }) => output),
  };
};

type PreparedBulkLesson = {
  input: LessonBulkSpec;
  candidate: LessonCandidate;
  studentIds: string[];
  context: NotificationContext;
};

const chunked = <Value>(values: Value[], size: number) => {
  const result: Value[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
};

const validateBulkSpec = async (
  db: Database,
  input: LessonBulkSpec,
): Promise<PreparedBulkLesson> => {
  const classContext = await loadClassContext(db, input.classTypeId);
  await requireTeacher(db, input.teacherId);
  const studentIds = [...new Set(input.studentIds)];
  if (studentIds.length !== input.studentIds.length) fail("duplicate_student");
  if (studentIds.length > classContext.capacity) fail("class_full");
  await ensurePeopleExist(db, studentIds);
  if (input.termId !== undefined) {
    const bounds = await loadTermBounds(db, input.termId);
    if (
      compareShanghaiLocalDates(input.date, bounds.startDate) < 0 ||
      compareShanghaiLocalDates(input.date, bounds.endDate) > 0
    ) {
      fail("invalid_date_range");
    }
  }
  if (input.makeupForLessonId !== undefined) {
    await loadLessonRow(db, input.makeupForLessonId);
  }
  if (input.startMin + classContext.durationMin > 1440) {
    fail("invalid_time_range");
  }
  const candidate: LessonCandidate = {
    id: crypto.randomUUID(),
    date: input.date,
    startAt: shanghaiLocalDateTimeToUtcDate(input.date, input.startMin),
    endAt: shanghaiLocalDateTimeToUtcDate(
      input.date,
      input.startMin + classContext.durationMin,
    ),
  };
  await assertNoConflicts(db, input.teacherId, studentIds, [candidate]);
  return {
    input,
    candidate,
    studentIds,
    context: await loadNotificationContext(
      db,
      input.classTypeId,
      input.teacherId,
      studentIds,
    ),
  };
};

const assertBulkInternalConflicts = (items: PreparedBulkLesson[]) => {
  for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
    const left = items[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
      const right = items[rightIndex];
      if (right === undefined || !overlaps(left.candidate, right.candidate)) {
        continue;
      }
      if (left.input.teacherId === right.input.teacherId) {
        fail("teacher_conflict");
      }
      if (
        left.studentIds.some((studentId) => right.studentIds.includes(studentId))
      ) {
        fail("student_conflict");
      }
    }
  }
};

export const prepareBulkApplyLessons = async (
  d1: D1Database,
  _principal: Principal,
  input: LessonsBulkApplyInput,
): Promise<MutationPlan<LessonsBulkApplyOutput>> => {
  const db = drizzle(d1);
  const createdAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const prepared: PreparedBulkLesson[] = [];
  for (const spec of input.lessons) {
    prepared.push(await validateBulkSpec(db, spec));
  }
  assertBulkInternalConflicts(prepared);

  const lessonRows: Array<typeof lesson.$inferInsert> = prepared.map(
    ({ input: spec, candidate }) => ({
      id: candidate.id,
      classTypeId: spec.classTypeId,
      teacherId: spec.teacherId,
      startAt: candidate.startAt,
      endAt: candidate.endAt,
      status: "scheduled",
      makeupForLessonId: spec.makeupForLessonId ?? null,
      termId: spec.termId ?? null,
      createdAt,
    }),
  );
  const enrollmentRows: Array<typeof enrollment.$inferInsert> = prepared.flatMap(
    ({ candidate, studentIds }) =>
      studentIds.map((studentId) => ({ lessonId: candidate.id, studentId })),
  );
  const drafts = prepared.flatMap(({ candidate, context }) =>
    createBookedDrafts(context, candidate.startAt, candidate.endAt, createdAt),
  );
  const statements: BatchItem<"sqlite">[] = [
    ...chunked(lessonRows, 8).map((rows) => db.insert(lesson).values(rows)),
    ...chunked(enrollmentRows, 40).map((rows) =>
      db.insert(enrollment).values(rows),
    ),
    ...chunked(drafts.map(({ values }) => values), 10).map((rows) =>
      db.insert(messageDraft).values(rows),
    ),
  ];
  const firstStatement = statements[0];
  if (firstStatement === undefined) {
    throw new Error("Validated bulk lesson plan unexpectedly had no statements");
  }
  return {
    statements: [firstStatement, ...statements.slice(1)],
    result: {
      lessons: prepared.map(({ input: spec, candidate, studentIds }) =>
        serializeLesson(
          {
            id: candidate.id,
            classTypeId: spec.classTypeId,
            teacherId: spec.teacherId,
            startAt: candidate.startAt,
            endAt: candidate.endAt,
            status: "scheduled",
            makeupForLessonId: spec.makeupForLessonId ?? null,
            termId: spec.termId ?? null,
            createdAt,
          },
          studentIds,
        ),
      ),
      drafts: drafts.map(({ output }) => output),
    },
    mapError: writeFailure,
  };
};

export const bulkApplyLessons = async (
  d1: D1Database,
  principal: Principal,
  input: LessonsBulkApplyInput,
): Promise<LessonsBulkApplyOutput> =>
  executeMutationPlan(
    d1,
    await prepareBulkApplyLessons(d1, principal, input),
  );

export const getLesson = async (
  d1: D1Database,
  principal: Principal,
  input: LessonsGetInput,
): Promise<Lesson> => {
  const db = drizzle(d1);
  const row = await loadLessonRow(db, input.id);
  await requireTeacherScope(db, principal, row.teacherId);
  const studentIds = await loadStudentIds(db, row.id);
  const guardianScope = await guardianStudentScope(db, principal);
  if (
    guardianScope !== null &&
    !studentIds.some((studentId) => guardianScope.has(studentId))
  ) {
    return fail("forbidden", 403);
  }
  return serializeLesson(row, studentIds);
};

export const listLessons = async (
  d1: D1Database,
  principal: Principal,
  input: LessonsListInput,
): Promise<LessonsListOutput> => {
  const rangeStart = new Date(input.startAt);
  const rangeEnd = new Date(input.endAt);
  if (rangeStart >= rangeEnd) fail("invalid_date_range");
  const db = drizzle(d1);
  const teacherScope = await scopedTeacherId(db, principal);
  if (
    teacherScope !== null &&
    input.teacherId !== undefined &&
    input.teacherId !== teacherScope
  ) {
    fail("forbidden", 403);
  }
  const guardianScope = await guardianStudentScope(db, principal);
  if (
    guardianScope !== null &&
    input.studentId !== undefined &&
    !guardianScope.has(input.studentId)
  ) {
    return fail("forbidden", 403);
  }
  const effectiveTeacherId = teacherScope ?? input.teacherId;
  const filters = and(
    lt(lesson.startAt, rangeEnd),
    gt(lesson.endAt, rangeStart),
    effectiveTeacherId === undefined
      ? undefined
      : eq(lesson.teacherId, effectiveTeacherId),
  );
  const rows =
    input.studentId === undefined
      ? await db
          .select(lessonColumns)
          .from(lesson)
          .where(filters)
          .orderBy(lesson.startAt, lesson.id)
      : await db
          .select(lessonColumns)
          .from(lesson)
          .innerJoin(enrollment, eq(enrollment.lessonId, lesson.id))
          .where(and(filters, eq(enrollment.studentId, input.studentId)))
          .orderBy(lesson.startAt, lesson.id);
  const enrollmentMap = await loadEnrollmentMap(
    db,
    rows.map(({ id }) => id),
  );
  return {
    lessons: rows
      .map((row) =>
        serializeLesson(row, enrollmentMap.get(row.id) ?? []),
      )
      .filter(
        (row) =>
          guardianScope === null ||
          row.studentIds.some((studentId) => guardianScope.has(studentId)),
      ),
  };
};

export const moveLesson = async (
  d1: D1Database,
  _principal: Principal,
  input: LessonsMoveInput,
): Promise<LessonMutationOutput> => {
  const db = drizzle(d1);
  const existing = await loadLessonRow(db, input.id);
  if (existing.status !== "scheduled") fail("lesson_not_scheduled");
  await assertLessonHistoryMutable(db, existing.id);
  const durationMin = Math.round(
    (existing.endAt.getTime() - existing.startAt.getTime()) / 60_000,
  );
  if (input.startMin + durationMin > 1440) fail("invalid_time_range");
  const studentIds = await loadStudentIds(db, existing.id);
  const candidate: LessonCandidate = {
    id: existing.id,
    date: input.date,
    startAt: shanghaiLocalDateTimeToUtcDate(input.date, input.startMin),
    endAt: shanghaiLocalDateTimeToUtcDate(
      input.date,
      input.startMin + durationMin,
    ),
  };
  await assertNoConflicts(
    db,
    existing.teacherId,
    studentIds,
    [candidate],
    existing.id,
  );
  const context = await loadNotificationContext(
    db,
    existing.classTypeId,
    existing.teacherId,
    studentIds,
  );
  const createdAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const drafts = createMovedDrafts(
    context,
    existing.startAt,
    existing.endAt,
    candidate.startAt,
    candidate.endAt,
    createdAt,
  );
  try {
    await db.batch([
      db
        .update(lesson)
        .set({ startAt: candidate.startAt, endAt: candidate.endAt })
        .where(eq(lesson.id, existing.id)),
      db.insert(messageDraft).values(drafts.map(({ values }) => values)),
    ]);
  } catch (error) {
    writeFailure(error);
  }
  return {
    lesson: serializeLesson(
      { ...existing, startAt: candidate.startAt, endAt: candidate.endAt },
      studentIds,
    ),
    drafts: drafts.map(({ output }) => output),
  };
};

export const cancelLesson = async (
  d1: D1Database,
  _principal: Principal,
  input: LessonsCancelInput,
): Promise<LessonMutationOutput> => {
  const db = drizzle(d1);
  const existing = await loadLessonRow(db, input.id);
  if (existing.status !== "scheduled") fail("lesson_not_scheduled");
  await assertLessonHistoryMutable(db, existing.id);
  const studentIds = await loadStudentIds(db, existing.id);
  const context = await loadNotificationContext(
    db,
    existing.classTypeId,
    existing.teacherId,
    studentIds,
  );
  const createdAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const drafts = createCancelledDrafts(
    context,
    existing.startAt,
    existing.endAt,
    input.reason,
    createdAt,
  );
  try {
    await db.batch([
      db
        .update(lesson)
        .set({ status: "cancelled" })
        .where(eq(lesson.id, existing.id)),
      db.insert(messageDraft).values(drafts.map(({ values }) => values)),
    ]);
  } catch (error) {
    writeFailure(error);
  }
  return {
    lesson: serializeLesson({ ...existing, status: "cancelled" }, studentIds),
    drafts: drafts.map(({ output }) => output),
  };
};

export const addEnrollment = async (
  d1: D1Database,
  _principal: Principal,
  input: EnrollmentsAddInput,
): Promise<Enrollment> => {
  const db = drizzle(d1);
  const lessonRow = await loadLessonRow(db, input.lessonId);
  if (lessonRow.status !== "scheduled") fail("lesson_not_scheduled");
  await assertRosterMutable(db, input.lessonId);
  await ensurePeopleExist(db, [input.studentId]);
  const studentIds = await loadStudentIds(db, input.lessonId);
  if (studentIds.includes(input.studentId)) fail("enrollment_exists", 409);
  const classContext = await loadClassContext(db, lessonRow.classTypeId);
  if (studentIds.length >= classContext.capacity) fail("class_full");
  await assertNoConflicts(
    db,
    lessonRow.teacherId,
    [input.studentId],
    [{
      id: lessonRow.id,
      date: "",
      startAt: lessonRow.startAt,
      endAt: lessonRow.endAt,
    }],
    lessonRow.id,
  );
  try {
    await db.insert(enrollment).values(input);
  } catch (error) {
    writeFailure(error);
  }
  return input;
};

export const removeEnrollment = async (
  d1: D1Database,
  _principal: Principal,
  input: EnrollmentsRemoveInput,
): Promise<EnrollmentsRemoveOutput> => {
  const db = drizzle(d1);
  await assertRosterMutable(db, input.lessonId);
  const removed = await db
      .delete(enrollment)
      .where(
        and(
          eq(enrollment.lessonId, input.lessonId),
          eq(enrollment.studentId, input.studentId),
        ),
      )
      .returning({ lessonId: enrollment.lessonId })
      .catch((error): never => writeFailure(error));
  if (removed.length === 0) fail("enrollment_not_found", 404);
  return { ...input, removed: true };
};

const mergeIntervals = (intervals: Interval[]) => {
  const sorted = [...intervals].sort(
    (left, right) => left.startMin - right.startMin || left.endMin - right.endMin,
  );
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous === undefined || interval.startMin > previous.endMin) {
      merged.push({ ...interval });
    } else {
      previous.endMin = Math.max(previous.endMin, interval.endMin);
    }
  }
  return merged;
};

const subtractIntervals = (available: Interval[], busy: Interval[]) => {
  let remaining = mergeIntervals(available);
  for (const blocked of mergeIntervals(busy)) {
    remaining = remaining.flatMap((slot): Interval[] => {
      if (blocked.endMin <= slot.startMin || blocked.startMin >= slot.endMin) {
        return [slot];
      }
      const pieces: Interval[] = [];
      if (blocked.startMin > slot.startMin) {
        pieces.push({ startMin: slot.startMin, endMin: blocked.startMin });
      }
      if (blocked.endMin < slot.endMin) {
        pieces.push({ startMin: blocked.endMin, endMin: slot.endMin });
      }
      return pieces;
    });
  }
  return remaining;
};

export const findFreeSlots = async (
  d1: D1Database,
  principal: Principal,
  input: FreeSlotsFindInput,
): Promise<FreeSlotsFindOutput> => {
  const db = drizzle(d1);
  await requireTeacherScope(db, principal, input.teacherId);
  await requireTeacher(db, input.teacherId);
  const classContext = await loadClassContext(db, input.classTypeId);
  const [closed] = await db
    .select({ date: closureDay.date })
    .from(closureDay)
    .where(eq(closureDay.date, input.date));
  if (closed !== undefined) return { ...input, slots: [] };

  const weekly = await db
    .select({
      startMin: teacherAvailability.startMin,
      endMin: teacherAvailability.endMin,
    })
    .from(teacherAvailability)
    .where(
      and(
        eq(teacherAvailability.teacherId, input.teacherId),
        eq(teacherAvailability.weekday, shanghaiLocalWeekday(input.date)),
      ),
    );
  const [exception] = await db
    .select({
      available: availabilityException.available,
      startMin: availabilityException.startMin,
      endMin: availabilityException.endMin,
    })
    .from(availabilityException)
    .where(
      and(
        eq(availabilityException.teacherId, input.teacherId),
        eq(availabilityException.date, input.date),
      ),
    );

  let available = mergeIntervals(weekly);
  if (exception !== undefined) {
    if (exception.startMin === null || exception.endMin === null) {
      available = exception.available ? [{ startMin: 0, endMin: 1440 }] : [];
    } else if (exception.available) {
      available = [{ startMin: exception.startMin, endMin: exception.endMin }];
    } else {
      available = subtractIntervals(available, [
        { startMin: exception.startMin, endMin: exception.endMin },
      ]);
    }
  }

  const dayStart = shanghaiLocalDateTimeToUtcDate(input.date, 0);
  const dayEnd = shanghaiLocalDateTimeToUtcDate(input.date, 1440);
  const lessonRows = await db
    .select({ startAt: lesson.startAt, endAt: lesson.endAt })
    .from(lesson)
    .where(
      and(
        eq(lesson.teacherId, input.teacherId),
        ne(lesson.status, "cancelled"),
        lt(lesson.startAt, dayEnd),
        gt(lesson.endAt, dayStart),
      ),
    );
  const busy = lessonRows.map(({ startAt, endAt }) => ({
    startMin: Math.max(
      0,
      Math.floor((startAt.getTime() - dayStart.getTime()) / 60_000),
    ),
    endMin: Math.min(
      1440,
      Math.ceil((endAt.getTime() - dayStart.getTime()) / 60_000),
    ),
  }));
  const slots: FreeSlot[] = subtractIntervals(available, busy)
    .filter(
      ({ startMin, endMin }) =>
        endMin - startMin >= classContext.durationMin,
    )
    .map(({ startMin, endMin }) => ({
      date: input.date,
      startMin,
      endMin,
      startAt: shanghaiLocalDateTimeToUtcDate(
        input.date,
        startMin,
      ).toISOString(),
      endAt: shanghaiLocalDateTimeToUtcDate(
        input.date,
        endMin,
      ).toISOString(),
    }));
  return { ...input, slots };
};
