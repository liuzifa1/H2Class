import type {
  ReportBalanceItem,
  ReportIncomeItem,
  ReportsBalancesInput,
  ReportsBalancesOutput,
  ReportsDailyInput,
  ReportsDailyOutput,
  ReportsIncomeInput,
  ReportsIncomeOutput,
  ReportsTeacherSettlementInput,
  ReportsTeacherSettlementOutput,
  TeacherRate,
  TeacherRatesListInput,
  TeacherRatesListOutput,
  TeacherRatesSetInput,
} from "@h2class/shared";
import { and, asc, count, desc, eq, gt, gte, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Principal } from "../../auth/types";
import { executeMutationPlan, type MutationPlan } from "../../db/mutation-plan";
import {
  attendance,
  classType,
  creditLedger,
  enrollment,
  entitlement,
  guardianStudent,
  lesson,
  messageDraft,
  payment,
  pendingAction,
  person,
  personRole,
  teacherRate,
} from "../../db/schema";
import {
  addShanghaiLocalDays,
  shanghaiLocalDateTimeToUtcDate,
  utcToShanghaiLocalParts,
} from "../../time/asia-shanghai";

type Database = ReturnType<typeof drizzle>;
type ReportsErrorCode =
  | "class_type_not_found"
  | "duplicate_teacher_rate_version"
  | "report_amount_too_large"
  | "teacher_not_found"
  | "teacher_role_required";

export type ReportsServiceError = {
  kind: "reports_service_error";
  code: ReportsErrorCode;
  status: 400 | 404 | 409;
};

const fail = (
  code: ReportsErrorCode,
  status: ReportsServiceError["status"] = 400,
): never => {
  throw { kind: "reports_service_error", code, status } satisfies ReportsServiceError;
};

export const isReportsServiceError = (
  error: unknown,
): error is ReportsServiceError =>
  typeof error === "object" &&
  error !== null &&
  Reflect.get(error, "kind") === "reports_service_error";

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

const rateWriteFailure = (error: unknown): never => {
  const message = errorText(error);
  if (
    message.includes("teacher_rate_version_unique") ||
    message.includes(
      "teacher_rate.teacher_id, teacher_rate.class_type_id, teacher_rate.effective_from",
    )
  ) {
    fail("duplicate_teacher_rate_version", 409);
  }
  if (message.includes("teacher_role_required")) {
    fail("teacher_role_required");
  }
  throw error;
};

const MAX_SAFE_FEN = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_FEN = BigInt(Number.MIN_SAFE_INTEGER);

const exactFen = (value: number) => {
  if (!Number.isSafeInteger(value)) fail("report_amount_too_large", 409);
  return BigInt(value);
};

const safeFen = (value: bigint) => {
  if (value > MAX_SAFE_FEN || value < MIN_SAFE_FEN) {
    fail("report_amount_too_large", 409);
  }
  return Number(value);
};

const monthRange = (month: string) => {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return {
    start: shanghaiLocalDateTimeToUtcDate(`${month}-01`, 0),
    end: shanghaiLocalDateTimeToUtcDate(
      `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
      0,
    ),
  };
};

const loadPerson = async (db: Database, personId: string) => {
  const [row] = await db
    .select({ id: person.id, name: person.name })
    .from(person)
    .where(eq(person.id, personId));
  if (row === undefined) return fail("teacher_not_found", 404);
  return row;
};

const loadTeacher = async (db: Database, teacherId: string) => {
  const teacher = await loadPerson(db, teacherId);
  const [role] = await db
    .select({ personId: personRole.personId })
    .from(personRole)
    .where(
      and(
        eq(personRole.personId, teacherId),
        eq(personRole.role, "teacher"),
      ),
    );
  if (role === undefined) return fail("teacher_role_required");
  return teacher;
};

const loadClassType = async (db: Database, classTypeId: string) => {
  const [row] = await db
    .select({ id: classType.id, name: classType.name })
    .from(classType)
    .where(eq(classType.id, classTypeId));
  if (row === undefined) return fail("class_type_not_found", 404);
  return row;
};

const serializeRate = (row: {
  teacherId: string;
  teacherName: string;
  classTypeId: string;
  classTypeName: string;
  rateFen: number;
  effectiveFrom: Date;
}): TeacherRate => ({
  teacherId: row.teacherId,
  teacherName: row.teacherName,
  classTypeId: row.classTypeId,
  classTypeName: row.classTypeName,
  rate_fen: row.rateFen,
  effectiveFrom: row.effectiveFrom.toISOString(),
});

export const prepareSetTeacherRate = async (
  d1: D1Database,
  _principal: Principal,
  input: TeacherRatesSetInput,
): Promise<MutationPlan<TeacherRate>> => {
  const db = drizzle(d1);
  const teacher = await loadTeacher(db, input.teacherId);
  const classRow = await loadClassType(db, input.classTypeId);
  const effectiveFrom = new Date(input.effectiveFrom);
  return {
    statements: [
      db.insert(teacherRate).values({
        teacherId: input.teacherId,
        classTypeId: input.classTypeId,
        rateFen: input.rate_fen,
        effectiveFrom,
      }),
    ],
    result: {
      teacherId: teacher.id,
      teacherName: teacher.name,
      classTypeId: classRow.id,
      classTypeName: classRow.name,
      rate_fen: input.rate_fen,
      effectiveFrom: effectiveFrom.toISOString(),
    },
    mapError: rateWriteFailure,
  };
};

export const setTeacherRate = async (
  d1: D1Database,
  principal: Principal,
  input: TeacherRatesSetInput,
): Promise<TeacherRate> =>
  executeMutationPlan(
    d1,
    await prepareSetTeacherRate(d1, principal, input),
  );

export const listTeacherRates = async (
  d1: D1Database,
  _principal: Principal,
  input: TeacherRatesListInput,
): Promise<TeacherRatesListOutput> => {
  const rows = await drizzle(d1)
    .select({
      teacherId: teacherRate.teacherId,
      teacherName: person.name,
      classTypeId: teacherRate.classTypeId,
      classTypeName: classType.name,
      rateFen: teacherRate.rateFen,
      effectiveFrom: teacherRate.effectiveFrom,
    })
    .from(teacherRate)
    .innerJoin(person, eq(person.id, teacherRate.teacherId))
    .innerJoin(classType, eq(classType.id, teacherRate.classTypeId))
    .where(
      and(
        input.teacherId === undefined
          ? undefined
          : eq(teacherRate.teacherId, input.teacherId),
        input.classTypeId === undefined
          ? undefined
          : eq(teacherRate.classTypeId, input.classTypeId),
      ),
    )
    .orderBy(
      teacherRate.teacherId,
      teacherRate.classTypeId,
      desc(teacherRate.effectiveFrom),
    );
  return { rates: rows.map(serializeRate) };
};

export const getTeacherSettlement = async (
  d1: D1Database,
  _principal: Principal,
  input: ReportsTeacherSettlementInput,
): Promise<ReportsTeacherSettlementOutput> => {
  const db = drizzle(d1);
  const teacher = await loadPerson(db, input.teacherId);
  const range = monthRange(input.month);
  const attendanceRows = await db
    .select({
      lessonId: lesson.id,
      classTypeId: lesson.classTypeId,
      classTypeName: classType.name,
      startAt: lesson.startAt,
      endAt: lesson.endAt,
    })
    .from(attendance)
    .innerJoin(lesson, eq(lesson.id, attendance.lessonId))
    .innerJoin(classType, eq(classType.id, lesson.classTypeId))
    .where(
      and(
        eq(lesson.teacherId, input.teacherId),
        eq(attendance.status, "present"),
        gte(lesson.startAt, range.start),
        lt(lesson.startAt, range.end),
      ),
    )
    .orderBy(lesson.startAt, lesson.id);
  const attendedLessons = [
    ...new Map(attendanceRows.map((row) => [row.lessonId, row])).values(),
  ];
  const classTypeIds = [...new Set(attendedLessons.map((row) => row.classTypeId))];
  const rateRows = classTypeIds.length === 0
    ? []
    : await db
        .select({
          classTypeId: teacherRate.classTypeId,
          rateFen: teacherRate.rateFen,
          effectiveFrom: teacherRate.effectiveFrom,
        })
        .from(teacherRate)
        .where(
          and(
            eq(teacherRate.teacherId, input.teacherId),
            inArray(teacherRate.classTypeId, classTypeIds),
            lt(teacherRate.effectiveFrom, range.end),
          ),
        )
        .orderBy(teacherRate.classTypeId, asc(teacherRate.effectiveFrom));
  const ratesByClass = new Map<
    string,
    Array<{ rateFen: number; effectiveFrom: Date }>
  >();
  for (const row of rateRows) {
    const rates = ratesByClass.get(row.classTypeId) ?? [];
    rates.push(row);
    ratesByClass.set(row.classTypeId, rates);
  }

  let total = 0n;
  let ratedLessonCount = 0;
  const items = attendedLessons.map((row) => {
    const applicable = (ratesByClass.get(row.classTypeId) ?? [])
      .filter((rate) => rate.effectiveFrom <= row.startAt)
      .at(-1);
    if (applicable === undefined) {
      return {
        lessonId: row.lessonId,
        classTypeId: row.classTypeId,
        classTypeName: row.classTypeName,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
        rate_fen: null,
        rateEffectiveFrom: null,
        rateMissing: true,
      };
    }
    total += exactFen(applicable.rateFen);
    ratedLessonCount += 1;
    return {
      lessonId: row.lessonId,
      classTypeId: row.classTypeId,
      classTypeName: row.classTypeName,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      rate_fen: applicable.rateFen,
      rateEffectiveFrom: applicable.effectiveFrom.toISOString(),
      rateMissing: false,
    };
  });
  return {
    teacherId: teacher.id,
    teacherName: teacher.name,
    month: input.month,
    lessonCount: items.length,
    ratedLessonCount,
    total_fen: safeFen(total),
    incomplete: ratedLessonCount !== items.length,
    items,
  };
};

type IncomeAccumulator = {
  classTypeId: string;
  classTypeName: string;
  transactionCount: number;
  gross: bigint;
  discount: bigint;
  net: bigint;
};

const incomeOutput = (
  month: string,
  rows: Array<{
    classTypeId: string;
    classTypeName: string;
    listAmountFen: number;
    discountFen: number;
    paidAmountFen: number;
  }>,
): ReportsIncomeOutput => {
  const groups = new Map<string, IncomeAccumulator>();
  let gross = 0n;
  let discount = 0n;
  let net = 0n;
  for (const row of rows) {
    const item = groups.get(row.classTypeId) ?? {
      classTypeId: row.classTypeId,
      classTypeName: row.classTypeName,
      transactionCount: 0,
      gross: 0n,
      discount: 0n,
      net: 0n,
    };
    const rowGross = exactFen(row.listAmountFen);
    const rowDiscount = exactFen(row.discountFen);
    const rowNet = exactFen(row.paidAmountFen);
    item.transactionCount += 1;
    item.gross += rowGross;
    item.discount += rowDiscount;
    item.net += rowNet;
    gross += rowGross;
    discount += rowDiscount;
    net += rowNet;
    groups.set(row.classTypeId, item);
  }
  const items: ReportIncomeItem[] = [...groups.values()]
    .sort((left, right) =>
      left.classTypeName === right.classTypeName
        ? left.classTypeId.localeCompare(right.classTypeId)
        : left.classTypeName.localeCompare(right.classTypeName),
    )
    .map((item) => ({
      classTypeId: item.classTypeId,
      classTypeName: item.classTypeName,
      transactionCount: item.transactionCount,
      gross_fen: safeFen(item.gross),
      discount_fen: safeFen(item.discount),
      net_fen: safeFen(item.net),
    }));
  return {
    month,
    items,
    totals: {
      transactionCount: rows.length,
      gross_fen: safeFen(gross),
      discount_fen: safeFen(discount),
      net_fen: safeFen(net),
    },
  };
};

export const getIncomeReport = async (
  d1: D1Database,
  _principal: Principal,
  input: ReportsIncomeInput,
): Promise<ReportsIncomeOutput> => {
  const range = monthRange(input.month);
  const rows = await drizzle(d1)
    .select({
      classTypeId: classType.id,
      classTypeName: classType.name,
      listAmountFen: payment.listAmountFen,
      discountFen: payment.discountFen,
      paidAmountFen: payment.paidAmountFen,
    })
    .from(payment)
    .innerJoin(entitlement, eq(entitlement.id, payment.entitlementId))
    .innerJoin(classType, eq(classType.id, entitlement.classTypeId))
    .where(
      and(
        gte(payment.createdAt, range.start),
        lt(payment.createdAt, range.end),
        input.classTypeId === undefined
          ? undefined
          : eq(classType.id, input.classTypeId),
      ),
    );
  return incomeOutput(input.month, rows);
};

export const getBalancesReport = async (
  d1: D1Database,
  _principal: Principal,
  input: ReportsBalancesInput,
): Promise<ReportsBalancesOutput> => {
  const db = drizzle(d1);
  const requested = input.studentId;
  const filter = <Column extends typeof guardianStudent.studentId>(column: Column) =>
    requested === undefined ? undefined : eq(column, requested);
  const guardianRows = await db
    .select({ studentId: guardianStudent.studentId })
    .from(guardianStudent)
    .where(filter(guardianStudent.studentId));
  const enrollmentRows = await db
    .select({ studentId: enrollment.studentId })
    .from(enrollment)
    .where(
      requested === undefined ? undefined : eq(enrollment.studentId, requested),
    );
  const entitlementRows = await db
    .select({ studentId: entitlement.studentId })
    .from(entitlement)
    .where(
      requested === undefined ? undefined : eq(entitlement.studentId, requested),
    );
  const ledgerStudentRows = await db
    .select({ studentId: creditLedger.studentId })
    .from(creditLedger)
    .where(
      requested === undefined ? undefined : eq(creditLedger.studentId, requested),
    );
  const studentIds = [
    ...new Set(
      [
        ...guardianRows,
        ...enrollmentRows,
        ...entitlementRows,
        ...ledgerStudentRows,
      ].map((row) => row.studentId),
    ),
  ];
  if (studentIds.length === 0) return { balances: [] };

  const peopleRows = await db
    .select({ id: person.id, name: person.name })
    .from(person)
    .where(inArray(person.id, studentIds));
  const ledgerRows = await db
    .select({ studentId: creditLedger.studentId, delta: creditLedger.delta })
    .from(creditLedger)
    .where(inArray(creditLedger.studentId, studentIds));
  const balances = new Map<string, bigint>();
  for (const row of ledgerRows) {
    balances.set(
      row.studentId,
      (balances.get(row.studentId) ?? 0n) + exactFen(row.delta),
    );
  }
  const subscriptionRows = await db
    .select({
      id: entitlement.id,
      studentId: entitlement.studentId,
      classTypeId: classType.id,
      classTypeName: classType.name,
      validFrom: entitlement.validFrom,
      validTo: entitlement.validTo,
      storedStatus: entitlement.status,
    })
    .from(entitlement)
    .innerJoin(classType, eq(classType.id, entitlement.classTypeId))
    .where(
      and(
        inArray(entitlement.studentId, studentIds),
        eq(entitlement.kind, "subscription"),
      ),
    )
    .orderBy(entitlement.studentId, entitlement.validTo, entitlement.id);
  const today = utcToShanghaiLocalParts(new Date()).date;
  const subscriptions = new Map<
    string,
    ReportBalanceItem["subscriptions"]
  >();
  for (const row of subscriptionRows) {
    if (row.validFrom === null || row.validTo === null) continue;
    const values = subscriptions.get(row.studentId) ?? [];
    values.push({
      entitlementId: row.id,
      classTypeId: row.classTypeId,
      classTypeName: row.classTypeName,
      validFrom: row.validFrom,
      validTo: row.validTo,
      status:
        row.storedStatus === "refunded"
          ? "refunded"
          : row.storedStatus === "expired" || row.validTo < today
            ? "expired"
            : "active",
    });
    subscriptions.set(row.studentId, values);
  }
  return {
    balances: peopleRows
      .sort((left, right) =>
        left.name === right.name
          ? left.id.localeCompare(right.id)
          : left.name.localeCompare(right.name),
      )
      .map((row) => ({
        studentId: row.id,
        studentName: row.name,
        remainingCredits: safeFen(balances.get(row.id) ?? 0n),
        subscriptions: subscriptions.get(row.id) ?? [],
      })),
  };
};

export const getDailyReport = async (
  d1: D1Database,
  _principal: Principal,
  _input: ReportsDailyInput,
): Promise<ReportsDailyOutput> => {
  const db = drizzle(d1);
  const now = new Date();
  const date = utcToShanghaiLocalParts(now).date;
  const tomorrow = addShanghaiLocalDays(date, 1);
  const yesterday = addShanghaiLocalDays(date, -1);
  const todayStart = shanghaiLocalDateTimeToUtcDate(date, 0);
  const tomorrowStart = shanghaiLocalDateTimeToUtcDate(tomorrow, 0);
  const yesterdayStart = shanghaiLocalDateTimeToUtcDate(yesterday, 0);
  const lessonRows = await db
    .select({
      id: lesson.id,
      classTypeId: classType.id,
      classTypeName: classType.name,
      teacherId: person.id,
      teacherName: person.name,
      startAt: lesson.startAt,
      endAt: lesson.endAt,
      status: lesson.status,
    })
    .from(lesson)
    .innerJoin(classType, eq(classType.id, lesson.classTypeId))
    .innerJoin(person, eq(person.id, lesson.teacherId))
    .where(
      and(
        gte(lesson.startAt, todayStart),
        lt(lesson.startAt, tomorrowStart),
      ),
    )
    .orderBy(lesson.startAt, lesson.id);
  const lessonIds = lessonRows.map((row) => row.id);
  const studentRows = lessonIds.length === 0
    ? []
    : await db
        .select({
          lessonId: enrollment.lessonId,
          id: person.id,
          name: person.name,
        })
        .from(enrollment)
        .innerJoin(person, eq(person.id, enrollment.studentId))
        .where(inArray(enrollment.lessonId, lessonIds))
        .orderBy(enrollment.lessonId, person.name, person.id);
  const students = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of studentRows) {
    const values = students.get(row.lessonId) ?? [];
    values.push({ id: row.id, name: row.name });
    students.set(row.lessonId, values);
  }
  const yesterdayRows = await db
    .select({
      classTypeId: classType.id,
      classTypeName: classType.name,
      listAmountFen: payment.listAmountFen,
      discountFen: payment.discountFen,
      paidAmountFen: payment.paidAmountFen,
    })
    .from(payment)
    .innerJoin(entitlement, eq(entitlement.id, payment.entitlementId))
    .innerJoin(classType, eq(classType.id, entitlement.classTypeId))
    .where(
      and(
        gte(payment.createdAt, yesterdayStart),
        lt(payment.createdAt, todayStart),
      ),
    );
  const yesterdayIncome = incomeOutput(date.slice(0, 7), yesterdayRows).totals;
  const [draftCount] = await db
    .select({ value: count() })
    .from(messageDraft)
    .where(eq(messageDraft.status, "draft"));
  const [actionCount] = await db
    .select({ value: count() })
    .from(pendingAction)
    .where(
      and(
        eq(pendingAction.status, "pending"),
        gt(pendingAction.expiresAt, now),
      ),
    );
  return {
    date,
    lessons: lessonRows.map((row) => ({
      ...row,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      students: students.get(row.id) ?? [],
    })),
    yesterday: {
      date: yesterday,
      ...yesterdayIncome,
    },
    unsentDraftCount: draftCount?.value ?? 0,
    pendingActionCount: actionCount?.value ?? 0,
  };
};
