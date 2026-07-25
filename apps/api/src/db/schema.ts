import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { HUMAN_ROLES } from "../auth/types";

const CLASS_TYPE_CATEGORIES = ["素质类", "托管", "学科"] as const;
const LESSON_STATUSES = ["scheduled", "completed", "cancelled"] as const;
const MESSAGE_DRAFT_STATUSES = ["draft", "sent"] as const;
const ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "excused_leave",
  "late_cancel",
] as const;
const CREDIT_LEDGER_KINDS = [
  "purchase",
  "attendance",
  "adjustment",
  "refund",
] as const;
const ENTITLEMENT_KINDS = ["package", "subscription"] as const;
const ENTITLEMENT_STATUSES = [
  "active",
  "exhausted",
  "expired",
  "refunded",
] as const;
const PAYMENT_METHODS = ["wechat", "cash", "other"] as const;
const PENDING_ACTION_STATUSES = [
  "pending",
  "executed",
  "rejected",
  "expired",
] as const;

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .default(false)
      .notNull(),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("user_email_unique").on(t.email)],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("session_token_unique").on(t.token),
    index("session_user_id_idx").on(t.userId),
  ],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("account_user_id_idx").on(t.userId),
    uniqueIndex("account_provider_account_unique").on(
      t.providerId,
      t.accountId,
    ),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const person = sqliteTable(
  "person",
  {
    id: text("id").primaryKey(),
    authUserId: text("auth_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    phone: text("phone"),
    school: text("school"),
    grade: text("grade"),
    notes: text("notes"),
    medicalNotes: text("medical_notes"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("person_auth_user_id_unique").on(t.authUserId)],
);

export const personRole = sqliteTable(
  "person_role",
  {
    personId: text("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    role: text("role", { enum: HUMAN_ROLES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.role] }),
    check(
      "person_role_role_check",
      sql`${t.role} in ('admin', 'staff', 'teacher', 'guardian')`,
    ),
    index("person_role_person_id_idx").on(t.personId),
  ],
);

export const guardianStudent = sqliteTable(
  "guardian_student",
  {
    guardianId: text("guardian_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("guardian_student_pair_unique").on(
      t.guardianId,
      t.studentId,
    ),
    index("guardian_student_student_id_idx").on(t.studentId),
  ],
);

export const classType = sqliteTable(
  "class_type",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull(),
    durationMin: integer("duration_min").notNull(),
    category: text("category", { enum: CLASS_TYPE_CATEGORIES }).notNull(),
    active: integer("active", { mode: "boolean" }).default(true).notNull(),
  },
  (t) => [
    check("class_type_capacity_check", sql`${t.capacity} > 0`),
    check("class_type_duration_min_check", sql`${t.durationMin} > 0`),
    check(
      "class_type_category_check",
      sql`${t.category} in ('素质类', '托管', '学科')`,
    ),
  ],
);

export const price = sqliteTable(
  "price",
  {
    id: text("id").primaryKey(),
    classTypeId: text("class_type_id")
      .notNull()
      .references(() => classType.id),
    unitAmountFen: integer("unit_amount_fen").notNull(),
    effectiveFrom: integer("effective_from", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check(
      "price_unit_amount_fen_check",
      sql`${t.unitAmountFen} >= 0 and typeof(${t.unitAmountFen}) = 'integer'`,
    ),
    index("price_class_type_effective_from_idx").on(
      t.classTypeId,
      t.effectiveFrom,
    ),
  ],
);

export const teacherRate = sqliteTable(
  "teacher_rate",
  {
    teacherId: text("teacher_id")
      .notNull()
      .references(() => person.id),
    classTypeId: text("class_type_id")
      .notNull()
      .references(() => classType.id),
    rateFen: integer("rate_fen").notNull(),
    effectiveFrom: integer("effective_from", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    check(
      "teacher_rate_fen_check",
      sql`${t.rateFen} >= 0 and ${t.rateFen} <= 9007199254740991 and typeof(${t.rateFen}) = 'integer'`,
    ),
    check(
      "teacher_rate_effective_from_check",
      sql`typeof(${t.effectiveFrom}) = 'integer'`,
    ),
    uniqueIndex("teacher_rate_version_unique").on(
      t.teacherId,
      t.classTypeId,
      t.effectiveFrom,
    ),
    index("teacher_rate_class_type_id_idx").on(t.classTypeId),
  ],
);

export const teacherAvailability = sqliteTable(
  "teacher_availability",
  {
    teacherId: text("teacher_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
  },
  (t) => [
    uniqueIndex("teacher_availability_slot_unique").on(
      t.teacherId,
      t.weekday,
      t.startMin,
      t.endMin,
    ),
    check(
      "teacher_availability_weekday_check",
      sql`${t.weekday} between 0 and 6`,
    ),
    check(
      "teacher_availability_time_check",
      sql`${t.startMin} >= 0 and ${t.startMin} < ${t.endMin} and ${t.endMin} <= 1440`,
    ),
  ],
);

export const availabilityException = sqliteTable(
  "availability_exception",
  {
    teacherId: text("teacher_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    available: integer("available", { mode: "boolean" }).notNull(),
    startMin: integer("start_min"),
    endMin: integer("end_min"),
  },
  (t) => [
    uniqueIndex("availability_exception_teacher_date_unique").on(
      t.teacherId,
      t.date,
    ),
    check(
      "availability_exception_available_check",
      sql`${t.available} in (0, 1)`,
    ),
    check(
      "availability_exception_time_check",
      sql`(${t.startMin} is null and ${t.endMin} is null) or (${t.startMin} >= 0 and ${t.startMin} < ${t.endMin} and ${t.endMin} <= 1440)`,
    ),
  ],
);

export const closureDay = sqliteTable(
  "closure_day",
  {
    date: text("date").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [uniqueIndex("closure_day_date_unique").on(t.date)],
);

export const term = sqliteTable(
  "term",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
  },
  (t) => [
    check("term_date_range_check", sql`${t.startDate} <= ${t.endDate}`),
    index("term_start_date_idx").on(t.startDate),
  ],
);

export const lesson = sqliteTable(
  "lesson",
  {
    id: text("id").primaryKey(),
    classTypeId: text("class_type_id")
      .notNull()
      .references(() => classType.id),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => person.id),
    startAt: integer("start_at", { mode: "timestamp" }).notNull(),
    endAt: integer("end_at", { mode: "timestamp" }).notNull(),
    status: text("status", { enum: LESSON_STATUSES })
      .default("scheduled")
      .notNull(),
    makeupForLessonId: text("makeup_for_lesson_id").references(
      (): AnySQLiteColumn => lesson.id,
      { onDelete: "set null" },
    ),
    termId: text("term_id").references(() => term.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check("lesson_time_range_check", sql`${t.startAt} < ${t.endAt}`),
    check(
      "lesson_status_check",
      sql`${t.status} in ('scheduled', 'completed', 'cancelled')`,
    ),
    uniqueIndex("lesson_teacher_start_unique")
      .on(t.teacherId, t.startAt)
      .where(sql`${t.status} != 'cancelled'`),
    index("lesson_range_idx").on(t.startAt, t.endAt),
    index("lesson_teacher_range_idx").on(t.teacherId, t.startAt, t.endAt),
  ],
);

export const enrollment = sqliteTable(
  "enrollment",
  {
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => person.id),
  },
  (t) => [
    uniqueIndex("enrollment_lesson_student_unique").on(
      t.lessonId,
      t.studentId,
    ),
    index("enrollment_student_id_idx").on(t.studentId),
  ],
);

export const messageDraft = sqliteTable(
  "message_draft",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => person.id),
    purpose: text("purpose").notNull(),
    text: text("text").notNull(),
    status: text("status", { enum: MESSAGE_DRAFT_STATUSES })
      .default("draft")
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    sentAt: integer("sent_at", { mode: "timestamp" }),
  },
  (t) => [
    check(
      "message_draft_status_check",
      sql`${t.status} in ('draft', 'sent')`,
    ),
    check(
      "message_draft_sent_at_check",
      sql`(${t.status} = 'draft' and ${t.sentAt} is null) or (${t.status} = 'sent' and ${t.sentAt} is not null)`,
    ),
    index("message_draft_status_created_at_idx").on(t.status, t.createdAt),
    index("message_draft_person_id_idx").on(t.personId),
  ],
);

export const deductionPolicy = sqliteTable(
  "deduction_policy",
  {
    attendanceStatus: text("attendance_status", {
      enum: ATTENDANCE_STATUSES,
    }).primaryKey(),
    deducts: integer("deducts", { mode: "boolean" }).notNull(),
  },
  (t) => [
    check(
      "deduction_policy_status_check",
      sql`${t.attendanceStatus} in ('present', 'absent', 'excused_leave', 'late_cancel')`,
    ),
    check("deduction_policy_deducts_check", sql`${t.deducts} in (0, 1)`),
  ],
);

export const attendance = sqliteTable(
  "attendance",
  {
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id),
    studentId: text("student_id")
      .notNull()
      .references(() => person.id),
    status: text("status", { enum: ATTENDANCE_STATUSES }).notNull(),
    checkedInAt: integer("checked_in_at", { mode: "timestamp" }),
    checkedOutAt: integer("checked_out_at", { mode: "timestamp" }),
    pickedUpBy: text("picked_up_by"),
    markedBy: text("marked_by").notNull(),
  },
  (t) => [
    uniqueIndex("attendance_lesson_student_unique").on(t.lessonId, t.studentId),
    check(
      "attendance_status_check",
      sql`${t.status} in ('present', 'absent', 'excused_leave', 'late_cancel')`,
    ),
    check(
      "attendance_checkout_check",
      sql`(${t.checkedOutAt} is null and ${t.pickedUpBy} is null) or (${t.checkedOutAt} is not null and ${t.pickedUpBy} is not null)`,
    ),
    check(
      "attendance_checkout_present_check",
      sql`${t.checkedOutAt} is null or ${t.status} = 'present'`,
    ),
    index("attendance_student_id_idx").on(t.studentId),
  ],
);

export const lessonFeedback = sqliteTable(
  "lesson_feedback",
  {
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id),
    studentId: text("student_id")
      .notNull()
      .references(() => person.id),
    contentCovered: text("content_covered").notNull(),
    homework: text("homework").notNull(),
    performanceNote: text("performance_note").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("lesson_feedback_lesson_student_unique").on(
      t.lessonId,
      t.studentId,
    ),
    index("lesson_feedback_student_created_at_idx").on(
      t.studentId,
      t.createdAt,
    ),
    check(
      "lesson_feedback_text_check",
      sql`length(trim(${t.contentCovered})) > 0 and length(trim(${t.homework})) > 0 and length(trim(${t.performanceNote})) > 0`,
    ),
  ],
);

export const pickupPerson = sqliteTable(
  "pickup_person",
  {
    studentId: text("student_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    relation: text("relation").notNull(),
  },
  (t) => [
    uniqueIndex("pickup_person_student_name_unique").on(t.studentId, t.name),
    index("pickup_person_student_id_idx").on(t.studentId),
    check(
      "pickup_person_text_check",
      sql`length(trim(${t.name})) > 0 and length(trim(${t.phone})) > 0 and length(trim(${t.relation})) > 0`,
    ),
  ],
);

export const entitlement = sqliteTable(
  "entitlement",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => person.id),
    kind: text("kind", { enum: ENTITLEMENT_KINDS }).notNull(),
    classTypeId: text("class_type_id").references(() => classType.id),
    creditsTotal: integer("credits_total"),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    priceId: text("price_id")
      .notNull()
      .references(() => price.id),
    status: text("status", { enum: ENTITLEMENT_STATUSES })
      .default("active")
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check(
      "entitlement_kind_check",
      sql`${t.kind} in ('package', 'subscription')`,
    ),
    check(
      "entitlement_status_check",
      sql`${t.status} in ('active', 'exhausted', 'expired', 'refunded')`,
    ),
    check(
      "entitlement_shape_check",
      sql`(${t.kind} = 'package' and ${t.classTypeId} is not null and ${t.creditsTotal} > 0 and typeof(${t.creditsTotal}) = 'integer' and ${t.validFrom} is null and ${t.validTo} is null) or (${t.kind} = 'subscription' and ${t.classTypeId} is not null and ${t.creditsTotal} is null and ${t.validFrom} is not null and ${t.validTo} is not null and date(${t.validFrom}, '+0 days') is not null and date(${t.validTo}, '+0 days') is not null and date(${t.validFrom}, '+0 days') = ${t.validFrom} and date(${t.validTo}, '+0 days') = ${t.validTo} and ${t.validFrom} <= ${t.validTo})`,
    ),
    index("entitlement_student_created_at_idx").on(t.studentId, t.createdAt),
    index("entitlement_student_kind_status_idx").on(
      t.studentId,
      t.kind,
      t.status,
    ),
    index("entitlement_class_type_id_idx").on(t.classTypeId),
    index("entitlement_price_id_idx").on(t.priceId),
  ],
);

export const payment = sqliteTable(
  "payment",
  {
    id: text("id").primaryKey(),
    entitlementId: text("entitlement_id")
      .notNull()
      .references(() => entitlement.id),
    priceId: text("price_id")
      .notNull()
      .references(() => price.id),
    guardianId: text("guardian_id")
      .notNull()
      .references(() => person.id),
    listAmountFen: integer("list_amount_fen").notNull(),
    discountFen: integer("discount_fen").default(0).notNull(),
    paidAmountFen: integer("paid_amount_fen").notNull(),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    receiptNo: text("receipt_no").notNull(),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check(
      "payment_amount_integer_check",
      sql`typeof(${t.listAmountFen}) = 'integer' and typeof(${t.discountFen}) = 'integer' and typeof(${t.paidAmountFen}) = 'integer'`,
    ),
    check(
      "payment_amount_identity_check",
      sql`${t.paidAmountFen} = ${t.listAmountFen} - ${t.discountFen}`,
    ),
    check(
      "payment_amount_sign_check",
      sql`(${t.listAmountFen} > 0 and ${t.discountFen} >= 0 and ${t.discountFen} < ${t.listAmountFen} and ${t.paidAmountFen} > 0) or (${t.listAmountFen} < 0 and ${t.discountFen} <= 0 and ${t.discountFen} >= ${t.listAmountFen} and ${t.paidAmountFen} < 0)`,
    ),
    check(
      "payment_method_check",
      sql`${t.method} in ('wechat', 'cash', 'other')`,
    ),
    check("payment_receipt_no_check", sql`length(trim(${t.receiptNo})) > 0`),
    uniqueIndex("payment_receipt_no_unique").on(t.receiptNo),
    uniqueIndex("payment_entitlement_purchase_unique")
      .on(t.entitlementId)
      .where(sql`${t.listAmountFen} >= 0`),
    uniqueIndex("payment_entitlement_refund_unique")
      .on(t.entitlementId)
      .where(sql`${t.listAmountFen} < 0`),
    index("payment_guardian_created_at_idx").on(t.guardianId, t.createdAt),
    index("payment_price_id_idx").on(t.priceId),
  ],
);

export const creditLedger = sqliteTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => person.id),
    entitlementId: text("entitlement_id").references(() => entitlement.id),
    delta: integer("delta").notNull(),
    kind: text("kind", { enum: CREDIT_LEDGER_KINDS }).notNull(),
    lessonId: text("lesson_id").references(() => lesson.id),
    reason: text("reason").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check(
      "credit_ledger_delta_check",
      sql`${t.delta} != 0 and typeof(${t.delta}) = 'integer'`,
    ),
    check(
      "credit_ledger_kind_check",
      sql`${t.kind} in ('purchase', 'attendance', 'adjustment', 'refund')`,
    ),
    check("credit_ledger_reason_check", sql`length(trim(${t.reason})) > 0`),
    index("credit_ledger_student_created_at_idx").on(t.studentId, t.createdAt),
    index("credit_ledger_entitlement_id_idx").on(t.entitlementId),
    index("credit_ledger_lesson_id_idx").on(t.lessonId),
    uniqueIndex("credit_ledger_attendance_unique")
      .on(t.lessonId, t.studentId)
      .where(sql`${t.kind} = 'attendance'`),
    uniqueIndex("credit_ledger_purchase_unique")
      .on(t.entitlementId)
      .where(sql`${t.kind} = 'purchase'`),
    uniqueIndex("credit_ledger_refund_unique")
      .on(t.entitlementId)
      .where(sql`${t.kind} = 'refund'`),
  ],
);

export const pendingAction = sqliteTable(
  "pending_action",
  {
    id: text("id").primaryKey(),
    endpointName: text("endpoint_name").notNull(),
    payloadJson: text("payload_json").notNull(),
    summary: text("summary").notNull(),
    status: text("status", { enum: PENDING_ACTION_STATUSES })
      .default("pending")
      .notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    resolvedBy: text("resolved_by"),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    resultJson: text("result_json"),
  },
  (t) => [
    check(
      "pending_action_status_check",
      sql`${t.status} in ('pending', 'executed', 'rejected', 'expired')`,
    ),
    check(
      "pending_action_time_check",
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
    check(
      "pending_action_resolution_check",
      sql`(${t.status} in ('pending', 'expired') and ${t.resolvedBy} is null and ${t.resolvedAt} is null) or (${t.status} in ('executed', 'rejected') and ${t.resolvedBy} is not null and ${t.resolvedAt} is not null)`,
    ),
    index("pending_action_status_created_at_idx").on(t.status, t.createdAt),
    index("pending_action_expires_at_idx").on(t.expiresAt),
  ],
);

export const pendingActionResolution = sqliteTable(
  "pending_action_resolution",
  {
    pendingActionId: text("pending_action_id")
      .primaryKey()
      .references(() => pendingAction.id, { onDelete: "cascade" }),
    claimedAt: integer("claimed_at", { mode: "timestamp" }).notNull(),
  },
);

// ARCHITECTURE.md §3.8 — append-only activity log, written by middleware on
// every successful mutating request. Human actors use their auth user id; the
// service account uses the stable id "agent".
export const activityLog = sqliteTable(
  "activity_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    summary: text("summary"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("activity_log_created_at_idx").on(t.createdAt)],
);
