import { z } from "zod";
import { attendanceStatusSchema } from "./attendance";
import { entitlementKindSchema, entitlementStatusSchema } from "./billing";
import { lessonStatusSchema } from "./scheduling";

const personIdSchema = z.uuid().describe("Person UUID.");
const authUserIdSchema = z.uuid().describe("Better Auth user UUID.");
const lessonIdSchema = z.uuid().describe("Lesson UUID.");
const classTypeIdSchema = z.uuid().describe("Class type UUID.");
const entitlementIdSchema = z.uuid().describe("Entitlement UUID.");
const utcInstantSchema = z.iso.datetime().describe("UTC instant.");
const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Asia/Shanghai local date in YYYY-MM-DD form.");

export const myStudentSchema = z.object({
  id: personIdSchema,
  name: z.string().min(1),
  school: z.string().nullable(),
  grade: z.string().nullable(),
});

export const myStudentsListInputSchema = z.object({}).strict();
export const myStudentsListOutputSchema = z.object({
  students: z.array(myStudentSchema),
});

export const myScheduleListInputSchema = z
  .object({
    startAt: utcInstantSchema.describe("Inclusive range start."),
    endAt: utcInstantSchema.describe("Exclusive range end."),
  })
  .strict();

export const myAttendanceSchema = z.object({
  status: attendanceStatusSchema,
  checkedInAt: utcInstantSchema.nullable(),
  checkedOutAt: utcInstantSchema.nullable(),
  pickedUpBy: z.string().nullable(),
});

export const myScheduleItemSchema = z.object({
  lessonId: lessonIdSchema,
  studentId: personIdSchema.describe("One child linked to the signed-in guardian."),
  studentName: z.string().min(1),
  classTypeId: classTypeIdSchema,
  classTypeName: z.string().min(1),
  teacherId: personIdSchema,
  teacherName: z.string().min(1),
  startAt: utcInstantSchema,
  endAt: utcInstantSchema,
  status: lessonStatusSchema,
  attendance: myAttendanceSchema.nullable(),
});

export const myScheduleListOutputSchema = z.object({
  lessons: z.array(myScheduleItemSchema),
});

export const myBalanceEntitlementSchema = z.object({
  id: entitlementIdSchema,
  kind: entitlementKindSchema,
  classTypeId: classTypeIdSchema,
  classTypeName: z.string().min(1),
  remainingCredits: z.number().int().nullable(),
  validFrom: localDateSchema.nullable(),
  validTo: localDateSchema.nullable(),
  status: entitlementStatusSchema,
  createdAt: utcInstantSchema,
});

export const myStudentBalanceSchema = z.object({
  studentId: personIdSchema,
  studentName: z.string().min(1),
  totalRemainingCredits: z.number().int(),
  entitlements: z.array(myBalanceEntitlementSchema),
});

export const myBalanceGetInputSchema = z.object({}).strict();
export const myBalanceGetOutputSchema = z.object({
  students: z.array(myStudentBalanceSchema),
});

export const myFeedbackListInputSchema = z.object({}).strict();
export const myFeedbackSchema = z.object({
  lessonId: lessonIdSchema,
  studentId: personIdSchema,
  studentName: z.string().min(1),
  classTypeId: classTypeIdSchema,
  classTypeName: z.string().min(1),
  teacherName: z.string().min(1),
  lessonStartAt: utcInstantSchema,
  contentCovered: z.string().min(1),
  homework: z.string().min(1),
  performanceNote: z.string().min(1),
  createdAt: utcInstantSchema,
});

export const myFeedbackListOutputSchema = z.object({
  feedback: z.array(myFeedbackSchema),
});

export const guardianAccountsCreateInputSchema = z
  .object({
    personId: personIdSchema,
    email: z.email(),
    password: z.string().min(8).max(128),
  })
  .strict();

export const guardianAccountSchema = z.object({
  personId: personIdSchema,
  authUserId: authUserIdSchema,
  email: z.email(),
});

export type MyStudent = z.infer<typeof myStudentSchema>;
export type MyStudentsListInput = z.infer<typeof myStudentsListInputSchema>;
export type MyStudentsListOutput = z.infer<typeof myStudentsListOutputSchema>;
export type MyScheduleListInput = z.infer<typeof myScheduleListInputSchema>;
export type MyScheduleItem = z.infer<typeof myScheduleItemSchema>;
export type MyScheduleListOutput = z.infer<typeof myScheduleListOutputSchema>;
export type MyBalanceGetInput = z.infer<typeof myBalanceGetInputSchema>;
export type MyBalanceGetOutput = z.infer<typeof myBalanceGetOutputSchema>;
export type MyStudentBalance = z.infer<typeof myStudentBalanceSchema>;
export type MyFeedbackListInput = z.infer<typeof myFeedbackListInputSchema>;
export type MyFeedbackListOutput = z.infer<typeof myFeedbackListOutputSchema>;
export type GuardianAccountsCreateInput = z.infer<
  typeof guardianAccountsCreateInputSchema
>;
export type GuardianAccount = z.infer<typeof guardianAccountSchema>;
