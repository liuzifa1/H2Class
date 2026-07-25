import type { ZodType } from "zod";
import {
  attendanceCheckinInputSchema,
  attendanceCheckoutInputSchema,
  attendanceCheckoutOverrideInputSchema,
  attendanceListInputSchema,
  attendanceListOutputSchema,
  attendanceMutationOutputSchema,
  attendanceSchema,
  balancesGetInputSchema,
  balancesGetOutputSchema,
  creditLedgerEntrySchema,
  deductionPolicyGetInputSchema,
  deductionPolicyGetOutputSchema,
  deductionPolicySchema,
  deductionPolicySetInputSchema,
  leaveRequestInputSchema,
  ledgerAdjustmentCreateInputSchema,
  ledgerListInputSchema,
  ledgerListOutputSchema,
} from "./attendance";
import {
  classTypeSchema,
  classTypesCreateInputSchema,
  classTypesListInputSchema,
  classTypesListOutputSchema,
  classTypesUpdateInputSchema,
  priceSchema,
  pricesCurrentGetInputSchema,
  pricesListInputSchema,
  pricesListOutputSchema,
  pricesSetInputSchema,
} from "./catalog";
import {
  arrearsListInputSchema,
  arrearsListOutputSchema,
  entitlementsListInputSchema,
  entitlementsListOutputSchema,
  entitlementsPurchaseInputSchema,
  entitlementsPurchaseOutputSchema,
  paymentRefundQuoteSchema,
  paymentsListInputSchema,
  paymentsListOutputSchema,
  paymentsRefundInputSchema,
  paymentsRefundOutputSchema,
  paymentsRefundQuoteInputSchema,
} from "./billing";
import {
  draftsCreateInputSchema,
  draftsListInputSchema,
  draftsListOutputSchema,
  draftsMarkSentInputSchema,
  messageDraftSchema,
} from "./drafts";
import {
  feedbackCreateInputSchema,
  feedbackCreateOutputSchema,
  feedbackListInputSchema,
  feedbackListOutputSchema,
  pickupPersonsListInputSchema,
  pickupPersonsOutputSchema,
  pickupPersonsSetInputSchema,
} from "./feedback";
import { healthInputSchema, healthResponseSchema } from "./health";
import {
  guardianAccountSchema,
  guardianAccountsCreateInputSchema,
  myBalanceGetInputSchema,
  myBalanceGetOutputSchema,
  myFeedbackListInputSchema,
  myFeedbackListOutputSchema,
  myScheduleListInputSchema,
  myScheduleListOutputSchema,
  myStudentsListInputSchema,
  myStudentsListOutputSchema,
} from "./guardian";
import { meInputSchema, meResponseSchema } from "./me";
import {
  guardianLinkCreateInputSchema,
  guardianLinkSchema,
  guardianLinksListInputSchema,
  guardianLinksListOutputSchema,
  peopleCreateInputSchema,
  peopleDeleteInputSchema,
  peopleDeleteOutputSchema,
  peopleGetInputSchema,
  peopleListInputSchema,
  peopleListOutputSchema,
  peopleRoleGrantInputSchema,
  peopleRoleRevokeInputSchema,
  peopleUpdateInputSchema,
  personDetailSchema,
  personSchema,
} from "./people";
import {
  pendingActionSchema,
  pendingActionsCreateInputSchema,
  pendingActionsExecuteInputSchema,
  pendingActionsListInputSchema,
  pendingActionsListOutputSchema,
  pendingActionsRejectInputSchema,
} from "./pending-actions";
import {
  reportsBalancesInputSchema,
  reportsBalancesOutputSchema,
  reportsDailyInputSchema,
  reportsDailyOutputSchema,
  reportsIncomeInputSchema,
  reportsIncomeOutputSchema,
  reportsTeacherSettlementInputSchema,
  reportsTeacherSettlementOutputSchema,
  teacherRateSchema,
  teacherRatesListInputSchema,
  teacherRatesListOutputSchema,
  teacherRatesSetInputSchema,
} from "./reports";
import {
  availabilityExceptionSchema,
  availabilityExceptionSetInputSchema,
  availabilityGetInputSchema,
  availabilitySchema,
  availabilitySetInputSchema,
  closureDaySchema,
  closureDaysListInputSchema,
  closureDaysListOutputSchema,
  closureDaysSetInputSchema,
  enrollmentsAddInputSchema,
  enrollmentsRemoveInputSchema,
  enrollmentsRemoveOutputSchema,
  enrollmentSchema,
  freeSlotsFindInputSchema,
  freeSlotsFindOutputSchema,
  lessonMutationOutputSchema,
  lessonSchema,
  lessonsCancelInputSchema,
  lessonsBulkApplyInputSchema,
  lessonsBulkApplyOutputSchema,
  lessonsCreateInputSchema,
  lessonsCreateOutputSchema,
  lessonsGetInputSchema,
  lessonsListInputSchema,
  lessonsListOutputSchema,
  lessonsMoveInputSchema,
  termSchema,
  termsCreateInputSchema,
  termsListInputSchema,
  termsListOutputSchema,
} from "./scheduling";

export type EndpointDef = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  input: ZodType;
  output: ZodType;
  readonly: boolean;
  ownerOnly: boolean;
  autonomousWrite?: true;
  toolExposure?: "hidden";
};

export const endpoints = {
  health_get: {
    method: "GET",
    path: "/health",
    description: "Check whether the core API and its database are reachable.",
    input: healthInputSchema,
    output: healthResponseSchema,
    readonly: true,
    ownerOnly: false,
  },
  me_get: {
    method: "GET",
    path: "/me",
    description: "Get the authenticated principal id and granted roles.",
    input: meInputSchema,
    output: meResponseSchema,
    readonly: true,
    ownerOnly: false,
  },
  people_create: {
    method: "POST",
    path: "/people",
    description:
      "Create a person. Call when a new student, guardian, or teacher is mentioned and no matching person exists.",
    input: peopleCreateInputSchema,
    output: personSchema,
    readonly: false,
    ownerOnly: false,
  },
  people_update: {
    method: "PATCH",
    path: "/people/:id",
    description:
      "Update a person. Call when known contact, school, grade, name, or notes information changes.",
    input: peopleUpdateInputSchema,
    output: personSchema,
    readonly: false,
    ownerOnly: false,
  },
  people_get: {
    method: "GET",
    path: "/people/:id",
    description: "Get one person by id. Call when exact person details are needed.",
    input: peopleGetInputSchema,
    output: personDetailSchema,
    readonly: true,
    ownerOnly: false,
  },
  people_list: {
    method: "GET",
    path: "/people",
    description:
      "List people, optionally filtered by role or name search. Call before creating a person to avoid duplicates.",
    input: peopleListInputSchema,
    output: peopleListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  guardian_link_create: {
    method: "POST",
    path: "/guardian-links",
    description:
      "Link a guardian to a student. Call after both people exist and the guardian role is assigned.",
    input: guardianLinkCreateInputSchema,
    output: guardianLinkSchema,
    readonly: false,
    ownerOnly: false,
  },
  guardian_links_list: {
    method: "GET",
    path: "/guardian-links",
    description:
      "List guardian-to-student links, optionally filtered by either side. Call to resolve guardian recipients for linked-student follow-up.",
    input: guardianLinksListInputSchema,
    output: guardianLinksListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  guardian_accounts_create: {
    method: "POST",
    path: "/guardian-accounts",
    description:
      "Provision email/password credentials for an existing guardian person. This admin control-plane action is never available to the agent.",
    input: guardianAccountsCreateInputSchema,
    output: guardianAccountSchema,
    readonly: false,
    ownerOnly: true,
    toolExposure: "hidden",
  },
  people_role_grant: {
    method: "POST",
    path: "/people/:id/roles",
    description:
      "Grant a human role to a person. Owner confirmation is required before calling.",
    input: peopleRoleGrantInputSchema,
    output: personSchema,
    readonly: false,
    ownerOnly: true,
  },
  people_role_revoke: {
    method: "DELETE",
    path: "/people/:id/roles/:role",
    description:
      "Revoke a human role from a person. Owner confirmation is required before calling.",
    input: peopleRoleRevokeInputSchema,
    output: personSchema,
    readonly: false,
    ownerOnly: true,
  },
  people_delete: {
    method: "DELETE",
    path: "/people/:id",
    description:
      "Permanently delete a person and their role and guardian links. Owner confirmation is required before calling.",
    input: peopleDeleteInputSchema,
    output: peopleDeleteOutputSchema,
    readonly: false,
    ownerOnly: true,
  },
  class_types_create: {
    method: "POST",
    path: "/class-types",
    description:
      "Create a class type. Call when the center introduces a new lesson format or service category.",
    input: classTypesCreateInputSchema,
    output: classTypeSchema,
    readonly: false,
    ownerOnly: false,
  },
  class_types_update: {
    method: "PATCH",
    path: "/class-types/:id",
    description:
      "Update a class type's operational details or active state. Never use this to change a price.",
    input: classTypesUpdateInputSchema,
    output: classTypeSchema,
    readonly: false,
    ownerOnly: false,
  },
  class_types_list: {
    method: "GET",
    path: "/class-types",
    description:
      "List all class types, including inactive ones. Call when selecting or reviewing a lesson format.",
    input: classTypesListInputSchema,
    output: classTypesListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  prices_set: {
    method: "POST",
    path: "/prices",
    description:
      "Create an immutable price version for a class type. Call only after owner confirmation; never update an existing price.",
    input: pricesSetInputSchema,
    output: priceSchema,
    readonly: false,
    ownerOnly: true,
  },
  prices_list: {
    method: "GET",
    path: "/prices",
    description:
      "List immutable price-version history, optionally for one class type. Call when historical pricing is needed.",
    input: pricesListInputSchema,
    output: pricesListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  prices_current_get: {
    method: "GET",
    path: "/prices/current",
    description:
      "Get the current effective price for a class type. Always call this instead of guessing or reusing an old price.",
    input: pricesCurrentGetInputSchema,
    output: priceSchema,
    readonly: true,
    ownerOnly: false,
  },
  teacher_rates_set: {
    method: "POST",
    path: "/teacher-rates",
    description:
      "Create an immutable teacher/class-type pay-rate version. Owner confirmation is required; never update an existing rate.",
    input: teacherRatesSetInputSchema,
    output: teacherRateSchema,
    readonly: false,
    ownerOnly: true,
  },
  teacher_rates_list: {
    method: "GET",
    path: "/teacher-rates",
    description:
      "List immutable teacher pay-rate history, optionally filtered by teacher or class type. Call before explaining settlement arithmetic.",
    input: teacherRatesListInputSchema,
    output: teacherRatesListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  lessons_create: {
    method: "POST",
    path: "/lessons",
    description:
      "Book one lesson or a weekly series within a term. Provide all initial students; recurring creation skips center closure dates.",
    input: lessonsCreateInputSchema,
    output: lessonsCreateOutputSchema,
    readonly: false,
    ownerOnly: false,
  },
  lessons_bulk_apply: {
    method: "POST",
    path: "/lessons/bulk-apply",
    description:
      "Atomically apply one bounded set of explicit single lessons, enrollments, and Chinese notification drafts. Owner confirmation is required; if any lesson conflicts, none are created.",
    input: lessonsBulkApplyInputSchema,
    output: lessonsBulkApplyOutputSchema,
    readonly: false,
    ownerOnly: true,
  },
  lessons_move: {
    method: "PATCH",
    path: "/lessons/:id/move",
    description:
      "Move a scheduled lesson to a new Asia/Shanghai date and start minute. Conflict checks and notification drafts are atomic.",
    input: lessonsMoveInputSchema,
    output: lessonMutationOutputSchema,
    readonly: false,
    ownerOnly: false,
  },
  lessons_cancel: {
    method: "POST",
    path: "/lessons/:id/cancel",
    description:
      "Cancel a scheduled lesson without deleting it. Call when the lesson will not occur; notification drafts are created atomically.",
    input: lessonsCancelInputSchema,
    output: lessonMutationOutputSchema,
    readonly: false,
    ownerOnly: false,
  },
  lessons_get: {
    method: "GET",
    path: "/lessons/:id",
    description:
      "Get one lesson and its enrolled student ids. Call when exact booking details are needed.",
    input: lessonsGetInputSchema,
    output: lessonSchema,
    readonly: true,
    ownerOnly: false,
  },
  lessons_list: {
    method: "GET",
    path: "/lessons",
    description:
      "List lessons overlapping a UTC time range, optionally filtered by teacher or student. Call before planning schedule changes.",
    input: lessonsListInputSchema,
    output: lessonsListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  free_slots_find: {
    method: "GET",
    path: "/free-slots",
    description:
      "Find a teacher's usable free intervals on one Asia/Shanghai date after availability, exceptions, closures, existing lessons, and class duration are applied.",
    input: freeSlotsFindInputSchema,
    output: freeSlotsFindOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  enrollments_add: {
    method: "POST",
    path: "/lessons/:lessonId/enrollments",
    description:
      "Enroll one student in an existing lesson. Call only after checking the intended lesson; capacity and student conflicts are enforced by core.",
    input: enrollmentsAddInputSchema,
    output: enrollmentSchema,
    readonly: false,
    ownerOnly: false,
  },
  enrollments_remove: {
    method: "DELETE",
    path: "/lessons/:lessonId/enrollments/:studentId",
    description:
      "Remove one student's enrollment from a lesson. Call when correcting or changing that student's booking.",
    input: enrollmentsRemoveInputSchema,
    output: enrollmentsRemoveOutputSchema,
    readonly: false,
    ownerOnly: false,
  },
  drafts_create: {
    method: "POST",
    path: "/message-drafts",
    description:
      "Create a standalone Simplified-Chinese message draft for one person. Use for reminders not produced by another core mutation.",
    input: draftsCreateInputSchema,
    output: messageDraftSchema,
    readonly: false,
    ownerOnly: false,
    autonomousWrite: true,
  },
  drafts_list: {
    method: "GET",
    path: "/message-drafts",
    description:
      "List message drafts, optionally filtered by recipient, purpose, or status. Call to review the outbound queue.",
    input: draftsListInputSchema,
    output: draftsListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  drafts_mark_sent: {
    method: "POST",
    path: "/message-drafts/:id/mark-sent",
    description:
      "Mark a message draft sent after it has been relayed manually. Call only after the message was actually sent.",
    input: draftsMarkSentInputSchema,
    output: messageDraftSchema,
    readonly: false,
    ownerOnly: false,
  },
  attendance_checkin: {
    method: "POST",
    path: "/lessons/:lessonId/attendance",
    description:
      "Record one lesson's complete student attendance roster atomically. Core applies the current deduction policy and creates guardian drafts.",
    input: attendanceCheckinInputSchema,
    output: attendanceMutationOutputSchema,
    readonly: false,
    ownerOnly: false,
  },
  attendance_checkout: {
    method: "POST",
    path: "/lessons/:lessonId/attendance/check-out",
    description:
      "Record one present student's lesson check-out with the exact pickup name. If authorized pickup people are registered, core rejects an unregistered name.",
    input: attendanceCheckoutInputSchema,
    output: attendanceSchema,
    readonly: false,
    ownerOnly: false,
  },
  attendance_checkout_override: {
    method: "POST",
    path: "/lessons/:lessonId/attendance/check-out/override",
    description:
      "Override pickup authorization and check out one present student with an unregistered pickup name. Owner confirmation is required for this safety exception.",
    input: attendanceCheckoutOverrideInputSchema,
    output: attendanceSchema,
    readonly: false,
    ownerOnly: true,
  },
  attendance_list: {
    method: "GET",
    path: "/attendance",
    description:
      "List attendance records, optionally filtered by lesson or student. Call when reviewing attendance history.",
    input: attendanceListInputSchema,
    output: attendanceListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  feedback_create: {
    method: "POST",
    path: "/lessons/:lessonId/feedback",
    description:
      "Record one enrolled student's teacher feedback. Core atomically creates an unpolished guardian-facing Simplified-Chinese draft.",
    input: feedbackCreateInputSchema,
    output: feedbackCreateOutputSchema,
    readonly: false,
    ownerOnly: false,
  },
  feedback_list: {
    method: "GET",
    path: "/feedback",
    description:
      "List lesson feedback, optionally filtered by lesson or student. Call when reviewing academic history or preparing a parent update.",
    input: feedbackListInputSchema,
    output: feedbackListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  pickup_persons_set: {
    method: "PUT",
    path: "/students/:studentId/pickup-persons",
    description:
      "Replace one student's complete authorized-pickup list atomically. Use an empty list only when intentionally clearing all authorizations.",
    input: pickupPersonsSetInputSchema,
    output: pickupPersonsOutputSchema,
    readonly: false,
    ownerOnly: false,
  },
  pickup_persons_list: {
    method: "GET",
    path: "/students/:studentId/pickup-persons",
    description:
      "List one student's authorized pickup people. Call before check-out so the recorded pickup name exactly matches an authorization.",
    input: pickupPersonsListInputSchema,
    output: pickupPersonsOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  leave_request: {
    method: "POST",
    path: "/lessons/:lessonId/leave-requests",
    description:
      "Record an excused-leave attendance status ahead of a lesson. Core applies the current policy and creates guardian drafts atomically.",
    input: leaveRequestInputSchema,
    output: attendanceMutationOutputSchema,
    readonly: false,
    ownerOnly: false,
  },
  balances_get: {
    method: "GET",
    path: "/balances",
    description:
      "Get credit balances derived from SUM of append-only ledger entries, optionally for one student. Never calculate balances client-side.",
    input: balancesGetInputSchema,
    output: balancesGetOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  deduction_policy_get: {
    method: "GET",
    path: "/deduction-policy",
    description:
      "Get the current attendance-status credit-deduction policy. Call before explaining why attendance consumed a credit.",
    input: deductionPolicyGetInputSchema,
    output: deductionPolicyGetOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  deduction_policy_set: {
    method: "PUT",
    path: "/deduction-policy/:status",
    description:
      "Change whether one attendance status consumes a credit. Owner confirmation is required because this changes future money-equivalent behavior.",
    input: deductionPolicySetInputSchema,
    output: deductionPolicySchema,
    readonly: false,
    ownerOnly: true,
  },
  ledger_adjustment_create: {
    method: "POST",
    path: "/ledger/adjustments",
    description:
      "Append a reasoned manual credit adjustment. Owner confirmation is required; never edit or delete existing ledger rows.",
    input: ledgerAdjustmentCreateInputSchema,
    output: creditLedgerEntrySchema,
    readonly: false,
    ownerOnly: true,
  },
  ledger_list: {
    method: "GET",
    path: "/ledger",
    description:
      "List append-only credit-ledger entries with pagination and optional student or kind filters. Call for balance explanations and disputes.",
    input: ledgerListInputSchema,
    output: ledgerListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  entitlements_purchase: {
    method: "POST",
    path: "/entitlements/purchase",
    description:
      "Purchase a class package or trusteeship subscription from an exact price version. Owner confirmation is required; core derives every amount and writes the entitlement, payment, ledger entry, and receipt draft atomically.",
    input: entitlementsPurchaseInputSchema,
    output: entitlementsPurchaseOutputSchema,
    readonly: false,
    ownerOnly: true,
  },
  entitlements_list: {
    method: "GET",
    path: "/entitlements",
    description:
      "List entitlements with ledger-derived package balances, derived statuses, class and student names, and linked guardians. Call for renewal and balance decisions.",
    input: entitlementsListInputSchema,
    output: entitlementsListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  payments_list: {
    method: "GET",
    path: "/payments",
    description:
      "List append-only payment and refund rows, optionally filtered by student, guardian, or entitlement. This is the source of income truth.",
    input: paymentsListInputSchema,
    output: paymentsListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  payments_refund_quote: {
    method: "GET",
    path: "/payments/:paymentId/refund-quote",
    description:
      "Quote a package refund from its current remaining credits and original paid amount. Call immediately before proposing a refund and copy the optimistic values exactly.",
    input: paymentsRefundQuoteInputSchema,
    output: paymentRefundQuoteSchema,
    readonly: true,
    ownerOnly: false,
  },
  payments_refund: {
    method: "POST",
    path: "/payments/:paymentId/refund",
    description:
      "Refund all remaining package credits using a fresh core quote. Owner confirmation is required; stale expected values are rejected and all refund records commit atomically.",
    input: paymentsRefundInputSchema,
    output: paymentsRefundOutputSchema,
    readonly: false,
    ownerOnly: true,
  },
  arrears_list: {
    method: "GET",
    path: "/arrears",
    description:
      "List students whose total credit balance is zero or negative and who have a future lesson, including students with no ledger history. Call for renewal follow-up.",
    input: arrearsListInputSchema,
    output: arrearsListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  reports_teacher_settlement: {
    method: "GET",
    path: "/reports/teacher-settlement",
    description:
      "Report one teacher's attended lessons and historical rate arithmetic for an Asia/Shanghai month. A lesson counts once when any enrolled student's attendance is present, never once per student.",
    input: reportsTeacherSettlementInputSchema,
    output: reportsTeacherSettlementOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  reports_income: {
    method: "GET",
    path: "/reports/income",
    description:
      "Report signed payment and refund income for an Asia/Shanghai month, grouped by class type with gross, discount, and net integer-fen totals.",
    input: reportsIncomeInputSchema,
    output: reportsIncomeOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  reports_balances: {
    method: "GET",
    path: "/reports/balances",
    description:
      "Report per-student ledger-derived remaining credits and trusteeship subscription end dates. Call for a complete balance overview.",
    input: reportsBalancesInputSchema,
    output: reportsBalancesOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  reports_daily: {
    method: "GET",
    path: "/reports/daily",
    description:
      "Get the daily digest source: today's named lessons, yesterday's signed income, unsent draft count, and pending unexpired action count.",
    input: reportsDailyInputSchema,
    output: reportsDailyOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  my_students_list: {
    method: "GET",
    path: "/my/students",
    description:
      "List only the children linked to the signed-in guardian; no client-supplied person id is accepted.",
    input: myStudentsListInputSchema,
    output: myStudentsListOutputSchema,
    readonly: true,
    ownerOnly: false,
    toolExposure: "hidden",
  },
  my_schedule_list: {
    method: "GET",
    path: "/my/schedule",
    description:
      "List linked-child lessons and that child's attendance within a UTC range for the signed-in guardian.",
    input: myScheduleListInputSchema,
    output: myScheduleListOutputSchema,
    readonly: true,
    ownerOnly: false,
    toolExposure: "hidden",
  },
  my_balance_get: {
    method: "GET",
    path: "/my/balance",
    description:
      "Get core-derived package balances and entitlement validity for every child linked to the signed-in guardian.",
    input: myBalanceGetInputSchema,
    output: myBalanceGetOutputSchema,
    readonly: true,
    ownerOnly: false,
    toolExposure: "hidden",
  },
  my_feedback_list: {
    method: "GET",
    path: "/my/feedback",
    description:
      "List lesson feedback only for children linked to the signed-in guardian.",
    input: myFeedbackListInputSchema,
    output: myFeedbackListOutputSchema,
    readonly: true,
    ownerOnly: false,
    toolExposure: "hidden",
  },
  pending_actions_create: {
    method: "POST",
    path: "/pending-actions",
    description:
      "Create an owner-confirmation proposal after validating an owner-only endpoint payload.",
    input: pendingActionsCreateInputSchema,
    output: pendingActionSchema,
    readonly: false,
    ownerOnly: false,
    toolExposure: "hidden",
  },
  pending_actions_list: {
    method: "GET",
    path: "/pending-actions",
    description:
      "List owner-confirmation proposals with pending actions first and exact stored payloads.",
    input: pendingActionsListInputSchema,
    output: pendingActionsListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  pending_actions_execute: {
    method: "POST",
    path: "/pending-actions/:id/execute",
    description:
      "Execute one stored pending action under owner authority. The request body cannot change its payload.",
    input: pendingActionsExecuteInputSchema,
    output: pendingActionSchema,
    readonly: false,
    ownerOnly: true,
    toolExposure: "hidden",
  },
  pending_actions_reject: {
    method: "POST",
    path: "/pending-actions/:id/reject",
    description: "Reject one pending owner-confirmation proposal, optionally with a reason.",
    input: pendingActionsRejectInputSchema,
    output: pendingActionSchema,
    readonly: false,
    ownerOnly: true,
    toolExposure: "hidden",
  },
  availability_set: {
    method: "PUT",
    path: "/teachers/:teacherId/availability",
    description:
      "Replace a teacher's complete weekly availability pattern. Call when their recurring local-time working hours change.",
    input: availabilitySetInputSchema,
    output: availabilitySchema,
    readonly: false,
    ownerOnly: false,
  },
  availability_get: {
    method: "GET",
    path: "/teachers/:teacherId/availability",
    description:
      "Get a teacher's weekly pattern and dated exceptions. Call before proposing or checking lesson times.",
    input: availabilityGetInputSchema,
    output: availabilitySchema,
    readonly: true,
    ownerOnly: false,
  },
  availability_exception_set: {
    method: "PUT",
    path: "/teachers/:teacherId/availability-exceptions/:date",
    description:
      "Set a teacher's availability override for one Asia/Shanghai local date, optionally limited to one interval.",
    input: availabilityExceptionSetInputSchema,
    output: availabilityExceptionSchema,
    readonly: false,
    ownerOnly: false,
  },
  closure_days_set: {
    method: "PUT",
    path: "/closure-days/:date",
    description:
      "Set a center closure day by local date. Call for public holidays or planned center closures; repeating a date updates its reason.",
    input: closureDaysSetInputSchema,
    output: closureDaySchema,
    readonly: false,
    ownerOnly: false,
  },
  closure_days_list: {
    method: "GET",
    path: "/closure-days",
    description:
      "List center closure dates. Call before generating recurring lessons or offering dates.",
    input: closureDaysListInputSchema,
    output: closureDaysListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
  terms_create: {
    method: "POST",
    path: "/terms",
    description:
      "Create a named term with inclusive Asia/Shanghai local start and end dates. Call before term-bound recurring scheduling.",
    input: termsCreateInputSchema,
    output: termSchema,
    readonly: false,
    ownerOnly: false,
  },
  terms_list: {
    method: "GET",
    path: "/terms",
    description:
      "List terms in date order. Call when selecting bounds for seasonal or recurring lessons.",
    input: termsListInputSchema,
    output: termsListOutputSchema,
    readonly: true,
    ownerOnly: false,
  },
} as const satisfies Record<string, EndpointDef>;

export type EndpointName = keyof typeof endpoints;
export type ProposalEndpointName = {
  [Name in EndpointName]: (typeof endpoints)[Name]["ownerOnly"] extends true
    ? (typeof endpoints)[Name] extends { toolExposure: "hidden" }
      ? never
      : Name
    : never;
}[EndpointName];
