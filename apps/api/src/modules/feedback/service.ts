import type {
  FeedbackCreateInput,
  FeedbackCreateOutput,
  FeedbackListInput,
  FeedbackListOutput,
  LessonFeedback,
  MessageDraft,
} from "@h2class/shared";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Principal } from "../../auth/types";
import {
  classType,
  enrollment,
  guardianStudent,
  lesson,
  lessonFeedback,
  messageDraft,
  person,
} from "../../db/schema";
import { formatShanghaiDateTime } from "../../time/asia-shanghai";

type Database = ReturnType<typeof drizzle>;
type FeedbackErrorCode =
  | "feedback_already_exists"
  | "feedback_guardian_required"
  | "forbidden"
  | "lesson_not_found"
  | "student_not_enrolled";

export type FeedbackServiceError = {
  kind: "feedback_service_error";
  code: FeedbackErrorCode;
  status: 400 | 403 | 404 | 409;
};

const fail = (
  code: FeedbackErrorCode,
  status: FeedbackServiceError["status"] = 400,
): never => {
  throw { kind: "feedback_service_error", code, status } satisfies FeedbackServiceError;
};

export const isFeedbackServiceError = (
  error: unknown,
): error is FeedbackServiceError =>
  typeof error === "object" &&
  error !== null &&
  Reflect.get(error, "kind") === "feedback_service_error";

const feedbackColumns = {
  lessonId: lessonFeedback.lessonId,
  studentId: lessonFeedback.studentId,
  contentCovered: lessonFeedback.contentCovered,
  homework: lessonFeedback.homework,
  performanceNote: lessonFeedback.performanceNote,
  createdBy: lessonFeedback.createdBy,
  createdAt: lessonFeedback.createdAt,
};

type FeedbackRow = Omit<LessonFeedback, "createdAt"> & { createdAt: Date };

const serializeFeedback = (row: FeedbackRow): LessonFeedback => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

const principalPersonId = async (db: Database, principal: Principal) => {
  const [row] = await db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.authUserId, principal.id));
  if (row === undefined) return fail("forbidden", 403);
  return row.id;
};

const teacherScope = async (db: Database, principal: Principal) => {
  if (
    principal.roles.some((role) =>
      role === "admin" || role === "staff" || role === "agent"
    )
  ) {
    return undefined;
  }
  if (!principal.roles.includes("teacher")) fail("forbidden", 403);
  return principalPersonId(db, principal);
};

const loadLessonContext = async (db: Database, lessonId: string) => {
  const [row] = await db
    .select({
      id: lesson.id,
      teacherId: lesson.teacherId,
      startAt: lesson.startAt,
      endAt: lesson.endAt,
      classTypeName: classType.name,
    })
    .from(lesson)
    .innerJoin(classType, eq(classType.id, lesson.classTypeId))
    .where(eq(lesson.id, lessonId));
  if (row === undefined) return fail("lesson_not_found", 404);
  return row;
};

const createDraft = (
  guardianId: string,
  text: string,
  createdAt: Date,
): { output: MessageDraft; values: typeof messageDraft.$inferInsert } => {
  const id = crypto.randomUUID();
  const output: MessageDraft = {
    id,
    personId: guardianId,
    purpose: "lesson_feedback_guardian",
    text,
    status: "draft",
    createdAt: createdAt.toISOString(),
    sentAt: null,
  };
  return {
    output,
    values: {
      id,
      personId: guardianId,
      purpose: output.purpose,
      text,
      status: "draft",
      createdAt,
      sentAt: null,
    },
  };
};

const feedbackWriteFailure = (error: unknown): never => {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("lesson_feedback_lesson_student_unique") ||
    message.includes("lesson_feedback.lesson_id, lesson_feedback.student_id")
  ) {
    fail("feedback_already_exists", 409);
  }
  if (message.includes("student_not_enrolled")) {
    fail("student_not_enrolled");
  }
  throw error;
};

export const createFeedback = async (
  d1: D1Database,
  principal: Principal,
  input: FeedbackCreateInput,
): Promise<FeedbackCreateOutput> => {
  const db = drizzle(d1);
  const lessonContext = await loadLessonContext(db, input.lessonId);
  const scopedTeacherId = await teacherScope(db, principal);
  if (
    scopedTeacherId !== undefined &&
    scopedTeacherId !== lessonContext.teacherId
  ) {
    fail("forbidden", 403);
  }

  const [student] = await db
    .select({ name: person.name })
    .from(enrollment)
    .innerJoin(person, eq(person.id, enrollment.studentId))
    .where(
      and(
        eq(enrollment.lessonId, input.lessonId),
        eq(enrollment.studentId, input.studentId),
      ),
    );
  if (student === undefined) return fail("student_not_enrolled");

  const guardians = await db
    .select({ guardianId: guardianStudent.guardianId })
    .from(guardianStudent)
    .where(eq(guardianStudent.studentId, input.studentId));
  if (guardians.length === 0) fail("feedback_guardian_required");

  const createdAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const feedback: LessonFeedback = {
    ...input,
    createdBy: principal.id,
    createdAt: createdAt.toISOString(),
  };
  const timeText = `${formatShanghaiDateTime(lessonContext.startAt)}—${formatShanghaiDateTime(lessonContext.endAt)}`;
  const rawText = `${student.name}在${timeText}的${lessonContext.classTypeName}课后反馈：课堂内容：${input.contentCovered}；课后作业：${input.homework}；课堂表现：${input.performanceNote}。`;
  const drafts = guardians.map(({ guardianId }) =>
    createDraft(guardianId, rawText, createdAt),
  );

  try {
    await db.batch([
      db.insert(lessonFeedback).values({
        ...input,
        createdBy: principal.id,
        createdAt,
      }),
      db.insert(messageDraft).values(drafts.map(({ values }) => values)),
    ]);
  } catch (error) {
    feedbackWriteFailure(error);
  }

  return { feedback, drafts: drafts.map(({ output }) => output) };
};

export const listFeedback = async (
  d1: D1Database,
  principal: Principal,
  input: FeedbackListInput,
): Promise<FeedbackListOutput> => {
  const db = drizzle(d1);
  const scopedTeacherId = await teacherScope(db, principal);
  const rows = await db
    .select(feedbackColumns)
    .from(lessonFeedback)
    .innerJoin(lesson, eq(lesson.id, lessonFeedback.lessonId))
    .where(
      and(
        input.lessonId === undefined
          ? undefined
          : eq(lessonFeedback.lessonId, input.lessonId),
        input.studentId === undefined
          ? undefined
          : eq(lessonFeedback.studentId, input.studentId),
        scopedTeacherId === undefined
          ? undefined
          : eq(lesson.teacherId, scopedTeacherId),
      ),
    )
    .orderBy(desc(lessonFeedback.createdAt), desc(lessonFeedback.lessonId));
  return { feedback: rows.map(serializeFeedback) };
};
