import { z } from "zod";
import { creditLedgerEntrySchema } from "./attendance";
import { messageDraftSchema } from "./drafts";

const studentIdSchema = z.uuid().describe("Student person UUID.");
const guardianIdSchema = z.uuid().describe("Guardian person UUID.");
const classTypeIdSchema = z.uuid().describe("Class type UUID.");
const entitlementIdSchema = z.uuid().describe("Entitlement UUID.");
const paymentIdSchema = z.uuid().describe("Payment UUID.");
const priceIdSchema = z.uuid().describe("Exact immutable price-version UUID sold at.");
const receiptNoSchema = z
  .string()
  .min(1)
  .regex(/\S/, "Must contain non-whitespace text.")
  .describe("Unique receipt number.");
const moneyFenSchema = z
  .number()
  .int()
  .describe("Signed amount in integer fen; never floating-point currency.");
const nonnegativeMoneyFenSchema = moneyFenSchema
  .nonnegative()
  .describe("Non-negative amount in integer fen; never floating-point currency.");
const localDateSchema = z
  .iso.date()
  .describe("Asia/Shanghai local calendar date in YYYY-MM-DD form.");

export const entitlementKindSchema = z.enum(["package", "subscription"]);
export const entitlementStatusSchema = z.enum([
  "active",
  "exhausted",
  "expired",
  "refunded",
]);
export const paymentMethodSchema = z.enum(["wechat", "cash", "other"]);

export const entitlementSchema = z.object({
  id: entitlementIdSchema,
  studentId: studentIdSchema,
  studentName: z.string().min(1),
  guardianIds: z.array(guardianIdSchema),
  kind: entitlementKindSchema,
  classTypeId: classTypeIdSchema.nullable(),
  classTypeName: z.string().min(1).nullable(),
  creditsTotal: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("Purchased package credits; null for subscriptions."),
  remainingCredits: z
    .number()
    .int()
    .nullable()
    .describe("Ledger-derived package balance; null for subscriptions."),
  validFrom: localDateSchema.nullable(),
  validTo: localDateSchema.nullable(),
  priceId: priceIdSchema,
  status: entitlementStatusSchema.describe(
    "Read-time status derived from refund state, ledger balance, and validity dates.",
  ),
  createdAt: z.iso.datetime().describe("UTC creation timestamp."),
});

export const paymentSchema = z.object({
  id: paymentIdSchema,
  entitlementId: entitlementIdSchema,
  priceId: priceIdSchema,
  guardianId: guardianIdSchema,
  list_amount_fen: moneyFenSchema,
  discount_fen: moneyFenSchema,
  paid_amount_fen: moneyFenSchema,
  method: paymentMethodSchema,
  receiptNo: receiptNoSchema,
  note: z.string().nullable(),
  createdBy: z.string().min(1).describe("Acting principal id."),
  createdAt: z.iso.datetime().describe("UTC creation timestamp."),
});

const purchaseCommonShape = {
  studentId: studentIdSchema,
  guardianId: guardianIdSchema,
  priceId: priceIdSchema,
  discount_fen: nonnegativeMoneyFenSchema.default(0),
  method: paymentMethodSchema,
  receiptNo: receiptNoSchema,
  note: z
    .string()
    .regex(/\S/, "Must contain non-whitespace text.")
    .optional()
    .describe("Optional receipt note."),
};

const packagePurchaseInputSchema = z
  .object({
    ...purchaseCommonShape,
    kind: z.literal("package"),
    creditsTotal: z
      .number()
      .int()
      .positive()
      .describe("Number of class credits purchased."),
  })
  .strict();

const subscriptionPurchaseInputSchema = z
  .object({
    ...purchaseCommonShape,
    kind: z.literal("subscription"),
    validFrom: localDateSchema,
    validTo: localDateSchema,
  })
  .strict();

export const entitlementsPurchaseInputSchema = z.discriminatedUnion("kind", [
  packagePurchaseInputSchema,
  subscriptionPurchaseInputSchema,
]);

export const entitlementsPurchaseOutputSchema = z.object({
  entitlement: entitlementSchema,
  payment: paymentSchema,
  ledgerEntry: creditLedgerEntrySchema.nullable(),
  draft: messageDraftSchema,
});

export const entitlementsListInputSchema = z
  .object({
    studentId: studentIdSchema.optional().describe("Optional student filter."),
    kind: entitlementKindSchema.optional().describe("Optional entitlement-kind filter."),
  })
  .strict();

export const entitlementsListOutputSchema = z.object({
  entitlements: z.array(entitlementSchema),
});

export const paymentsListInputSchema = z
  .object({
    studentId: studentIdSchema.optional().describe("Optional purchased-for student filter."),
    guardianId: guardianIdSchema.optional().describe("Optional paying guardian filter."),
    entitlementId: entitlementIdSchema.optional().describe("Optional entitlement filter."),
  })
  .strict();

export const paymentsListOutputSchema = z.object({
  payments: z.array(paymentSchema),
});

export const paymentsRefundQuoteInputSchema = z
  .object({ paymentId: paymentIdSchema })
  .strict();

export const paymentRefundQuoteSchema = z.object({
  paymentId: paymentIdSchema,
  entitlementId: entitlementIdSchema,
  studentId: studentIdSchema,
  guardianId: guardianIdSchema,
  remainingCredits: z.number().int().positive(),
  refund_list_amount_fen: nonnegativeMoneyFenSchema,
  refund_discount_fen: nonnegativeMoneyFenSchema,
  refund_amount_fen: nonnegativeMoneyFenSchema,
  quotedAt: z.iso.datetime().describe("UTC instant when this optimistic quote was calculated."),
});

export const paymentsRefundInputSchema = z
  .object({
    paymentId: paymentIdSchema,
    expectedRemainingCredits: z
      .number()
      .int()
      .positive()
      .describe("Remaining credits from the quote being confirmed."),
    expected_refund_amount_fen: nonnegativeMoneyFenSchema.describe(
      "Refund amount from the quote being confirmed, in integer fen.",
    ),
    refundReceiptNo: receiptNoSchema.describe("Unique receipt number for the refund row."),
    method: paymentMethodSchema,
    reason: z
      .string()
      .min(1)
      .regex(/\S/, "Must contain non-whitespace text.")
      .describe("Required human-readable refund reason."),
  })
  .strict();

export const paymentsRefundOutputSchema = z.object({
  quote: paymentRefundQuoteSchema,
  entitlement: entitlementSchema,
  payment: paymentSchema,
  ledgerEntry: creditLedgerEntrySchema,
  draft: messageDraftSchema,
});

export const arrearsListInputSchema = z.object({}).strict();

export const arrearsItemSchema = z.object({
  studentId: studentIdSchema,
  studentName: z.string().min(1),
  balance: z.number().int().describe("Current total ledger balance, including zero."),
  guardianIds: z.array(guardianIdSchema),
  earliestFutureLessonAt: z.iso.datetime(),
});

export const arrearsListOutputSchema = z.object({
  arrears: z.array(arrearsItemSchema),
});

export type EntitlementKind = z.infer<typeof entitlementKindSchema>;
export type EntitlementStatus = z.infer<typeof entitlementStatusSchema>;
export type Entitlement = z.infer<typeof entitlementSchema>;
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type EntitlementsPurchaseInput = z.infer<typeof entitlementsPurchaseInputSchema>;
export type EntitlementsPurchaseOutput = z.infer<typeof entitlementsPurchaseOutputSchema>;
export type EntitlementsListInput = z.infer<typeof entitlementsListInputSchema>;
export type EntitlementsListOutput = z.infer<typeof entitlementsListOutputSchema>;
export type PaymentsListInput = z.infer<typeof paymentsListInputSchema>;
export type PaymentsListOutput = z.infer<typeof paymentsListOutputSchema>;
export type PaymentsRefundQuoteInput = z.infer<typeof paymentsRefundQuoteInputSchema>;
export type PaymentRefundQuote = z.infer<typeof paymentRefundQuoteSchema>;
export type PaymentsRefundInput = z.infer<typeof paymentsRefundInputSchema>;
export type PaymentsRefundOutput = z.infer<typeof paymentsRefundOutputSchema>;
export type ArrearsListInput = z.infer<typeof arrearsListInputSchema>;
export type ArrearsItem = z.infer<typeof arrearsItemSchema>;
export type ArrearsListOutput = z.infer<typeof arrearsListOutputSchema>;
