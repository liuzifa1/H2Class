import { z } from "zod";

const personIdSchema = z.uuid().describe("Person UUID.");
const teacherIdSchema = personIdSchema.describe("Teacher person UUID.");
const studentIdSchema = personIdSchema.describe("Student person UUID.");
const classTypeIdSchema = z.uuid().describe("Class type UUID.");
const lessonIdSchema = z.uuid().describe("Lesson UUID.");
const entitlementIdSchema = z.uuid().describe("Entitlement UUID.");
const localDateSchema = z
  .iso.date()
  .describe("Asia/Shanghai local calendar date in YYYY-MM-DD form.");
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe("Asia/Shanghai calendar month in YYYY-MM form.");
const moneyFenSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)
  .describe("Signed amount in integer fen; never floating-point currency.");
const nonnegativeMoneyFenSchema = moneyFenSchema
  .nonnegative()
  .describe("Non-negative amount in integer fen; never floating-point currency.");

export const teacherRateSchema = z.object({
  teacherId: teacherIdSchema,
  teacherName: z.string().min(1),
  classTypeId: classTypeIdSchema,
  classTypeName: z.string().min(1),
  rate_fen: nonnegativeMoneyFenSchema.describe(
    "Configured pay for one attended lesson in integer fen.",
  ),
  effectiveFrom: z
    .iso.datetime()
    .describe("UTC instant from which this immutable rate version applies."),
});

export const teacherRatesSetInputSchema = z
  .object({
    teacherId: teacherIdSchema,
    classTypeId: classTypeIdSchema,
    rate_fen: nonnegativeMoneyFenSchema,
    effectiveFrom: z.iso.datetime().describe("UTC effective instant."),
  })
  .strict();

export const teacherRatesListInputSchema = z
  .object({
    teacherId: teacherIdSchema.optional().describe("Optional teacher filter."),
    classTypeId: classTypeIdSchema
      .optional()
      .describe("Optional class-type filter."),
  })
  .strict();

export const teacherRatesListOutputSchema = z.object({
  rates: z.array(teacherRateSchema),
});

export const teacherSettlementItemSchema = z.object({
  lessonId: lessonIdSchema,
  classTypeId: classTypeIdSchema,
  classTypeName: z.string().min(1),
  startAt: z.iso.datetime().describe("Lesson start as a UTC instant."),
  endAt: z.iso.datetime().describe("Lesson end as a UTC instant."),
  rate_fen: nonnegativeMoneyFenSchema
    .nullable()
    .describe("Applicable immutable rate, or null when no rate existed."),
  rateEffectiveFrom: z
    .iso.datetime()
    .nullable()
    .describe("Effective instant of the applied rate version, or null."),
  rateMissing: z
    .boolean()
    .describe("True when no rate version was effective at lesson start."),
});

export const reportsTeacherSettlementInputSchema = z
  .object({
    teacherId: teacherIdSchema,
    month: monthSchema,
  })
  .strict();

export const reportsTeacherSettlementOutputSchema = z.object({
  teacherId: teacherIdSchema,
  teacherName: z.string().min(1),
  month: monthSchema,
  lessonCount: z.number().int().nonnegative(),
  ratedLessonCount: z.number().int().nonnegative(),
  total_fen: nonnegativeMoneyFenSchema.describe(
    "Sum of rated items only; inspect incomplete before using as a final settlement.",
  ),
  incomplete: z
    .boolean()
    .describe("True when at least one attended lesson has no applicable rate."),
  items: z.array(teacherSettlementItemSchema),
});

export const reportIncomeItemSchema = z.object({
  classTypeId: classTypeIdSchema,
  classTypeName: z.string().min(1),
  transactionCount: z.number().int().nonnegative(),
  gross_fen: moneyFenSchema.describe("Signed sum of list amounts."),
  discount_fen: moneyFenSchema.describe("Signed sum of discounts."),
  net_fen: moneyFenSchema.describe("Signed sum of paid amounts."),
});

export const reportsIncomeInputSchema = z
  .object({
    month: monthSchema,
    classTypeId: classTypeIdSchema
      .optional()
      .describe("Optional class-type filter."),
  })
  .strict();

export const reportsIncomeOutputSchema = z.object({
  month: monthSchema,
  items: z.array(reportIncomeItemSchema),
  totals: z.object({
    transactionCount: z.number().int().nonnegative(),
    gross_fen: moneyFenSchema,
    discount_fen: moneyFenSchema,
    net_fen: moneyFenSchema,
  }),
});

export const reportBalanceSubscriptionSchema = z.object({
  entitlementId: entitlementIdSchema,
  classTypeId: classTypeIdSchema,
  classTypeName: z.string().min(1),
  validFrom: localDateSchema,
  validTo: localDateSchema,
  status: z.enum(["active", "expired", "refunded"]),
});

export const reportBalanceItemSchema = z.object({
  studentId: studentIdSchema,
  studentName: z.string().min(1),
  remainingCredits: z
    .number()
    .int()
    .describe("Derived sum of all append-only credit-ledger deltas."),
  subscriptions: z.array(reportBalanceSubscriptionSchema),
});

export const reportsBalancesInputSchema = z
  .object({
    studentId: studentIdSchema.optional().describe("Optional student filter."),
  })
  .strict();

export const reportsBalancesOutputSchema = z.object({
  balances: z.array(reportBalanceItemSchema),
});

export const dailyReportStudentSchema = z.object({
  id: studentIdSchema,
  name: z.string().min(1),
});

export const dailyReportLessonSchema = z.object({
  id: lessonIdSchema,
  classTypeId: classTypeIdSchema,
  classTypeName: z.string().min(1),
  teacherId: teacherIdSchema,
  teacherName: z.string().min(1),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  status: z.enum(["scheduled", "completed", "cancelled"]),
  students: z.array(dailyReportStudentSchema),
});

export const reportsDailyInputSchema = z.object({}).strict();

export const reportsDailyOutputSchema = z.object({
  date: localDateSchema.describe("Current Asia/Shanghai local date."),
  lessons: z.array(dailyReportLessonSchema),
  yesterday: z.object({
    date: localDateSchema,
    transactionCount: z.number().int().nonnegative(),
    gross_fen: moneyFenSchema,
    discount_fen: moneyFenSchema,
    net_fen: moneyFenSchema,
  }),
  unsentDraftCount: z.number().int().nonnegative(),
  pendingActionCount: z
    .number()
    .int()
    .nonnegative()
    .describe("Pending actions whose one-hour expiry has not passed."),
});

export type TeacherRate = z.infer<typeof teacherRateSchema>;
export type TeacherRatesSetInput = z.infer<typeof teacherRatesSetInputSchema>;
export type TeacherRatesListInput = z.infer<typeof teacherRatesListInputSchema>;
export type TeacherRatesListOutput = z.infer<typeof teacherRatesListOutputSchema>;
export type ReportsTeacherSettlementInput = z.infer<
  typeof reportsTeacherSettlementInputSchema
>;
export type ReportsTeacherSettlementOutput = z.infer<
  typeof reportsTeacherSettlementOutputSchema
>;
export type ReportIncomeItem = z.infer<typeof reportIncomeItemSchema>;
export type ReportsIncomeInput = z.infer<typeof reportsIncomeInputSchema>;
export type ReportsIncomeOutput = z.infer<typeof reportsIncomeOutputSchema>;
export type ReportBalanceItem = z.infer<typeof reportBalanceItemSchema>;
export type ReportsBalancesInput = z.infer<typeof reportsBalancesInputSchema>;
export type ReportsBalancesOutput = z.infer<typeof reportsBalancesOutputSchema>;
export type DailyReportLesson = z.infer<typeof dailyReportLessonSchema>;
export type ReportsDailyInput = z.infer<typeof reportsDailyInputSchema>;
export type ReportsDailyOutput = z.infer<typeof reportsDailyOutputSchema>;
