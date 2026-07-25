import { z } from "zod";
import { messageDraftSchema } from "./drafts";

const lessonIdSchema = z.uuid().describe("Lesson UUID.");
const studentIdSchema = z.uuid().describe("Student person UUID.");
const feedbackTextSchema = z
  .string()
  .min(1)
  .regex(/\S/, "Must contain non-whitespace text.")
  .describe("Teacher-authored Simplified-Chinese feedback text.");
const pickupTextSchema = z
  .string()
  .min(1)
  .regex(/\S/, "Must contain non-whitespace text.");

export const lessonFeedbackSchema = z.object({
  lessonId: lessonIdSchema,
  studentId: studentIdSchema,
  contentCovered: feedbackTextSchema.describe("Content covered in the lesson."),
  homework: feedbackTextSchema.describe("Homework assigned after the lesson."),
  performanceNote: feedbackTextSchema.describe(
    "Teacher's note about the student's lesson performance.",
  ),
  createdBy: z.string().min(1).describe("Acting principal id."),
  createdAt: z.iso.datetime().describe("UTC creation timestamp."),
});

export const feedbackCreateInputSchema = z
  .object({
    lessonId: lessonIdSchema,
    studentId: studentIdSchema,
    contentCovered: feedbackTextSchema.describe("Content covered in the lesson."),
    homework: feedbackTextSchema.describe("Homework assigned after the lesson."),
    performanceNote: feedbackTextSchema.describe(
      "Teacher's note about the student's lesson performance.",
    ),
  })
  .strict();

export const feedbackCreateOutputSchema = z.object({
  feedback: lessonFeedbackSchema,
  drafts: z
    .array(messageDraftSchema)
    .min(1)
    .describe("Raw guardian-facing drafts created atomically with the feedback."),
});

export const feedbackListInputSchema = z
  .object({
    lessonId: lessonIdSchema.optional().describe("Optional lesson filter."),
    studentId: studentIdSchema.optional().describe("Optional student filter."),
  })
  .strict();

export const feedbackListOutputSchema = z.object({
  feedback: z.array(lessonFeedbackSchema),
});

export const pickupPersonSchema = z.object({
  studentId: studentIdSchema,
  name: pickupTextSchema.describe("Authorized pickup person's exact name."),
  phone: pickupTextSchema.describe("Authorized pickup person's phone number."),
  relation: pickupTextSchema
    .describe("Relationship to the student, such as mother or grandfather."),
});

export const pickupPersonsSetInputSchema = z
  .object({
    studentId: studentIdSchema,
    pickupPersons: z
      .array(
        z
          .object({
            name: pickupTextSchema.describe(
              "Authorized pickup person's exact name.",
            ),
            phone: pickupTextSchema.describe(
              "Authorized pickup person's phone number.",
            ),
            relation: pickupTextSchema.describe(
              "Relationship to the student.",
            ),
          })
          .strict(),
      )
      .describe("Complete replacement list; an empty array clears the list."),
  })
  .strict();

export const pickupPersonsListInputSchema = z
  .object({ studentId: studentIdSchema })
  .strict();

export const pickupPersonsOutputSchema = z.object({
  pickupPersons: z.array(pickupPersonSchema),
});

export type LessonFeedback = z.infer<typeof lessonFeedbackSchema>;
export type FeedbackCreateInput = z.infer<typeof feedbackCreateInputSchema>;
export type FeedbackCreateOutput = z.infer<typeof feedbackCreateOutputSchema>;
export type FeedbackListInput = z.infer<typeof feedbackListInputSchema>;
export type FeedbackListOutput = z.infer<typeof feedbackListOutputSchema>;
export type PickupPerson = z.infer<typeof pickupPersonSchema>;
export type PickupPersonsSetInput = z.infer<typeof pickupPersonsSetInputSchema>;
export type PickupPersonsListInput = z.infer<typeof pickupPersonsListInputSchema>;
export type PickupPersonsOutput = z.infer<typeof pickupPersonsOutputSchema>;
