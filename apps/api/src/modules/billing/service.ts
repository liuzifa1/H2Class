import type {
  ArrearsListInput,
  ArrearsListOutput,
  CreditLedgerEntry,
  Entitlement,
  EntitlementsListInput,
  EntitlementsListOutput,
  EntitlementsPurchaseInput,
  EntitlementsPurchaseOutput,
  MessageDraft,
  Payment,
  PaymentRefundQuote,
  PaymentsListInput,
  PaymentsListOutput,
  PaymentsRefundInput,
  PaymentsRefundOutput,
  PaymentsRefundQuoteInput,
} from "@h2class/shared";
import { and, asc, desc, eq, gt, inArray, sql, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Principal } from "../../auth/types";
import { executeMutationPlan, type MutationPlan } from "../../db/mutation-plan";
import {
  classType,
  creditLedger,
  enrollment,
  entitlement,
  guardianStudent,
  lesson,
  messageDraft,
  payment,
  person,
  price,
} from "../../db/schema";
import { utcToShanghaiLocalParts } from "../../time/asia-shanghai";

type Database = ReturnType<typeof drizzle>;
type BillingErrorCode =
  | "amount_too_large"
  | "discount_exceeds_list_amount"
  | "duplicate_receipt_no"
  | "guardian_not_linked"
  | "invalid_entitlement_kind"
  | "invalid_subscription_period"
  | "nothing_to_refund"
  | "paid_amount_required"
  | "payment_already_refunded"
  | "payment_not_found"
  | "price_not_found"
  | "refund_quote_stale"
  | "student_not_found"
  | "subscription_refund_unsupported";

export type BillingServiceError = {
  kind: "billing_service_error";
  code: BillingErrorCode;
  status: 400 | 404 | 409;
};

const fail = (
  code: BillingErrorCode,
  status: BillingServiceError["status"] = 400,
): never => {
  throw { kind: "billing_service_error", code, status } satisfies BillingServiceError;
};

export const isBillingServiceError = (
  error: unknown,
): error is BillingServiceError =>
  typeof error === "object" &&
  error !== null &&
  Reflect.get(error, "kind") === "billing_service_error";

const entitlementColumns = {
  id: entitlement.id,
  studentId: entitlement.studentId,
  studentName: person.name,
  kind: entitlement.kind,
  classTypeId: entitlement.classTypeId,
  classTypeName: classType.name,
  creditsTotal: entitlement.creditsTotal,
  validFrom: entitlement.validFrom,
  validTo: entitlement.validTo,
  priceId: entitlement.priceId,
  storedStatus: entitlement.status,
  createdAt: entitlement.createdAt,
};

type EntitlementRow = {
  id: string;
  studentId: string;
  studentName: string;
  kind: "package" | "subscription";
  classTypeId: string | null;
  classTypeName: string | null;
  creditsTotal: number | null;
  validFrom: string | null;
  validTo: string | null;
  priceId: string;
  storedStatus: "active" | "exhausted" | "expired" | "refunded";
  createdAt: Date;
};

const paymentColumns = {
  id: payment.id,
  entitlementId: payment.entitlementId,
  priceId: payment.priceId,
  guardianId: payment.guardianId,
  listAmountFen: payment.listAmountFen,
  discountFen: payment.discountFen,
  paidAmountFen: payment.paidAmountFen,
  method: payment.method,
  receiptNo: payment.receiptNo,
  note: payment.note,
  createdBy: payment.createdBy,
  createdAt: payment.createdAt,
};

type PaymentRow = typeof payment.$inferSelect;

const serializePayment = (row: PaymentRow): Payment => ({
  id: row.id,
  entitlementId: row.entitlementId,
  priceId: row.priceId,
  guardianId: row.guardianId,
  list_amount_fen: row.listAmountFen,
  discount_fen: row.discountFen,
  paid_amount_fen: row.paidAmountFen,
  method: row.method,
  receiptNo: row.receiptNo,
  note: row.note,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

const serializeLedger = (
  row: typeof creditLedger.$inferInsert & { createdAt: Date },
): CreditLedgerEntry => ({
  id: row.id,
  studentId: row.studentId,
  entitlementId: row.entitlementId ?? null,
  delta: row.delta,
  kind: row.kind,
  lessonId: row.lessonId ?? null,
  reason: row.reason,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

const serializeDraft = (
  row: typeof messageDraft.$inferInsert & { createdAt: Date },
): MessageDraft => ({
  id: row.id,
  personId: row.personId,
  purpose: row.purpose,
  text: row.text,
  status: row.status ?? "draft",
  createdAt: row.createdAt.toISOString(),
  sentAt: row.sentAt?.toISOString() ?? null,
});

const guardianIdsForStudents = async (db: Database, studentIds: string[]) => {
  const result = new Map<string, string[]>();
  if (studentIds.length === 0) return result;
  const rows = await db
    .select({
      studentId: guardianStudent.studentId,
      guardianId: guardianStudent.guardianId,
    })
    .from(guardianStudent)
    .where(inArray(guardianStudent.studentId, studentIds))
    .orderBy(guardianStudent.studentId, guardianStudent.guardianId);
  for (const row of rows) {
    const ids = result.get(row.studentId) ?? [];
    ids.push(row.guardianId);
    result.set(row.studentId, ids);
  }
  return result;
};

const derivedEntitlement = (
  row: EntitlementRow,
  guardianIds: string[],
  remainingCredits: number | null,
  today = utcToShanghaiLocalParts(new Date()).date,
): Entitlement => {
  const status = row.storedStatus === "refunded"
    ? "refunded" as const
    : row.kind === "package"
      ? (remainingCredits ?? 0) <= 0
        ? "exhausted" as const
        : "active" as const
      : row.validTo !== null && row.validTo < today
        ? "expired" as const
        : "active" as const;
  return {
    id: row.id,
    studentId: row.studentId,
    studentName: row.studentName,
    guardianIds,
    kind: row.kind,
    classTypeId: row.classTypeId,
    classTypeName: row.classTypeName,
    creditsTotal: row.creditsTotal,
    remainingCredits: row.kind === "package" ? (remainingCredits ?? 0) : null,
    validFrom: row.validFrom,
    validTo: row.validTo,
    priceId: row.priceId,
    status,
    createdAt: row.createdAt.toISOString(),
  };
};

const formatFen = (amountFen: number) => {
  const sign = amountFen < 0 ? "-" : "";
  const absolute = Math.abs(amountFen);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
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

const billingWriteFailure = (error: unknown): never => {
  const message = errorText(error);
  if (
    message.includes("payment_receipt_no_unique") ||
    message.includes("payment.receipt_no")
  ) {
    fail("duplicate_receipt_no");
  }
  if (
    message.includes("payment_entitlement_refund_unique") ||
    message.includes("entitlement_immutable")
  ) {
    fail("payment_already_refunded", 409);
  }
  if (
    message.includes("refund_quote_stale") ||
    message.includes("credit_ledger_refund_unique")
  ) {
    fail("refund_quote_stale", 409);
  }
  if (
    message.includes("invalid_entitlement_target") ||
    message.includes("invalid_payment_target") ||
    message.includes("invalid_purchase_ledger_entry")
  ) {
    fail("invalid_entitlement_kind");
  }
  throw error;
};

const loadPurchaseContext = async (
  db: Database,
  input: EntitlementsPurchaseInput,
) => {
  const [student] = await db
    .select({ id: person.id, name: person.name })
    .from(person)
    .where(eq(person.id, input.studentId));
  if (student === undefined) return fail("student_not_found", 404);
  const [priceRow] = await db
    .select({
      id: price.id,
      classTypeId: price.classTypeId,
      unitAmountFen: price.unitAmountFen,
      classTypeName: classType.name,
      category: classType.category,
    })
    .from(price)
    .innerJoin(classType, eq(classType.id, price.classTypeId))
    .where(eq(price.id, input.priceId));
  if (priceRow === undefined) return fail("price_not_found", 404);
  const [link] = await db
    .select({ guardianId: guardianStudent.guardianId })
    .from(guardianStudent)
    .where(
      and(
        eq(guardianStudent.guardianId, input.guardianId),
        eq(guardianStudent.studentId, input.studentId),
      ),
    );
  if (link === undefined) fail("guardian_not_linked");
  if (
    (input.kind === "subscription" && priceRow.category !== "托管") ||
    (input.kind === "package" && priceRow.category === "托管")
  ) {
    fail("invalid_entitlement_kind");
  }
  if (input.kind === "subscription" && input.validFrom > input.validTo) {
    fail("invalid_subscription_period");
  }
  return { student, price: priceRow };
};

export const preparePurchaseEntitlement = async (
  d1: D1Database,
  principal: Principal,
  input: EntitlementsPurchaseInput,
): Promise<MutationPlan<EntitlementsPurchaseOutput>> => {
  const db = drizzle(d1);
  const context = await loadPurchaseContext(db, input);
  const multiplier = input.kind === "package" ? input.creditsTotal : 1;
  if (
    !Number.isSafeInteger(context.price.unitAmountFen) ||
    !Number.isSafeInteger(multiplier)
  ) {
    fail("amount_too_large");
  }
  const exactListAmountFen =
    BigInt(context.price.unitAmountFen) * BigInt(multiplier);
  if (exactListAmountFen > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("amount_too_large");
  }
  const listAmountFen = Number(exactListAmountFen);
  if (
    input.kind === "package" &&
    exactListAmountFen * BigInt(input.creditsTotal) >
      BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    fail("amount_too_large");
  }
  if (input.discount_fen > listAmountFen) fail("discount_exceeds_list_amount");
  const paidAmountFen = listAmountFen - input.discount_fen;
  if (paidAmountFen <= 0) fail("paid_amount_required");
  const createdAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const entitlementId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const draftId = crypto.randomUUID();
  const guardianIds = await guardianIdsForStudents(db, [input.studentId]);
  const entitlementValues: typeof entitlement.$inferInsert = {
    id: entitlementId,
    studentId: input.studentId,
    kind: input.kind,
    classTypeId: context.price.classTypeId,
    creditsTotal: input.kind === "package" ? input.creditsTotal : null,
    validFrom: input.kind === "subscription" ? input.validFrom : null,
    validTo: input.kind === "subscription" ? input.validTo : null,
    priceId: input.priceId,
    status: "active",
    createdAt,
  };
  const paymentValues: PaymentRow = {
    id: paymentId,
    entitlementId,
    priceId: input.priceId,
    guardianId: input.guardianId,
    listAmountFen,
    discountFen: input.discount_fen,
    paidAmountFen,
    method: input.method,
    receiptNo: input.receiptNo.trim(),
    note: input.note?.trim() ?? null,
    createdBy: principal.id,
    createdAt,
  };
  const ledgerValues: (typeof creditLedger.$inferInsert & { createdAt: Date }) | null =
    input.kind === "package"
      ? {
          id: crypto.randomUUID(),
          studentId: input.studentId,
          entitlementId,
          delta: input.creditsTotal,
          kind: "purchase",
          lessonId: null,
          reason: `${context.price.classTypeName}${input.creditsTotal}课时包购买`,
          createdBy: principal.id,
          createdAt,
        }
      : null;
  const purchaseText = input.kind === "package"
    ? `已为${context.student.name}办理${context.price.classTypeName}${input.creditsTotal}课时包，实付¥${formatFen(paidAmountFen)}，收据号${paymentValues.receiptNo}。`
    : `已为${context.student.name}办理${context.price.classTypeName}订阅（${input.validFrom}至${input.validTo}），实付¥${formatFen(paidAmountFen)}，收据号${paymentValues.receiptNo}。`;
  const draftValues: typeof messageDraft.$inferInsert & { createdAt: Date } = {
    id: draftId,
    personId: input.guardianId,
    purpose: "payment_receipt_guardian",
    text: purchaseText,
    status: "draft",
    createdAt,
    sentAt: null,
  };
  const row: EntitlementRow = {
    id: entitlementId,
    studentId: input.studentId,
    studentName: context.student.name,
    kind: input.kind,
    classTypeId: context.price.classTypeId,
    classTypeName: context.price.classTypeName,
    creditsTotal: input.kind === "package" ? input.creditsTotal : null,
    validFrom: input.kind === "subscription" ? input.validFrom : null,
    validTo: input.kind === "subscription" ? input.validTo : null,
    priceId: input.priceId,
    storedStatus: "active",
    createdAt,
  };
  const statements = ledgerValues === null
    ? [
        db.insert(entitlement).values(entitlementValues),
        db.insert(payment).values(paymentValues),
        db.insert(messageDraft).values(draftValues),
      ] as const
    : [
        db.insert(entitlement).values(entitlementValues),
        db.insert(payment).values(paymentValues),
        db.insert(creditLedger).values(ledgerValues),
        db.insert(messageDraft).values(draftValues),
      ] as const;
  return {
    statements,
    result: {
      entitlement: derivedEntitlement(
        row,
        guardianIds.get(input.studentId) ?? [],
        input.kind === "package" ? input.creditsTotal : null,
      ),
      payment: serializePayment(paymentValues),
      ledgerEntry: ledgerValues === null ? null : serializeLedger(ledgerValues),
      draft: serializeDraft(draftValues),
    },
    mapError: billingWriteFailure,
  };
};

export const purchaseEntitlement = async (
  d1: D1Database,
  principal: Principal,
  input: EntitlementsPurchaseInput,
): Promise<EntitlementsPurchaseOutput> => executeMutationPlan(
  d1,
  await preparePurchaseEntitlement(d1, principal, input),
);

export const listEntitlements = async (
  d1: D1Database,
  _principal: Principal,
  input: EntitlementsListInput,
): Promise<EntitlementsListOutput> => {
  const db = drizzle(d1);
  const rows = await db
    .select(entitlementColumns)
    .from(entitlement)
    .innerJoin(person, eq(person.id, entitlement.studentId))
    .leftJoin(classType, eq(classType.id, entitlement.classTypeId))
    .where(
      and(
        input.studentId === undefined
          ? undefined
          : eq(entitlement.studentId, input.studentId),
        input.kind === undefined ? undefined : eq(entitlement.kind, input.kind),
      ),
    )
    .orderBy(desc(entitlement.createdAt), desc(entitlement.id));
  const ids = rows.map(({ id }) => id);
  const balanceRows = ids.length === 0
    ? []
    : await db
        .select({ entitlementId: creditLedger.entitlementId, balance: sum(creditLedger.delta) })
        .from(creditLedger)
        .where(inArray(creditLedger.entitlementId, ids))
        .groupBy(creditLedger.entitlementId);
  const balances = new Map(
    balanceRows.map(({ entitlementId, balance }) => [
      entitlementId,
      Number(balance ?? 0),
    ]),
  );
  const guardians = await guardianIdsForStudents(
    db,
    [...new Set(rows.map(({ studentId }) => studentId))],
  );
  return {
    entitlements: rows.map((row) =>
      derivedEntitlement(
        row,
        guardians.get(row.studentId) ?? [],
        row.kind === "package" ? (balances.get(row.id) ?? 0) : null,
      ),
    ),
  };
};

export const listPayments = async (
  d1: D1Database,
  _principal: Principal,
  input: PaymentsListInput,
): Promise<PaymentsListOutput> => {
  const rows = await drizzle(d1)
    .select(paymentColumns)
    .from(payment)
    .innerJoin(entitlement, eq(entitlement.id, payment.entitlementId))
    .where(
      and(
        input.studentId === undefined
          ? undefined
          : eq(entitlement.studentId, input.studentId),
        input.guardianId === undefined
          ? undefined
          : eq(payment.guardianId, input.guardianId),
        input.entitlementId === undefined
          ? undefined
          : eq(payment.entitlementId, input.entitlementId),
      ),
    )
    .orderBy(desc(payment.createdAt), desc(payment.id));
  return { payments: rows.map(serializePayment) };
};

type RefundContext = {
  originalPayment: PaymentRow;
  entitlement: EntitlementRow;
  guardianIds: string[];
  remainingCredits: number;
};

const loadRefundContext = async (
  db: Database,
  paymentId: string,
): Promise<RefundContext> => {
  const [row] = await db
    .select({
      ...paymentColumns,
      studentId: entitlement.studentId,
      studentName: person.name,
      entitlementKind: entitlement.kind,
      classTypeId: entitlement.classTypeId,
      classTypeName: classType.name,
      creditsTotal: entitlement.creditsTotal,
      validFrom: entitlement.validFrom,
      validTo: entitlement.validTo,
      entitlementPriceId: entitlement.priceId,
      entitlementStatus: entitlement.status,
      entitlementCreatedAt: entitlement.createdAt,
    })
    .from(payment)
    .innerJoin(entitlement, eq(entitlement.id, payment.entitlementId))
    .innerJoin(person, eq(person.id, entitlement.studentId))
    .leftJoin(classType, eq(classType.id, entitlement.classTypeId))
    .where(and(eq(payment.id, paymentId), sql`${payment.listAmountFen} >= 0`));
  if (row === undefined) return fail("payment_not_found", 404);
  if (row.entitlementKind === "subscription") {
    fail("subscription_refund_unsupported");
  }
  if (row.entitlementStatus === "refunded") {
    fail("payment_already_refunded", 409);
  }
  const [balanceRow] = await db
    .select({ balance: sum(creditLedger.delta) })
    .from(creditLedger)
    .where(eq(creditLedger.entitlementId, row.entitlementId));
  const remainingCredits = Number(balanceRow?.balance ?? 0);
  if (remainingCredits <= 0 || row.creditsTotal === null) fail("nothing_to_refund");
  const guardianMap = await guardianIdsForStudents(db, [row.studentId]);
  return {
    originalPayment: {
      id: row.id,
      entitlementId: row.entitlementId,
      priceId: row.priceId,
      guardianId: row.guardianId,
      listAmountFen: row.listAmountFen,
      discountFen: row.discountFen,
      paidAmountFen: row.paidAmountFen,
      method: row.method,
      receiptNo: row.receiptNo,
      note: row.note,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    },
    entitlement: {
      id: row.entitlementId,
      studentId: row.studentId,
      studentName: row.studentName,
      kind: row.entitlementKind,
      classTypeId: row.classTypeId,
      classTypeName: row.classTypeName,
      creditsTotal: row.creditsTotal,
      validFrom: row.validFrom,
      validTo: row.validTo,
      priceId: row.entitlementPriceId,
      storedStatus: row.entitlementStatus,
      createdAt: row.entitlementCreatedAt,
    },
    guardianIds: guardianMap.get(row.studentId) ?? [],
    remainingCredits,
  };
};

const quoteFromContext = (
  context: RefundContext,
  quotedAt: Date,
): PaymentRefundQuote => {
  const creditsTotal = context.entitlement.creditsTotal;
  if (creditsTotal === null) return fail("subscription_refund_unsupported");
  const proportionalFloor = (amountFen: number) => {
    if (
      !Number.isSafeInteger(amountFen) ||
      !Number.isSafeInteger(context.remainingCredits) ||
      !Number.isSafeInteger(creditsTotal) ||
      creditsTotal <= 0
    ) {
      fail("amount_too_large");
    }
    const exact =
      BigInt(amountFen) * BigInt(context.remainingCredits) /
      BigInt(creditsTotal);
    if (exact > BigInt(Number.MAX_SAFE_INTEGER)) fail("amount_too_large");
    return Number(exact);
  };
  const refundListAmountFen = proportionalFloor(
    context.originalPayment.listAmountFen,
  );
  const refundAmountFen = proportionalFloor(
    context.originalPayment.paidAmountFen,
  );
  if (refundAmountFen <= 0) fail("nothing_to_refund");
  return {
    paymentId: context.originalPayment.id,
    entitlementId: context.entitlement.id,
    studentId: context.entitlement.studentId,
    guardianId: context.originalPayment.guardianId,
    remainingCredits: context.remainingCredits,
    refund_list_amount_fen: refundListAmountFen,
    refund_discount_fen: refundListAmountFen - refundAmountFen,
    refund_amount_fen: refundAmountFen,
    quotedAt: quotedAt.toISOString(),
  };
};

export const quotePaymentRefund = async (
  d1: D1Database,
  _principal: Principal,
  input: PaymentsRefundQuoteInput,
): Promise<PaymentRefundQuote> => {
  const db = drizzle(d1);
  const quotedAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  return quoteFromContext(await loadRefundContext(db, input.paymentId), quotedAt);
};

export const prepareRefundPayment = async (
  d1: D1Database,
  principal: Principal,
  input: PaymentsRefundInput,
): Promise<MutationPlan<PaymentsRefundOutput>> => {
  const db = drizzle(d1);
  const createdAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const context = await loadRefundContext(db, input.paymentId);
  const quote = quoteFromContext(context, createdAt);
  if (
    input.expectedRemainingCredits !== quote.remainingCredits ||
    input.expected_refund_amount_fen !== quote.refund_amount_fen
  ) {
    fail("refund_quote_stale", 409);
  }
  const paymentValues: PaymentRow = {
    id: crypto.randomUUID(),
    entitlementId: context.entitlement.id,
    priceId: context.originalPayment.priceId,
    guardianId: context.originalPayment.guardianId,
    listAmountFen: -quote.refund_list_amount_fen,
    discountFen: -quote.refund_discount_fen,
    paidAmountFen: -quote.refund_amount_fen,
    method: input.method,
    receiptNo: input.refundReceiptNo.trim(),
    note: input.reason.trim(),
    createdBy: principal.id,
    createdAt,
  };
  const ledgerValues: typeof creditLedger.$inferInsert & { createdAt: Date } = {
    id: crypto.randomUUID(),
    studentId: context.entitlement.studentId,
    entitlementId: context.entitlement.id,
    delta: -quote.remainingCredits,
    kind: "refund",
    lessonId: null,
    reason: `退费：${input.reason.trim()}`,
    createdBy: principal.id,
    createdAt,
  };
  const draftValues: typeof messageDraft.$inferInsert & { createdAt: Date } = {
    id: crypto.randomUUID(),
    personId: context.originalPayment.guardianId,
    purpose: "payment_refund_guardian",
    text: `${context.entitlement.studentName}的${context.entitlement.classTypeName ?? "课程"}课时包已退剩余${quote.remainingCredits}课时，退款¥${formatFen(quote.refund_amount_fen)}，退款收据号${paymentValues.receiptNo}。原因：${input.reason.trim()}。`,
    status: "draft",
    createdAt,
    sentAt: null,
  };
  return {
    statements: [
      db.insert(payment).values(paymentValues),
      db.insert(creditLedger).values(ledgerValues),
      db
        .update(entitlement)
        .set({ status: "refunded" })
        .where(
          and(
            eq(entitlement.id, context.entitlement.id),
            eq(entitlement.status, "active"),
          ),
        ),
      db.insert(messageDraft).values(draftValues),
    ],
    result: {
      quote,
      entitlement: derivedEntitlement(
        { ...context.entitlement, storedStatus: "refunded" },
        context.guardianIds,
        0,
      ),
      payment: serializePayment(paymentValues),
      ledgerEntry: serializeLedger(ledgerValues),
      draft: serializeDraft(draftValues),
    },
    mapError: billingWriteFailure,
  };
};

export const refundPayment = async (
  d1: D1Database,
  principal: Principal,
  input: PaymentsRefundInput,
): Promise<PaymentsRefundOutput> => executeMutationPlan(
  d1,
  await prepareRefundPayment(d1, principal, input),
);

export const listArrears = async (
  d1: D1Database,
  _principal: Principal,
  _input: ArrearsListInput,
): Promise<ArrearsListOutput> => {
  const db = drizzle(d1);
  const futureRows = await db
    .select({
      studentId: enrollment.studentId,
      studentName: person.name,
      startAt: lesson.startAt,
    })
    .from(enrollment)
    .innerJoin(lesson, eq(lesson.id, enrollment.lessonId))
    .innerJoin(person, eq(person.id, enrollment.studentId))
    .where(
      and(
        eq(lesson.status, "scheduled"),
        gt(lesson.startAt, new Date()),
        sql`not exists (
          select 1
          from ${entitlement}
          where ${entitlement.studentId} = ${enrollment.studentId}
            and ${entitlement.kind} = 'subscription'
            and ${entitlement.status} = 'active'
            and ${entitlement.classTypeId} = ${lesson.classTypeId}
            and date(${lesson.startAt}, 'unixepoch', '+8 hours')
              between ${entitlement.validFrom} and ${entitlement.validTo}
        )`,
      ),
    )
    .orderBy(asc(lesson.startAt), asc(enrollment.studentId));
  const earliest = new Map<
    string,
    { studentId: string; studentName: string; startAt: Date }
  >();
  for (const row of futureRows) {
    if (!earliest.has(row.studentId)) earliest.set(row.studentId, row);
  }
  const studentIds = [...earliest.keys()];
  if (studentIds.length === 0) return { arrears: [] };
  const balanceRows = await db
    .select({ studentId: creditLedger.studentId, balance: sum(creditLedger.delta) })
    .from(creditLedger)
    .where(inArray(creditLedger.studentId, studentIds))
    .groupBy(creditLedger.studentId);
  const balances = new Map(
    balanceRows.map(({ studentId, balance }) => [studentId, Number(balance ?? 0)]),
  );
  const guardians = await guardianIdsForStudents(db, studentIds);
  return {
    arrears: [...earliest.values()]
      .map((row) => ({
        studentId: row.studentId,
        studentName: row.studentName,
        balance: balances.get(row.studentId) ?? 0,
        guardianIds: guardians.get(row.studentId) ?? [],
        earliestFutureLessonAt: row.startAt.toISOString(),
      }))
      .filter(({ balance }) => balance <= 0),
  };
};
