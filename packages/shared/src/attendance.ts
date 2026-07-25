import { z } from "zod";
import { messageDraftSchema } from "./drafts";

const lessonIdSchema = z.uuid().describe("Lesson UUID.");
const studentIdSchema = z.uuid().describe("Student person UUID.");

export const attendanceStatusSchema = z.enum([
  "present",
  "absent",
  "excused_leave",
  "late_cancel",
]);

export const attendanceSchema = z.object({
  lessonId: lessonIdSchema,
  studentId: studentIdSchema,
  status: attendanceStatusSchema,
  checkedInAt: z.iso.datetime().nullable().describe("UTC check-in instant."),
  checkedOutAt: z.iso.datetime().nullable().describe("UTC check-out instant."),
  pickedUpBy: z
    .string()
    .min(1)
    .nullable()
    .describe("Pickup person's name when recorded."),
  markedBy: z.string().min(1).describe("Acting principal id."),
});

export const creditLedgerKindSchema = z.enum([
  "purchase",
  "attendance",
  "adjustment",
  "refund",
]);

export const creditLedgerEntrySchema = z.object({
  id: z.uuid().describe("Credit-ledger entry UUID."),
  studentId: studentIdSchema,
  entitlementId: z.uuid().nullable().describe("Entitlement UUID when assigned."),
  delta: z.number().int().describe("Signed credit change."),
  kind: creditLedgerKindSchema,
  lessonId: lessonIdSchema.nullable(),
  reason: z.string().min(1),
  createdBy: z.string().min(1).describe("Acting principal id."),
  createdAt: z.iso.datetime().describe("UTC creation timestamp."),
});

export const attendanceCheckinInputSchema = z
  .object({
    lessonId: lessonIdSchema,
    students: z
      .array(
        z
          .object({
            studentId: studentIdSchema,
            status: attendanceStatusSchema,
          })
          .strict(),
      )
      .min(1)
      .describe("Complete lesson roster with one attendance status per student."),
  })
  .strict();

export const attendanceMutationOutputSchema = z.object({
  attendance: z.array(attendanceSchema),
  ledgerEntries: z.array(creditLedgerEntrySchema),
  drafts: z.array(messageDraftSchema),
});

export const attendanceCheckoutInputSchema = z
  .object({
    lessonId: lessonIdSchema,
    studentId: studentIdSchema,
    pickedUpBy: z
      .string()
      .min(1)
      .regex(/\S/, "Must contain non-whitespace text.")
      .describe("Pickup person's exact name."),
  })
  .strict();

export const attendanceCheckoutOverrideInputSchema =
  attendanceCheckoutInputSchema;

export const attendanceListInputSchema = z
  .object({
    lessonId: lessonIdSchema.optional().describe("Optional lesson filter."),
    studentId: studentIdSchema.optional().describe("Optional student filter."),
  })
  .strict();

export const attendanceListOutputSchema = z.object({
  attendance: z.array(attendanceSchema),
});

export const leaveRequestInputSchema = z
  .object({
    lessonId: lessonIdSchema,
    studentId: studentIdSchema,
  })
  .strict();

export const balanceSchema = z.object({
  studentId: studentIdSchema,
  balance: z.number().int().describe("Derived SUM of credit-ledger deltas."),
});

export const balancesGetInputSchema = z
  .object({
    studentId: studentIdSchema.optional().describe("Optional student filter."),
  })
  .strict();

export const balancesGetOutputSchema = z.object({
  balances: z.array(balanceSchema),
});

export const deductionPolicySchema = z.object({
  status: attendanceStatusSchema,
  deducts: z.boolean().describe("Whether this status consumes one credit."),
});

export const deductionPolicyGetInputSchema = z.object({}).strict();
export const deductionPolicyGetOutputSchema = z.object({
  policies: z.array(deductionPolicySchema),
});

export const deductionPolicySetInputSchema = deductionPolicySchema.strict();

export const ledgerAdjustmentCreateInputSchema = z
  .object({
    studentId: studentIdSchema,
    delta: z.number().int().describe("Non-zero signed credit adjustment."),
    reason: z
      .string()
      .regex(/\S/)
      .describe("Required human-readable reason containing non-whitespace text."),
  })
  .strict();

export const ledgerListInputSchema = z
  .object({
    studentId: studentIdSchema.optional().describe("Optional student filter."),
    kind: creditLedgerKindSchema.optional().describe("Optional ledger-kind filter."),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().positive().max(100).default(50),
  })
  .strict();

export const ledgerListOutputSchema = z.object({
  entries: z.array(creditLedgerEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;
export type Attendance = z.infer<typeof attendanceSchema>;
export type CreditLedgerKind = z.infer<typeof creditLedgerKindSchema>;
export type CreditLedgerEntry = z.infer<typeof creditLedgerEntrySchema>;
export type AttendanceCheckinInput = z.infer<typeof attendanceCheckinInputSchema>;
export type AttendanceMutationOutput = z.infer<typeof attendanceMutationOutputSchema>;
export type AttendanceCheckoutInput = z.infer<typeof attendanceCheckoutInputSchema>;
export type AttendanceCheckoutOverrideInput = z.infer<
  typeof attendanceCheckoutOverrideInputSchema
>;
export type AttendanceListInput = z.infer<typeof attendanceListInputSchema>;
export type AttendanceListOutput = z.infer<typeof attendanceListOutputSchema>;
export type LeaveRequestInput = z.infer<typeof leaveRequestInputSchema>;
export type Balance = z.infer<typeof balanceSchema>;
export type BalancesGetInput = z.infer<typeof balancesGetInputSchema>;
export type BalancesGetOutput = z.infer<typeof balancesGetOutputSchema>;
export type DeductionPolicy = z.infer<typeof deductionPolicySchema>;
export type DeductionPolicySetInput = z.infer<typeof deductionPolicySetInputSchema>;
export type DeductionPolicyGetOutput = z.infer<typeof deductionPolicyGetOutputSchema>;
export type LedgerAdjustmentCreateInput = z.infer<typeof ledgerAdjustmentCreateInputSchema>;
export type LedgerListInput = z.infer<typeof ledgerListInputSchema>;
export type LedgerListOutput = z.infer<typeof ledgerListOutputSchema>;
