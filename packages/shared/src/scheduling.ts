import { z } from "zod";
import { messageDraftSchema } from "./drafts";

const teacherIdSchema = z.uuid().describe("Teacher person UUID.");
const localDateSchema = z
  .iso.date()
  .describe("Asia/Shanghai local calendar date in YYYY-MM-DD format.");
const weekdaySchema = z
  .number()
  .int()
  .min(0)
  .max(6)
  .describe("Local weekday where 0 is Sunday and 6 is Saturday.");
const startMinuteSchema = z
  .number()
  .int()
  .min(0)
  .max(1439)
  .describe("Start minute from Asia/Shanghai local midnight, inclusive.");
const endMinuteSchema = z
  .number()
  .int()
  .min(1)
  .max(1440)
  .describe("End minute from Asia/Shanghai local midnight, exclusive.");

const lessonIdSchema = z.uuid().describe("Lesson UUID.");
const classTypeIdSchema = z.uuid().describe("Class type UUID.");
const studentIdSchema = z.uuid().describe("Student person UUID.");

export const lessonStatusSchema = z.enum([
  "scheduled",
  "completed",
  "cancelled",
]);

export const lessonSchema = z.object({
  id: lessonIdSchema,
  classTypeId: classTypeIdSchema,
  teacherId: teacherIdSchema,
  startAt: z.iso.datetime().describe("Lesson start as a UTC instant."),
  endAt: z.iso.datetime().describe("Lesson end as a UTC instant."),
  status: lessonStatusSchema,
  makeupForLessonId: lessonIdSchema
    .nullable()
    .describe("Original lesson UUID when this is a makeup lesson."),
  termId: z
    .uuid()
    .nullable()
    .describe("Term UUID when the lesson belongs to a term."),
  createdAt: z.iso.datetime().describe("UTC creation timestamp."),
  studentIds: z.array(studentIdSchema).describe("Enrolled student UUIDs."),
});

const lessonCreateCommon = {
  classTypeId: classTypeIdSchema,
  teacherId: teacherIdSchema,
  studentIds: z
    .array(studentIdSchema)
    .min(1)
    .describe("Students to enroll in every created lesson."),
};

export const lessonsCreateSingleInputSchema = z
  .object({
    mode: z.literal("single"),
    ...lessonCreateCommon,
    date: localDateSchema.describe("Asia/Shanghai local lesson date."),
    startMin: startMinuteSchema,
    termId: z.uuid().optional().describe("Optional term UUID."),
    makeupForLessonId: lessonIdSchema
      .optional()
      .describe("Original lesson UUID when booking a makeup lesson."),
  })
  .strict();

export const lessonsCreateRecurringInputSchema = z
  .object({
    mode: z.literal("recurring"),
    ...lessonCreateCommon,
    termId: z.uuid().describe("Term whose inclusive dates bound the series."),
    weekday: weekdaySchema.describe("Local weekday to create within the term."),
    startMin: startMinuteSchema,
  })
  .strict();

export const lessonsCreateInputSchema = z
  .object({
    mode: z.enum(["single", "recurring"]),
    ...lessonCreateCommon,
    date: localDateSchema
      .optional()
      .describe("Required local date when mode is single."),
    weekday: weekdaySchema
      .optional()
      .describe("Required local weekday when mode is recurring."),
    startMin: startMinuteSchema,
    termId: z
      .uuid()
      .optional()
      .describe("Required term UUID for recurring creation; optional for a single lesson."),
    makeupForLessonId: lessonIdSchema
      .optional()
      .describe("Original lesson UUID for a single makeup lesson."),
  })
  .strict();

export const lessonsCreateOutputSchema = z.object({
  lessons: z.array(lessonSchema),
  drafts: z.array(messageDraftSchema),
});

export const lessonBulkSpecSchema = z
  .object({
    ...lessonCreateCommon,
    date: localDateSchema.describe("Asia/Shanghai local lesson date."),
    startMin: startMinuteSchema,
    termId: z.uuid().optional().describe("Optional term UUID."),
    makeupForLessonId: lessonIdSchema
      .optional()
      .describe("Optional original lesson UUID for a makeup lesson."),
  })
  .strict();

export const lessonsBulkApplyInputSchema = z
  .object({
    lessons: z
      .array(lessonBulkSpecSchema)
      .min(1)
      .max(24)
      .describe("One to 24 explicit single-lesson specifications; recurrence is not accepted."),
  })
  .strict();

export const lessonsBulkApplyOutputSchema = lessonsCreateOutputSchema;

export const lessonsMoveInputSchema = z
  .object({
    id: lessonIdSchema,
    date: localDateSchema.describe("New Asia/Shanghai local lesson date."),
    startMin: startMinuteSchema.describe(
      "New start minute from Asia/Shanghai local midnight.",
    ),
  })
  .strict();

export const lessonsCancelInputSchema = z
  .object({
    id: lessonIdSchema,
    reason: z
      .string()
      .min(1)
      .optional()
      .describe("Optional cancellation reason to include in message drafts."),
  })
  .strict();

export const lessonMutationOutputSchema = z.object({
  lesson: lessonSchema,
  drafts: z.array(messageDraftSchema),
});

export const lessonsGetInputSchema = z.object({ id: lessonIdSchema }).strict();

export const lessonsListInputSchema = z
  .object({
    startAt: z.iso.datetime().describe("Inclusive UTC range start."),
    endAt: z.iso.datetime().describe("Exclusive UTC range end."),
    teacherId: teacherIdSchema.optional().describe("Optional teacher filter."),
    studentId: studentIdSchema.optional().describe("Optional student filter."),
  })
  .strict();

export const lessonsListOutputSchema = z.object({
  lessons: z.array(lessonSchema),
});

export const freeSlotSchema = z.object({
  date: localDateSchema,
  startMin: startMinuteSchema,
  endMin: endMinuteSchema,
  startAt: z.iso.datetime().describe("Free interval start as a UTC instant."),
  endAt: z.iso.datetime().describe("Free interval end as a UTC instant."),
});

export const freeSlotsFindInputSchema = z
  .object({
    teacherId: teacherIdSchema,
    classTypeId: classTypeIdSchema.describe(
      "Class type whose duration determines whether a free interval is usable.",
    ),
    date: localDateSchema.describe("Asia/Shanghai local date to inspect."),
  })
  .strict();

export const freeSlotsFindOutputSchema = z.object({
  teacherId: teacherIdSchema,
  classTypeId: classTypeIdSchema,
  date: localDateSchema,
  slots: z.array(freeSlotSchema),
});

export const enrollmentSchema = z.object({
  lessonId: lessonIdSchema,
  studentId: studentIdSchema,
});

export const enrollmentsAddInputSchema = enrollmentSchema.strict();
export const enrollmentsRemoveInputSchema = enrollmentSchema.strict();
export const enrollmentsRemoveOutputSchema = enrollmentSchema.extend({
  removed: z.literal(true),
});

export const availabilitySlotSchema = z.object({
  weekday: weekdaySchema,
  startMin: startMinuteSchema,
  endMin: endMinuteSchema,
});

export const availabilityExceptionSchema = z.object({
  teacherId: teacherIdSchema,
  date: localDateSchema,
  available: z.boolean().describe("Availability override for the date or interval."),
  startMin: startMinuteSchema
    .nullable()
    .describe("Optional interval start; null means the whole local date."),
  endMin: endMinuteSchema
    .nullable()
    .describe("Optional interval end; null means the whole local date."),
});

export const availabilitySchema = z.object({
  teacherId: teacherIdSchema,
  slots: z.array(availabilitySlotSchema),
  exceptions: z.array(availabilityExceptionSchema),
});

export const availabilitySetInputSchema = z
  .object({
    teacherId: teacherIdSchema,
    slots: z
      .array(availabilitySlotSchema.strict())
      .describe("Complete replacement weekly pattern; an empty array clears it."),
  })
  .strict();

export const availabilityGetInputSchema = z
  .object({ teacherId: teacherIdSchema })
  .strict();

export const availabilityExceptionSetInputSchema = z
  .object({
    teacherId: teacherIdSchema,
    date: localDateSchema,
    available: z.boolean().describe("Availability override value."),
    startMin: startMinuteSchema
      .optional()
      .describe("Interval start; omit both minute fields for the whole date."),
    endMin: endMinuteSchema
      .optional()
      .describe("Interval end; omit both minute fields for the whole date."),
  })
  .strict();

export const closureDaySchema = z.object({
  date: localDateSchema,
  reason: z.string().min(1).describe("Reason the center is closed."),
});

export const closureDaysSetInputSchema = closureDaySchema.strict();
export const closureDaysListInputSchema = z.object({}).strict();
export const closureDaysListOutputSchema = z.object({
  closureDays: z.array(closureDaySchema),
});

export const termSchema = z.object({
  id: z.uuid().describe("Term UUID."),
  name: z.string().min(1).describe("Term name, for example 2026秋季."),
  startDate: localDateSchema.describe("First local date in the term."),
  endDate: localDateSchema.describe("Last local date in the term."),
});

export const termsCreateInputSchema = z
  .object({
    name: z.string().min(1).describe("Term name, for example 2026秋季."),
    startDate: localDateSchema.describe("First local date in the term."),
    endDate: localDateSchema.describe("Last local date in the term."),
  })
  .strict();

export const termsListInputSchema = z.object({}).strict();
export const termsListOutputSchema = z.object({ terms: z.array(termSchema) });

export type AvailabilitySlot = z.infer<typeof availabilitySlotSchema>;
export type AvailabilityException = z.infer<
  typeof availabilityExceptionSchema
>;
export type Availability = z.infer<typeof availabilitySchema>;
export type AvailabilitySetInput = z.infer<typeof availabilitySetInputSchema>;
export type AvailabilityGetInput = z.infer<typeof availabilityGetInputSchema>;
export type AvailabilityExceptionSetInput = z.infer<
  typeof availabilityExceptionSetInputSchema
>;
export type ClosureDay = z.infer<typeof closureDaySchema>;
export type ClosureDaysSetInput = z.infer<typeof closureDaysSetInputSchema>;
export type ClosureDaysListInput = z.infer<typeof closureDaysListInputSchema>;
export type ClosureDaysListOutput = z.infer<
  typeof closureDaysListOutputSchema
>;
export type Term = z.infer<typeof termSchema>;
export type TermsCreateInput = z.infer<typeof termsCreateInputSchema>;
export type TermsListInput = z.infer<typeof termsListInputSchema>;
export type TermsListOutput = z.infer<typeof termsListOutputSchema>;
export type LessonStatus = z.infer<typeof lessonStatusSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type LessonsCreateInput = z.infer<typeof lessonsCreateInputSchema>;
export type LessonsCreateOutput = z.infer<typeof lessonsCreateOutputSchema>;
export type LessonBulkSpec = z.infer<typeof lessonBulkSpecSchema>;
export type LessonsBulkApplyInput = z.infer<typeof lessonsBulkApplyInputSchema>;
export type LessonsBulkApplyOutput = z.infer<typeof lessonsBulkApplyOutputSchema>;
export type LessonsMoveInput = z.infer<typeof lessonsMoveInputSchema>;
export type LessonsCancelInput = z.infer<typeof lessonsCancelInputSchema>;
export type LessonMutationOutput = z.infer<typeof lessonMutationOutputSchema>;
export type LessonsGetInput = z.infer<typeof lessonsGetInputSchema>;
export type LessonsListInput = z.infer<typeof lessonsListInputSchema>;
export type LessonsListOutput = z.infer<typeof lessonsListOutputSchema>;
export type FreeSlot = z.infer<typeof freeSlotSchema>;
export type FreeSlotsFindInput = z.infer<typeof freeSlotsFindInputSchema>;
export type FreeSlotsFindOutput = z.infer<typeof freeSlotsFindOutputSchema>;
export type Enrollment = z.infer<typeof enrollmentSchema>;
export type EnrollmentsAddInput = z.infer<typeof enrollmentsAddInputSchema>;
export type EnrollmentsRemoveInput = z.infer<
  typeof enrollmentsRemoveInputSchema
>;
export type EnrollmentsRemoveOutput = z.infer<
  typeof enrollmentsRemoveOutputSchema
>;
